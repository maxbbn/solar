'use strict';
// Starship flight simulation. A mission entry from js/starship-data.js is flown once, up front,
// with 3-DOF physics in the Earth-fixed frame (gravity with J2, Coriolis and centrifugal terms,
// Raptor thrust that falls with ambient pressure, US76 drag, lift during entry). The guidance
// constants (pitch programme, boostback aim, ship steering) are solved so the vehicles hit the
// published timeline: MECO, staging, boostback, landing burn, SECO. Everything else (max-Q,
// transonic, entry, where the ship comes down) falls out of the physics.
//
// The result is a set of time-tagged state tables (Earth-fixed, so the trajectory does not depend
// on the launch date) interpolated with cubic Hermite splines; attitude and engine state are
// evaluated live from the flight programme. Like the other missions it is a pure function of
// time: it can run at any speed, backwards, or jump to any moment.
const Starship = (() => {
  const G0 = 9.80665, RE = BODY.earth.radius * 1e3, MU = BODY.earth.mu * 1e9, J2 = 1.08263e-3, RJ2 = 6378137;
  const OMEGA = BODY.earth.W[1] * DEG / DAY; // rad/s: the same spin the renderer gives Earth
  const W = [0, 0, OMEGA];
  const AREA = Math.PI * 4.5 * 4.5; // 9 m diameter
  const { add, sub, mul, dot, cross } = V3;
  // Math.hypot is slow in V8 and these run millions of times while planning
  const len = a => Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
  const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const ss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  // ─── Atmosphere: US Standard Atmosphere 1976 to 86 km, tabulated density above ─────────────
  const US76 = [[0, 288.15, -0.0065, 101325], [11000, 216.65, 0, 22632.06], [20000, 216.65, 0.001, 5474.889], [32000, 228.65, 0.0028, 868.0187],
    [47000, 270.65, 0, 110.9063], [51000, 270.65, -0.0028, 66.93887], [71000, 214.65, -0.002, 3.956420]];
  const UPPER = [[86, 6.958e-6], [90, 3.416e-6], [100, 5.604e-7], [110, 9.708e-8], [120, 2.222e-8], [130, 8.152e-9], [140, 3.831e-9], [150, 2.076e-9],
    [160, 1.233e-9], [180, 5.194e-10], [200, 2.541e-10], [250, 6.073e-11], [300, 1.916e-11], [400, 2.803e-12], [500, 5.215e-13], [700, 3.07e-14], [1000, 3.561e-15]];
  const GMR = G0 * 0.0289644 / 8.31446;
  function atmo(h) { // h metres → { rho kg/m³, p Pa, a m/s }
    if (h < 0) h = 0;
    if (h < 86000) {
      const hg = RE * h / (RE + h);
      let L = US76[0];
      for (const l of US76) if (hg >= l[0]) L = l;
      const [hb, Tb, lr, pb] = L, T = Tb + lr * (hg - hb);
      const p = lr === 0 ? pb * Math.exp(-GMR * (hg - hb) / Tb) : pb * Math.pow(T / Tb, -GMR / lr);
      return { rho: p / (287.053 * T), p, a: Math.sqrt(1.4 * 287.053 * T) };
    }
    const k = h / 1000;
    let i = 0;
    while (i < UPPER.length - 2 && k > UPPER[i + 1][0]) i++;
    const [h0, r0] = UPPER[i], [h1, r1] = UPPER[i + 1];
    const rho = r0 * Math.pow(r1 / r0, (k - h0) / (h1 - h0));
    return { rho, p: rho * 287 * 200, a: 290 };
  }
  // Drag coefficients against Mach (reference area: the 9 m cross-section)
  const cdAscent = M => M < 0.6 ? 0.28 : M < 1.1 ? 0.28 + 0.27 * ss(0.6, 1.1, M) : M < 3 ? 0.55 - 0.25 * ss(1.1, 3, M) : 0.3;
  // Booster falling engines-first: blunt base plus ~100 m² of grid fins (Cd referred to the 9 m cross-section)
  const cdBooster = M => M < 0.8 ? 2.2 : M < 1.3 ? 2.2 + 1.0 * ss(0.8, 1.3, M) : 3.2 - 0.5 * ss(1.3, 4, M);

  function gravity(r) {
    const R2 = dot(r, r), R = Math.sqrt(R2), z2 = r[2] * r[2] / R2, k = 1.5 * J2 * RJ2 * RJ2 / R2;
    const f = -MU / (R2 * R);
    return [f * r[0] * (1 + k * (1 - 5 * z2)), f * r[1] * (1 + k * (1 - 5 * z2)), f * r[2] * (1 + k * (3 - 5 * z2))];
  }
  // Acceleration in the rotating (Earth-fixed) frame, without thrust/aero
  const frameAcc = (r, v) => sub(sub(gravity(r), mul(cross(W, v), 2)), cross(W, cross(W, r)));
  const inertialV = (r, v) => add(v, cross(W, r));
  const upOf = r => norm(r);
  const eastOf = r => { const e = cross([0, 0, 1], r); return len(e) < 1e-9 ? [0, 1, 0] : norm(e); };
  const ecefOf = (lat, lon, alt) => mul(surfaceUnit(lat, lon), RE + alt);
  const enu = (P, de, dn, du) => { const u = upOf(P), e = eastOf(P), n = cross(u, e); return add(P, add(add(mul(e, de), mul(n, dn)), mul(u, du))); };

  // ─── Engines ─────────────────────────────────────────────────────────────────
  const thrustOf = (eng, p, thr = 1) => Math.max(0, eng.fvac * thr - p * eng.ae);
  const mdotOf = (eng, thr = 1) => eng.fvac * thr / (eng.isp * G0);

  // ─── Integrator (RK4, state r, v, m in metres / seconds / kg) ─────────────────
  // ctl(t, r, v, m) → { F: thrust vector N, mdot, cdA m², lift: vector m/s² (optional) }
  function deriv(t, r, v, m, ctl) {
    const c = ctl(t, r, v, m), spd = len(v);
    let a = frameAcc(r, v);
    if (c.F) a = add(a, mul(c.F, 1 / m));
    const at = c.cdA ? atmo(len(r) - RE) : null;
    if (at && spd > 0 && at.rho > 1e-13) {
      const D = 0.5 * at.rho * spd * c.cdA / m;
      a = sub(a, mul(v, D));
      if (c.ld) { // lift perpendicular to the airflow, towards local up
        const u = upOf(r), vh = mul(v, 1 / spd), lu = sub(u, mul(vh, dot(u, vh)));
        if (len(lu) > 1e-6) a = add(a, mul(norm(lu), D * spd * c.ld));
      }
    }
    return [v, a, -(c.mdot || 0)];
  }
  function rk4(t, s, dt, ctl) {
    const [r, v, m] = s;
    const k1 = deriv(t, r, v, m, ctl);
    const k2 = deriv(t + dt / 2, add(r, mul(k1[0], dt / 2)), add(v, mul(k1[1], dt / 2)), m + k1[2] * dt / 2, ctl);
    const k3 = deriv(t + dt / 2, add(r, mul(k2[0], dt / 2)), add(v, mul(k2[1], dt / 2)), m + k2[2] * dt / 2, ctl);
    const k4 = deriv(t + dt, add(r, mul(k3[0], dt)), add(v, mul(k3[1], dt)), m + k3[2] * dt, ctl);
    const c = (i, j) => (k1[i][j] + 2 * k2[i][j] + 2 * k3[i][j] + k4[i][j]) * dt / 6;
    return [[r[0] + c(0, 0), r[1] + c(0, 1), r[2] + c(0, 2)], [v[0] + c(1, 0), v[1] + c(1, 1), v[2] + c(1, 2)],
      m + (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]) * dt / 6];
  }
  // Flies from t0 until t1 or until stop(t, s) is true; records into rec (if given) every `every` s
  function fly(t0, s0, t1, ctl, o = {}) {
    let t = t0, s = s0, nextRec = t0;
    const dtOf = o.dt || (() => 0.05), rec = o.rec, every = o.every || (() => 0.2);
    if (rec) { rec.push(t, s); nextRec = t + every(t, s); }
    while (t < t1 - 1e-9) {
      const dt = Math.min(dtOf(t, s), t1 - t);
      const ns = rk4(t, s, dt, ctl);
      if (o.stop && o.stop(t + dt, ns)) {
        // Bisect to the crossing so events (cutoff, splashdown) land on the right instant
        let lo = 0, hi = dt;
        for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (o.stop(t + mid, rk4(t, s, mid, ctl))) hi = mid; else lo = mid; }
        s = rk4(t, s, hi, ctl); t += hi;
        if (rec) rec.push(t, s);
        return { t, s, stopped: true };
      }
      t += dt; s = ns;
      if (rec && (t >= nextRec - 1e-9 || t >= t1 - 1e-9)) { rec.push(t, s); nextRec = t + every(t, s); }
    }
    return { t, s, stopped: false };
  }

  // Time-tagged states, cubic Hermite in between (positions km, velocities km/s, Earth-fixed)
  class Track {
    constructor() { this.t = []; this.r = []; this.v = []; this.m = []; }
    push(t, s) {
      if (this.t.length && t <= this.t[this.t.length - 1] + 1e-9) { // same instant: replace
        this.r[this.r.length - 1] = mul(s[0], 1e-3); this.v[this.v.length - 1] = mul(s[1], 1e-3); this.m[this.m.length - 1] = s[2]; return;
      }
      this.t.push(t); this.r.push(mul(s[0], 1e-3)); this.v.push(mul(s[1], 1e-3)); this.m.push(s[2]);
    }
    get t0() { return this.t[0]; }
    get t1() { return this.t[this.t.length - 1]; }
    idx(t) {
      const T = this.t;
      let lo = 0, hi = T.length - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (T[mid] <= t) lo = mid; else hi = mid; }
      return lo;
    }
    at(t) { // → { r, v, m }; holds the end states outside the table
      const T = this.t, n = T.length;
      if (t <= T[0]) return { r: this.r[0], v: this.v[0], m: this.m[0] };
      if (t >= T[n - 1]) return { r: this.r[n - 1], v: this.v[n - 1], m: this.m[n - 1] };
      const i = this.idx(t), h = T[i + 1] - T[i], s = (t - T[i]) / h;
      const p0 = this.r[i], p1 = this.r[i + 1], v0 = this.v[i], v1 = this.v[i + 1];
      const s2 = s * s, s3 = s2 * s;
      const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
      const d00 = (6 * s2 - 6 * s) / h, d10 = 3 * s2 - 4 * s + 1, d01 = (-6 * s2 + 6 * s) / h, d11 = 3 * s2 - 2 * s;
      const r = [0, 1, 2].map(k => h00 * p0[k] + h10 * h * v0[k] + h01 * p1[k] + h11 * h * v1[k]);
      const v = [0, 1, 2].map(k => d00 * p0[k] + d10 * v0[k] + d01 * p1[k] + d11 * v1[k]);
      return { r, v, m: this.m[i] + (this.m[i + 1] - this.m[i]) * s };
    }
  }

  // Free flight in vacuum (deployed satellites): an analytic two-body orbit in the inertial frame
  // that coincides with the Earth-fixed one at liftoff, read back out in Earth-fixed coordinates
  const rotZ = (v, a) => { const c = Math.cos(a), s = Math.sin(a); return [c * v[0] - s * v[1], s * v[0] + c * v[1], v[2]]; };
  class SatOrbit {
    constructor(t0, r, v, m) { // metres, m/s, Earth-fixed
      const a = OMEGA * t0, rk = mul(r, 1e-3), vk = mul(add(v, cross(W, r)), 1e-3);
      this.conic = new Conic(rotZ(rk, a), rotZ(vk, a), BODY.earth.mu, t0 / DAY);
      this.t0 = t0; this.m = m;
    }
    at(t) {
      const [rI, vI] = this.conic.state(t / DAY), a = -OMEGA * t, r = rotZ(rI, a);
      return { r, v: sub(rotZ(vI, a), cross(W, r)), m: this.m };
    }
  }

  // Kinematic segment: cubic Hermite from (r0, v0) at ta to (r1, v1) at tb, recorded with the
  // thrust it would take (used for landing burns, so the touchdown point is exact)
  function hermiteLeg(rec, ta, tb, r0, v0, r1, v1, m0, eng, step = 0.2) {
    const tau = tb - ta, out = [];
    let m = m0;
    for (let t = ta; t <= tb + 1e-9; t += step) {
      const s = Math.min(1, (t - ta) / tau), s2 = s * s, s3 = s2 * s;
      const p = [0, 1, 2].map(k => (2 * s3 - 3 * s2 + 1) * r0[k] + (s3 - 2 * s2 + s) * tau * v0[k] + (-2 * s3 + 3 * s2) * r1[k] + (s3 - s2) * tau * v1[k]);
      const v = [0, 1, 2].map(k => ((6 * s2 - 6 * s) * r0[k] + (3 * s2 - 4 * s + 1) * tau * v0[k] + (-6 * s2 + 6 * s) * r1[k] + (3 * s2 - 2 * s) * tau * v1[k]) / tau);
      const acc = [0, 1, 2].map(k => ((12 * s - 6) * r0[k] + (6 * s - 4) * tau * v0[k] + (-12 * s + 6) * r1[k] + (6 * s - 2) * tau * v1[k]) / (tau * tau));
      const need = sub(acc, frameAcc(p, v)); // what the engines must supply (drag is small at these speeds)
      const F = len(need) * m;
      if (t > ta) m -= Math.min(F / (eng.isp * G0) * step, m * 0.01);
      rec.push(Math.min(t, tb), [p, v, m]);
      out.push({ t, dir: norm(need), F });
    }
    return out;
  }

  // ─── Flight planning ────────────────────────────────────────────────────────
  function plan(mission, opts = {}) {
    const veh = STARSHIP_VEHICLES[mission.vehicle], TL = mission.timeline, pad = STARSHIP_PADS[mission.pad];
    const BE = RAPTORS[veh.booster.engine], RSL = RAPTORS[veh.ship.rsl], RVAC = RAPTORS[veh.ship.rvac];
    const recovery = opts.recovery || mission.booster.recovery;
    const payloadMass = mission.payload.count * mission.payload.mass;
    const P = ecefOf(pad.lat, pad.lon, 0), UP = upOf(P), EAST = eastOf(P), NORTH = cross(UP, EAST);
    const OLM_H = 20, CATCH_H = 35; // launch mount table / booster base when caught (m)
    const liftoffR = add(P, mul(UP, OLM_H));
    const catchR = add(P, mul(UP, CATCH_H));
    const gulf = mission.booster.gulf || [9, 1.5];
    const boosterTarget = recovery === 'catch' ? catchR : enu(P, gulf[0] * 1000, gulf[1] * 1000, 0);
    const az = mission.azimuth * DEG, AZ = add(mul(NORTH, Math.cos(az)), mul(EAST, Math.sin(az)));
    const bDry = veh.booster.dry, sDry = veh.ship.dry, sProp = veh.ship.prop;
    const m0 = bDry + veh.booster.prop + sDry + sProp + payloadMass;
    const hsrMass = veh.booster.hsr === 'jettison' ? 9e3 : 0;

    // Booster throttle: full, a bucket through max-Q, then held to an acceleration limit as the
    // tanks empty (the limit is solved below so staging happens at the published speed)
    let gLim = 30;
    const bThrottle = (t, m, p) => {
      const bucket = 1 - 0.3 * ss(48, 58, t) * (1 - ss(76, 88, t));
      return clamp(Math.min(bucket, (gLim * m + veh.booster.n * p * BE.ae) / (veh.booster.n * BE.fvac)), 0.45, 1);
    };
    const shipIgnite = TL.stage - 1.2; // hot staging: the ship lights while still attached

    // ── Ascent of the stack: vertical rise, pitch kick, zero-angle-of-attack gravity turn ──
    const T_TURN = 9; // clears the 146 m tower first
    function stackCtl(kick, shipThr) {
      return (t, r, v, m) => {
        const at = atmo(len(r) - RE);
        const nB = t < TL.meco ? veh.booster.n : 3;
        const thr = t < TL.meco ? bThrottle(t, m, at.p) : 0.6;
        let F = nB * thrustOf(BE, at.p, thr), md = nB * mdotOf(BE, thr);
        if (t >= shipIgnite) { const k = ss(shipIgnite, TL.stage, t) * shipThr; F += 3 * (thrustOf(RSL, at.p, k) + thrustOf(RVAC, at.p, k)); md += 3 * (mdotOf(RSL, k) + mdotOf(RVAC, k)); }
        const dir = stackDir(t, r, v, kick);
        const M = len(v) / at.a;
        return { F: mul(dir, F), mdot: md, cdA: cdAscent(M) * AREA };
      };
    }
    function stackDir(t, r, v, kick) {
      const up = upOf(r);
      if (t < T_TURN) return up;
      const kd = norm(add(mul(up, Math.cos(kick)), mul(AZ, Math.sin(kick))));
      if (t < T_TURN + 10) return norm(V3.slerp(up, kd, ss(T_TURN, T_TURN + 10, t)));
      const vd = len(v) > 1 ? norm(v) : up;
      return norm(V3.slerp(kd, vd, ss(T_TURN + 10, T_TURN + 16, t)));
    }
    const s0 = [liftoffR, [0, 0, 0], m0];
    const ascend = (kick, shipThr, rec) => fly(0, s0, TL.stage, stackCtl(kick, shipThr), { rec, dt: () => 0.2, every: () => 0.2 });
    // Pitch kick and acceleration limit tuned so staging happens at the published altitude and speed
    const [stageAlt, stageKmh] = mission.staging || veh.staging;
    let kick = (mission.guess && mission.guess.kick || 2.5) * DEG;
    gLim = mission.guess && mission.guess.gLim || 25;
    {
      const err = (k, g) => { gLim = g; const s = ascend(k, 0.9).s; return [(len(s[0]) - RE) / 1000 - stageAlt, (len(s[1]) * 3.6 - stageKmh) / 100]; };
      for (let it = 0; it < 12; it++) {
        const f = err(kick, gLim);
        if (Math.abs(f[0]) < 0.05 && Math.abs(f[1]) < 0.1) break;
        const f1 = err(kick + 0.05 * DEG, gLim), f2 = err(kick, gLim + 0.2);
        const a = (f1[0] - f[0]) / (0.05 * DEG), b = (f2[0] - f[0]) / 0.2, c = (f1[1] - f[1]) / (0.05 * DEG), d = (f2[1] - f[1]) / 0.2;
        const det = a * d - b * c;
        if (!det) break;
        kick = clamp(kick + clamp((-f[0] * d + f[1] * b) / det, -1.5 * DEG, 1.5 * DEG), 0.3 * DEG, 10 * DEG);
        gLim = clamp(gLim + clamp((-a * f[1] + c * f[0]) / det, -6, 6), 12, 60);
      }
      err(kick, gLim);
    }

    // ── Ship: linear-tangent steering to the SECO state, throttle sized so SECO lands on time ──
    const se = mission.ship.seco, rS = RE + se.alt * 1000, rp = RE + se.peri * 1000, ra = RE + se.apo * 1000;
    const aOrb = (rp + ra) / 2, vS = Math.sqrt(MU * (2 / rS - 1 / aOrb)), hAng = Math.sqrt(MU * 2 * ra * rp / (ra + rp));
    const gS = Math.acos(clamp(hAng / (rS * vS), -1, 1));
    const stageState = ascend(kick, 0.9).s;
    const shipEngines = k => ({ F: p => 3 * (thrustOf(RSL, p, k) + thrustOf(RVAC, p, k)), mdot: 3 * (mdotOf(RSL, k) + mdotOf(RVAC, k)) });
    const stageNose = norm(stageState[1]); // the stack flies at zero angle of attack into staging
    function shipDir(t, r, v, th0, th1) {
      const up = upOf(r), vi = inertialV(r, v), hz = norm(sub(vi, mul(up, dot(vi, up))));
      const tau = clamp((t - TL.stage) / (TL.seco - TL.stage), 0, 1.3);
      const th = Math.atan(Math.tan(th0) + (Math.tan(th1) - Math.tan(th0)) * tau);
      const g = norm(add(mul(hz, Math.cos(th)), mul(up, Math.sin(th))));
      return t < TL.stage + 10 ? norm(V3.slerp(stageNose, g, ss(TL.stage, TL.stage + 10, t))) : g; // pitch smoothly onto the steering law
    }
    function shipAscent(x, rec) {
      const [th0, th1, k] = x, se2 = shipEngines(k);
      const s = [add(stageState[0], mul(stageNose, veh.booster.h)), stageState[1], sDry + sProp + payloadMass]; // ship base sits on the booster
      return fly(TL.stage, s, TL.seco + 60, (t, r, v, m) => {
        const at = atmo(len(r) - RE), dir = shipDir(t, r, v, th0, th1);
        return { F: mul(dir, se2.F(at.p)), mdot: se2.mdot, cdA: 0.3 * AREA };
      }, { rec, dt: () => 0.25, every: () => 0.5, stop: (t, s) => len(inertialV(s[0], s[1])) >= vS });
    }
    const secoErr = x => {
      const o = shipAscent(x), r = o.s[0], vi = inertialV(r, o.s[1]);
      const g = Math.asin(dot(upOf(r), norm(vi)));
      return [(len(r) - rS) / 1000, (g - gS) / DEG, (o.t - TL.seco) / 10];
    };
    let x = [24 * DEG, -6 * DEG, 0.9];
    for (let it = 0; it < 12; it++) {
      const f = secoErr(x);
      if (Math.abs(f[0]) < 0.3 && Math.abs(f[1]) < 0.03 && Math.abs(f[2]) < 0.05) break;
      const hs = [0.2 * DEG, 0.2 * DEG, 0.004], J = [];
      for (let j = 0; j < 3; j++) { const xp = x.slice(); xp[j] += hs[j]; const fp = secoErr(xp); J.push(fp.map((v, i) => (v - f[i]) / hs[j])); }
      const dx = solve3([[J[0][0], J[1][0], J[2][0]], [J[0][1], J[1][1], J[2][1]], [J[0][2], J[1][2], J[2][2]]], f.map(v => -v));
      if (!dx) break;
      const lim = [6 * DEG, 6 * DEG, 0.1];
      x = x.map((v, i) => v + clamp(dx[i], -lim[i], lim[i]));
      x[2] = clamp(x[2], 0.55, 1.0);
    }
    const shipX = x;

    // ── Record ascent + ship to SECO ──
    const stackTrack = new Track();
    ascend(kick, shipX[2], stackTrack);
    const ship = new Track(), booster = new Track();
    const shipAsc = shipAscent(shipX, ship);
    const tSECO = shipAsc.t;

    // ── Booster: flip, boostback, coast, landing burn ──
    const bStage = [stageState[0], stageState[1], 0];
    {
      // Booster mass at staging: what the ascent left in its tanks
      const used = stackTrack.m[0] - stackTrack.m[stackTrack.m.length - 1];
      bStage[2] = bDry + veh.booster.prop - used + 0; // ship mass leaves with the ship
    }
    const tau = TL.land - TL.lb0;
    const bbAim = (r, v) => { // horizontal aim that also cancels crossrange drift
      const up = upOf(r), toT = sub(boosterTarget, r), th = norm(sub(toT, mul(up, dot(toT, up))));
      const vh = sub(v, mul(up, dot(v, up)));
      return norm(sub(mul(th, 3000), vh)); // towards a fast return, cancelling any sideways drift
    };
    // Boostback: the 13 inner engines for a high-thrust portion, then the 3 centre engines
    // trimming the aim. Solved: thrust elevation and how long the high-thrust portion lasts.
    const BB_HI = 0.9, BB_LO = 0.75, B_RESERVE = 15e3;
    const bbHiEnd = f => TL.bb0 + f * (TL.bb1 - TL.bb0);
    function boosterCtl(eps, f) {
      const tHi = bbHiEnd(f);
      return (t, r, v, m) => {
        const at = atmo(len(r) - RE), M = len(v) / at.a;
        let F = [0, 0, 0], md = 0;
        if (t >= TL.bb0 && t < TL.bb1 && m > bDry + B_RESERVE) {
          const n = t < tHi ? 13 : 3, k = n === 13 ? BB_HI : BB_LO, up = upOf(r);
          const dir = norm(add(mul(bbAim(r, v), Math.cos(eps)), mul(up, Math.sin(eps))));
          F = mul(dir, n * thrustOf(BE, at.p, k)); md = n * mdotOf(BE, k);
        }
        return { F, mdot: md, cdA: (t < TL.bb1 ? 0.6 : cdBooster(M)) * AREA };
      };
    }
    const bDescent = (eps, f, rec) => fly(TL.stage, bStage, TL.lb0, boosterCtl(eps, f),
      { rec, dt: () => 0.2, every: (t, s) => (len(s[0]) - RE > 100e3 ? 0.5 : 0.2) });
    const back = (() => { const up = upOf(boosterTarget), d = sub(boosterTarget, stageState[0]); return norm(sub(d, mul(up, dot(d, up)))); })();
    // Miss at the landing burn: where a constant deceleration from there would stop the booster
    const bbErr = (eps, f) => {
      const s = bDescent(eps, f).s, pEnd = add(s[0], mul(s[1], tau / 2)), d = sub(pEnd, boosterTarget);
      return [dot(d, back) / 1000, dot(d, upOf(boosterTarget)) / 1000];
    };
    // Coarse search first (running the tanks dry flattens the error surface), then Newton
    let eps = 10 * DEG, kb = 0.5;
    {
      let best = Infinity;
      for (let e = -10; e <= 35; e += 15) for (let f = 0.15; f <= 1; f += 0.28) {
        const r = bbErr(e * DEG, f), c = Math.hypot(r[0], r[1] * 3);
        if (c < best) { best = c; eps = e * DEG; kb = f; }
      }
    }
    for (let it = 0; it < 16; it++) {
      const f = bbErr(eps, kb);
      if (Math.abs(f[0]) < 0.02 && Math.abs(f[1]) < 0.01) break;
      const f1 = bbErr(eps + 0.1 * DEG, kb), f2 = bbErr(eps, kb + 0.005);
      const a = (f1[0] - f[0]) / (0.1 * DEG), b = (f2[0] - f[0]) / 0.005, c = (f1[1] - f[1]) / (0.1 * DEG), d = (f2[1] - f[1]) / 0.005;
      const det = a * d - b * c;
      if (Math.abs(det) < 1e-12) break;
      const de = (-f[0] * d + f[1] * b) / det, dk = (-a * f[1] + c * f[0]) / det;
      eps = clamp(eps + clamp(de, -6 * DEG, 6 * DEG), -40 * DEG, 70 * DEG);
      kb = clamp(kb + clamp(dk, -0.2, 0.2), 0.05, 1.0);
    }
    const bDesc = bDescent(eps, kb, booster);
    const bLanding = hermiteLeg(booster, TL.lb0, TL.land, mul(bDesc.s[0], 1), bDesc.s[1], boosterTarget, [0, 0, 0], bDesc.s[2], BE);
    // Touchdown / catch: hold there
    booster.push(TL.land + 3600 * 24, [boosterTarget, [0, 0, 0], booster.m[booster.m.length - 1]]);

    // Hot-stage ring (Block 2): jettisoned after boostback, tumbles into the Gulf
    let ring = null;
    if (TL.hsj && veh.booster.hsr === 'jettison') {
      ring = new Track();
      const b = booster.at(TL.hsj), r = mul(b.r, 1000), v = mul(b.v, 1000);
      const top = add(r, mul(boosterNose(TL.hsj), veh.booster.h - 1));
      fly(TL.hsj, [top, add(v, mul(norm(boosterNoseRaw(TL.hsj)), 3)), hsrMass], TL.hsj + 900, () => ({ cdA: 1.1 * AREA }),
        { rec: ring, dt: () => 0.1, every: () => 0.5, stop: (t, s) => len(s[0]) < RE });
    }

    // ── Ship: coast, deploy, relight, (insertion, deorbit), entry, flip, landing burn ──
    const shipProfile = mission.ship.profile, tOIB = mission.ship.oib, tDeorbit = mission.ship.deorbit;
    let oibStart = null, deorbitDur = 11;
    const relight = TL.relight;
    // Entry flight: angle of attack and lift by Mach
    const entryAoA = M => (M > 6 ? 62 : M > 1.5 ? 62 + 13 * (1 - ss(1.5, 6, M)) : 75 + 15 * (1 - ss(0.6, 1.5, M))) * DEG;
    const LD = mission.ship.ld != null ? mission.ship.ld : 0.22;
    const entryLD = M => M > 4 ? LD : LD * ss(0.8, 4, M);
    const shipCdA = (alpha, M) => (M > 1.2 ? 1.35 : 1.15) * (9 * 46 * Math.sin(alpha) + AREA * Math.abs(Math.cos(alpha)));
    function coastCtl(t, r, v, m) {
      const at = atmo(len(r) - RE), M = len(v) / at.a;
      let F = null, md = 0;
      if (relight && t >= relight[0] && t < relight[0] + relight[1]) { F = mul(norm(inertialV(r, v)), thrustOf(RSL, at.p, 0.4)); md = mdotOf(RSL, 0.4); }
      if (oibStart != null && t >= oibStart && t < tOIB) { F = mul(norm(inertialV(r, v)), thrustOf(RVAC, at.p, 1)); md = mdotOf(RVAC, 1); }
      if (tDeorbit && t >= tDeorbit && t < tDeorbit + deorbitDur) { F = mul(norm(inertialV(r, v)), -thrustOf(RSL, at.p, 1)); md = mdotOf(RSL, 1); }
      if (t >= TL.deploy[0] && t < TL.deploy[1] + 1) md += payloadMass / (TL.deploy[1] + 1 - TL.deploy[0]); // satellites leaving
      const h = len(r) - RE;
      if (h > 140e3) return { F, mdot: md };
      const a = entryAoA(M);
      return { F, mdot: md, cdA: shipCdA(a, M), ld: entryLD(M) };
    }
    // Orbital: size the insertion burn so it ends on time with the target perigee
    const sEnd = ship.t.length - 1;
    let sState = [mul(ship.r[sEnd], 1000), mul(ship.v[sEnd], 1000), ship.m[sEnd]];
    const coastDt = (t, s) => { const h = len(s[0]) - RE; return h > 130e3 ? 1 : h > 60e3 ? 0.2 : 0.05; };
    const coastEvery = (t, s) => { const h = len(s[0]) - RE; return h > 130e3 ? 4 : h > 30e3 ? 1 : 0.25; };
    // Deploy windows need finer sampling of the ship (satellites start from its exact state)
    const coastEveryD = (t, s) => (t >= TL.deploy[0] - 5 && t <= TL.deploy[1] + 5) ? 1 : coastEvery(t, s);
    if (shipProfile === 'orbital') {
      const apsis = (rr, vv) => { const vi = inertialV(rr, vv), R = len(rr), V2 = dot(vi, vi), a = 1 / (2 / R - V2 / MU), h = len(cross(rr, vi)), e = Math.sqrt(Math.max(0, 1 - h * h / (MU * a))); return [a * (1 - e), a * (1 + e)]; };
      // Coast to a probe point, then find the burn length that lifts perigee to the target
      const want = RE + mission.ship.orbit.peri * 1000;
      let lo = 1, hi = 120;
      for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        oibStart = tOIB - mid;
        const o = fly(tSECO, sState, tOIB + 1, coastCtl, { dt: coastDt });
        if (apsis(o.s[0], o.s[1])[0] < want) lo = mid; else hi = mid;
      }
      oibStart = tOIB - (lo + hi) / 2;
      // Deorbit: retrograde burn sized to put perigee ~50 km down into the atmosphere
      const pd = fly(tSECO, sState, tDeorbit, coastCtl, { dt: coastDt });
      const vi = len(inertialV(pd.s[0], pd.s[1]));
      const R = len(pd.s[0]), rpWant = RE + 20e3, aNew = (R + rpWant) / 2, vNew = Math.sqrt(MU * (2 / R - 1 / aNew));
      deorbitDur = Math.max(2, (vi - vNew) * pd.s[2] / thrustOf(RSL, 0, 1));
    }
    // Coast + entry until the ship is low and slow enough to flip: start the flip when a constant
    // deceleration over the landing burn would just stop it at the sea surface
    const FLIP = 5.5, BURN = 11.5;
    const tCoastEnd = (tDeorbit || TL.deploy[1]) + 3 * 3600;
    const descent = fly(tSECO, sState, tCoastEnd, coastCtl, {
      rec: ship, dt: coastDt, every: coastEveryD,
      stop: (t, s) => t > TL.deploy[1] && len(s[0]) - RE < 6e3 && (len(s[0]) - RE) <= Math.max(0, -dot(s[1], upOf(s[0]))) * (FLIP + BURN) / 2,
    });
    const tFlip = descent.t, tLandShip = tFlip + FLIP + BURN;
    const sF = descent.s, upF = upOf(sF[0]);
    const vhF = sub(sF[1], mul(upF, dot(sF[1], upF)));
    const shipLandR = mul(norm(add(sF[0], mul(vhF, (FLIP + BURN) / 2))), RE);
    const sLanding = hermiteLeg(ship, tFlip, tLandShip, sF[0], sF[1], shipLandR, [0, 0, 0], sF[2], RSL);
    ship.push(tLandShip + 3600 * 24, [shipLandR, [0, 0, 0], ship.m[ship.m.length - 1]]);

    // ── Satellites: pushed out of the payload door with ~0.4 m/s, then free flight ──
    const sats = [];
    const nS = mission.payload.count;
    const satsWhen = Array.from({ length: nS }, (_, i) => TL.deploy[0] + (nS > 1 ? i * (TL.deploy[1] - TL.deploy[0]) / (nS - 1) : 0));

    // ─── Attitude ────────────────────────────────────────────────────────────
    // Each vehicle: nose (body +Y) and "belly" (body +Z: the ship's heat shield; the booster's
    // side that faced east on the pad), both Earth-fixed unit vectors.
    function ascentAtt(t) {
      const s = stackTrack.at(t), r = mul(s.r, 1000), v = mul(s.v, 1000);
      return stackDir(t, r, v, kick);
    }
    function boosterNoseRaw(t) {
      if (t < TL.stage) return ascentAtt(t);
      const s = booster.at(t), r = mul(s.r, 1000), v = mul(s.v, 1000), up = upOf(r);
      const bbDir = tt => { const ss2 = booster.at(tt), rr = mul(ss2.r, 1000), vv = mul(ss2.v, 1000), u = upOf(rr); return norm(add(mul(bbAim(rr, vv), Math.cos(eps)), mul(u, Math.sin(eps)))); };
      if (t < TL.bb0) { // flip: pitch around through the side to point back up-range
        const a = ascentAtt(TL.stage), b = bbDir(TL.bb0);
        return norm(V3.slerp(a, b, ss(TL.stage + 1, TL.bb0, t)));
      }
      if (t < TL.bb1) return bbDir(t);
      const fall = len(v) > 30 ? mul(norm(v), -1) : up; // tail first, grid fins steering
      if (t < TL.lb0) return norm(V3.slerp(bbDir(TL.bb1), fall, ss(TL.bb1, TL.bb1 + 25, t)));
      if (t < TL.land) {
        const k = Math.min(bLanding.length - 1, Math.round((t - TL.lb0) / 0.2));
        return norm(V3.slerp(fall, bLanding[k].dir, ss(TL.lb0, TL.lb0 + 3, t)));
      }
      return up;
    }
    function boosterNose(t) { return boosterNoseRaw(t); }
    // Ship coast/entry attitude programme
    const deployStart = TL.deploy[0] - 120, deployEnd = TL.deploy[1] + 60;
    function shipFrame(t) { // → [nose, belly]
      if (t < TL.stage) { const n = ascentAtt(t); return [n, padBelly(n)]; }
      const s = ship.at(t), r = mul(s.r, 1000), v = mul(s.v, 1000), up = upOf(r);
      const vi = inertialV(r, v), pro = norm(vi);
      if (t < tSECO) {
        const n = shipDir(t, r, v, shipX[0], shipX[1]);
        return [n, norm(sub(mul(up, -1), mul(n, dot(mul(up, -1), n))))]; // heat shield down
      }
      // Coast frames
      const bellyDown = [pro, norm(sub(mul(up, -1), mul(pro, dot(mul(up, -1), pro))))];
      const bellyUp = [pro, mul(bellyDown[1], -1)]; // payload door (leeward) faces Earth for deploy
      const at = atmo(len(r) - RE), M = len(v) / at.a, vd = len(v) > 1 ? norm(v) : mul(up, -1);
      let lu = sub(up, mul(vd, dot(up, vd)));
      lu = len(lu) > 1e-3 ? norm(lu) : norm(cross(eastOf(r), vd));
      const a = entryAoA(M);
      const entry = [norm(add(mul(vd, Math.cos(a)), mul(lu, Math.sin(a)))), norm(sub(mul(vd, Math.sin(a)), mul(lu, Math.cos(a))))];
      const entryStart = tEntry - 420;
      let f = bellyDown;
      const blend = (A, B, k) => { const n = norm(V3.slerp(A[0], B[0], k)); let b = norm(V3.slerp(A[1], B[1], k)); b = norm(sub(b, mul(n, dot(b, n)))); return [n, b]; };
      if (t >= deployStart - 60 && t < deployEnd + 60) f = blend(bellyDown, bellyUp, ss(deployStart - 60, deployStart, t) * (1 - ss(deployEnd, deployEnd + 60, t)));
      if (tDeorbit && t >= tDeorbit - 90 && t < tDeorbit + deorbitDur + 60) {
        const retro = [mul(pro, -1), bellyDown[1]];
        f = blend(f, retro, ss(tDeorbit - 90, tDeorbit - 30, t) * (1 - ss(tDeorbit + deorbitDur, tDeorbit + deorbitDur + 60, t)));
      }
      if (t >= entryStart) f = blend(f, entry, ss(entryStart, entryStart + 120, t));
      if (t >= tFlip) {
        const k = Math.min(sLanding.length - 1, Math.max(0, Math.round((t - tFlip) / 0.2)));
        const thrustDir = sLanding[k].dir;
        const n = norm(V3.slerp(entry[0], thrustDir, ss(tFlip, tFlip + FLIP, t)));
        let b = norm(sub(entry[1], mul(n, dot(entry[1], n))));
        if (t > tLandShip) { // tips over on the water
          const k2 = ss(tLandShip + 2, tLandShip + 9, t);
          const n2 = norm(V3.slerp(up, b, k2 * 0.97)), b2 = norm(V3.slerp(b, mul(up, -1), k2 * 0.97));
          return [n2, b2];
        }
        return [n, b];
      }
      return f;
    }
    function padBelly(n) { // body +Z: east on the pad, kept perpendicular to the nose
      const e = sub(EAST, mul(n, dot(EAST, n)));
      return norm(e);
    }
    function boosterFrame(t) {
      const n = boosterNose(t);
      let b;
      if (t < TL.stage) b = padBelly(n);
      else {
        const ref = padBelly(ascentAtt(TL.stage));
        b = norm(sub(ref, mul(n, dot(ref, n))));
        if (len(b) < 1e-3) b = padBelly(n);
      }
      if (recovery !== 'catch' && t > TL.land) { // splashed down: tips over in the water
        const up = upOf(mul(boosterTarget, 1)), k = ss(TL.land + 4, TL.land + 12, t);
        return [norm(V3.slerp(up, b, k * 0.97)), norm(V3.slerp(b, mul(up, -1), k * 0.97))];
      }
      return [n, b];
    }

    // Entry interface (100 km, descending) and the other computed milestones
    const crossing = (track, from, test) => {
      for (let i = Math.max(1, track.idx(from)); i < track.t.length; i++) if (test(i) && !test(i - 1)) return track.t[i];
      return null;
    };
    const altK = (tr, i) => len(tr.r[i]) - BODY.earth.radius;
    const machK = (tr, i) => { const h = altK(tr, i) * 1000; return len(tr.v[i]) * 1000 / atmo(h).a; };
    const tEntry = crossing(ship, Math.max(tSECO, tDeorbit || 0) + 60, i => altK(ship, i) < 100) || tFlip - 900;
    const tShipTransonic = crossing(ship, tEntry, i => machK(ship, i) < 1.2 && altK(ship, i) < 60);
    const tShipSubsonic = crossing(ship, tEntry, i => machK(ship, i) < 0.8 && altK(ship, i) < 60);
    const tBoosterTransonic = crossing(booster, TL.bb1, i => machK(booster, i) < 1.0 && altK(booster, i) < 30);
    let tMaxQ = 0, maxQ = 0;
    for (let i = 0; i < stackTrack.t.length; i++) {
      const h = altK(stackTrack, i) * 1000, q = 0.5 * atmo(h).rho * (len(stackTrack.v[i]) * 1000) ** 2;
      if (q > maxQ) { maxQ = q; tMaxQ = stackTrack.t[i]; }
    }

    for (let i = 0; i < nS; i++) {
      const t0 = satsWhen[i], s = ship.at(t0), [n, b] = shipFrame(t0);
      const door = mul(b, -1); // leeward side
      // The dispenser pushes each one out through the door, 30 m above the ship's base (js/starship-scene.js)
      const r = add(mul(s.r, 1000), add(mul(n, 30), mul(door, 4.9)));
      const v = add(mul(s.v, 1000), mul(door, 0.45));
      // Same force model as the ship while they are close (so the relative motion is right),
      // then an analytic orbit for the long run
      const near = new Track(), m = mission.payload.mass, orbital = shipProfile === 'orbital';
      const o = fly(t0, [r, v, m], t0 + (orbital ? 1200 : 3600), () => ({}), { rec: near, dt: () => 1, every: () => 4, stop: (t, st) => len(st[0]) - RE < 85e3 });
      const far = orbital && !o.stopped ? new SatOrbit(o.t, o.s[0], o.s[1], m) : null;
      const track = { at: t => (far && t > near.t1 ? far.at(t) : near.at(t)) };
      sats.push({ t0, track, tEnd: far ? t0 + 30 * 86400 : near.t1 });
    }

    // ── Engine states ──
    function boosterEngines(t) { // → { n: lit engines (3 centre, 13 incl. inner ring, 33 all), throttle }
      if (t < -3 || t > TL.land + 0.5) return { n: 0, thr: 0 };
      if (t < 0) return { n: Math.round(ss(-3, -0.4, t) * 33), thr: 0.8 };
      if (t < TL.meco) { const s = stackTrack.at(t); return { n: veh.booster.n, thr: bThrottle(t, s.m, atmo(len(s.r) * 1000 - RE).p) }; }
      if (t < TL.stage + 0.6) return { n: 3, thr: 0.6 };
      if (t >= TL.bb0 && t < TL.bb1) return t < bbHiEnd(kb) ? { n: 13, thr: BB_HI } : { n: 3, thr: BB_LO };
      if (t >= TL.lb0 && t < TL.land) {
        const k = Math.min(bLanding.length - 1, Math.round((t - TL.lb0) / 0.2)), F = bLanding[k].F, p = atmo(0).p;
        const n = t < TL.lb0 + 0.55 * tau ? 13 : 3; // 13 engines to kill most of the speed, then the centre 3
        return { n, thr: clamp(F / (n * thrustOf(BE, p, 1)), 0.4, 1) };
      }
      return { n: 0, thr: 0 };
    }
    function shipEnginesAt(t) { // → { rsl, rvac, thr }
      if (t >= shipIgnite && t < tSECO) return { rsl: 3, rvac: 3, thr: t < TL.stage ? ss(shipIgnite, TL.stage, t) * shipX[2] : shipX[2] };
      if (relight && t >= relight[0] && t < relight[0] + relight[1]) return { rsl: 1, rvac: 0, thr: 0.4 };
      if (oibStart != null && t >= oibStart && t < tOIB) return { rsl: 0, rvac: 1, thr: 1 };
      if (tDeorbit && t >= tDeorbit && t < tDeorbit + deorbitDur) return { rsl: 1, rvac: 0, thr: 1 };
      if (t >= tFlip && t < tLandShip) return { rsl: t < tFlip + FLIP + 4 ? 3 : 2, rvac: 0, thr: 0.6 };
      return { rsl: 0, rvac: 0, thr: 0 };
    }

    return {
      mission, veh, pad, recovery, P, UP, EAST, NORTH, OLM_H, CATCH_H, boosterTarget, liftoffR,
      ship, booster, stack: stackTrack, ring, sats,
      kick, shipX, eps, kb,
      t: { seco: tSECO, oibStart, oib: tOIB, deorbit: tDeorbit, deorbitDur, entry: tEntry, flip: tFlip, landShip: tLandShip, maxQ: tMaxQ,
        shipTransonic: tShipTransonic, shipSubsonic: tShipSubsonic, boosterTransonic: tBoosterTransonic, shipIgnite, landBurn: tFlip + FLIP, bbHi: bbHiEnd(kb) },
      maxQ, shipLandR, payloadMass,
      shipFrame, boosterFrame, boosterEngines, shipEngines: shipEnginesAt, atmo,
      // State of a vehicle at t (s after liftoff), Earth-fixed km / km/s
      shipState: t => t < TL.stage ? stackState(t, veh.booster.h) : ship.at(t),
      boosterState: t => t < TL.stage ? stackState(t, 0) : booster.at(t),
    };
    function stackState(t, dz) {
      const s = stackTrack.at(t), n = t < 0 ? UP : ascentAtt(t);
      return { r: add(s.r, mul(n, dz / 1000)), v: s.v, m: s.m };
    }
  }

  function solve3(A, b) {
    const M = A.map((row, i) => [...row, b[i]]);
    for (let c = 0; c < 3; c++) {
      let p = c;
      for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-14) return null;
      [M[c], M[p]] = [M[p], M[c]];
      for (let r = 0; r < 3; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k]; }
    }
    return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
  }

  // ─── A launched flight: the planned trajectory pinned to a liftoff date ─────────
  // Quacks like the other missions (pos, vel, events, phaseAt, nextEvent, tLaunch) so the clock,
  // timeline and auto-pacing work unchanged; kind 'starship' switches on the Starship views.
  const cache = new Map();
  const planned = (mission, recovery) => {
    const key = `${mission.id}|${recovery}`;
    if (!cache.has(key)) cache.set(key, plan(mission, { recovery }));
    return cache.get(key);
  };
  const fmtT = s => { const a = Math.abs(s); return `T${s < 0 ? '−' : '+'}${Math.floor(a / 3600)}:${String(Math.floor(a % 3600 / 60)).padStart(2, '0')}:${String(Math.floor(a % 60)).padStart(2, '0')}`; };
  function launch(mission, jdLaunch, opts = {}) {
    const recovery = opts.recovery || mission.booster.recovery;
    const F = planned(mission, recovery), TL = mission.timeline, T = F.t;
    const catchIt = recovery === 'catch', orbital = mission.ship.profile === 'orbital';
    const tl = (s) => jdLaunch + s / DAY;
    const kmh = v => Math.round(len(v) * 3600).toLocaleString('en-US');
    const altOf = st => len(st.r) - BODY.earth.radius;
    const shipAt = s => F.shipState(s), boostAt = s => F.boosterState(s);
    const nm = mission.payload.count, sat = { sim: ['星链模拟星', 'Starlink simulators'], v2mini: ['星链 V2 mini 卫星', 'Starlink V2 mini satellites'], v3: ['星链 V3 卫星', 'Starlink V3 satellites'] }[mission.payload.type];
    const splash = mission.ship.splash;
    const E = (t, key, zh, en, dzh, den, o = {}) => ({ t: tl(t), s: t, key, ...o, get label() { return tr(zh, en); }, get detail() { return tr(typeof dzh === 'function' ? dzh() : dzh, typeof den === 'function' ? den() : den); } });
    const at = (st, zh) => zh ? `高度 ${altOf(st).toFixed(1)} km，速度 ${kmh(st.v)} km/h` : `${altOf(st).toFixed(1)} km up at ${kmh(st.v)} km/h`;
    const ev = [
      E(-3, 'ignite', '猛禽发动机点火', 'Raptor ignition', `${F.veh.booster.n} 台发动机依次点火，压紧装置仍抓着助推器`, `The ${F.veh.booster.n} engines light in sequence while the clamps still hold the booster`),
      E(0, 'liftoff', '点火升空', 'Liftoff', () => `${F.veh.booster.n} 台猛禽发动机全推力，约 ${Math.round(F.veh.booster.n * RAPTORS[F.veh.booster.engine].fvac / G0 / 1000 * 0.94).toLocaleString()} 吨力`, () => `All ${F.veh.booster.n} Raptors at full thrust, about ${Math.round(F.veh.booster.n * RAPTORS[F.veh.booster.engine].fvac / G0 / 1000 * 0.94).toLocaleString()} tf`, { key2: 'pad' }),
      E(T.maxQ, 'maxq', '最大动压', 'Max-Q', () => `气动载荷最大：${(F.maxQ / 1000).toFixed(0)} kPa，${at(boostAt(T.maxQ), 1)}`, () => `Peak aerodynamic load, ${(F.maxQ / 1000).toFixed(0)} kPa, ${at(boostAt(T.maxQ))}`),
      E(TL.meco, 'meco', '助推器主发动机关机', 'Booster MECO', () => `大部分发动机关机，只留中心 3 台；${at(boostAt(TL.meco), 1)}`, () => `Most engines shut down, the centre 3 keep running; ${at(boostAt(TL.meco))}`),
      E(TL.stage, 'stage', '热分离', 'Hot staging', '飞船的 6 台发动机在分离前点火，火焰从热分离环的排气口喷出', "The ship's six engines light before separation, venting through the hot-stage ring"),
      E(TL.bb0, 'bb0', '助推器返航点火', 'Boostback burn', '助推器翻转 180°，13 台发动机点火，掉头飞回墨西哥湾 / 发射场', 'The booster flips around and fires 13 engines to head back'),
      E(TL.bb1, 'bb1', '返航点火结束', 'Boostback shutdown', () => `助推器沿抛物线滑行，最高约 ${Math.round(Math.max(...F.booster.r.map(r => len(r))) - BODY.earth.radius)} km`, () => `The booster coasts on an arc peaking near ${Math.round(Math.max(...F.booster.r.map(r => len(r))) - BODY.earth.radius)} km`),
    ];
    if (TL.hsj && F.ring) ev.push(E(TL.hsj, 'hsj', '抛离热分离环', 'Hot-stage jettison', '9 吨重的热分离环被抛掉，落入墨西哥湾', 'The 9 t hot-stage ring is dropped into the Gulf'));
    if (T.boosterTransonic) ev.push(E(T.boosterTransonic, 'btrans', '助推器跨音速', 'Booster transonic', '栅格舵控制着助推器尾部朝下高速下落', 'Grid fins steer the booster as it falls engines-first'));
    ev.push(
      E(TL.lb0, 'lb0', '助推器着陆点火', 'Booster landing burn', () => `13 台发动机点火刹车，然后只留中心 3 台；${at(boostAt(TL.lb0), 1)}`, () => `13 engines brake hard, then the centre 3 finish; ${at(boostAt(TL.lb0))}`),
      catchIt ? E(TL.land, 'catch', '筷子塔捕获', 'Tower catch', '发射塔的两根“筷子”机械臂在空中夹住助推器', "The tower's two \"chopstick\" arms catch the booster in mid-air")
        : E(TL.land, 'bsplash', '助推器墨西哥湾溅落', 'Booster splashdown', '在离岸约 10 km 的海面上悬停后关机，倾倒入海', 'Hovers over the Gulf about 10 km offshore, shuts down and tips over'),
      E(T.seco, 'seco', '飞船发动机关机（SECO）', 'Ship engine cutoff (SECO)', () => `${at(shipAt(T.seco), 1)}，${orbital ? '跨大气层轨道' : '亚轨道：近地点在大气层里'}`, () => `${at(shipAt(T.seco))}, ${orbital ? 'on a transatmospheric path' : 'suborbital: perigee inside the atmosphere'}`),
    );
    if (orbital && T.oibStart != null) ev.push(E(T.oibStart, 'oib', '入轨点火', 'Orbit insertion burn', `一台真空猛禽点火 ${(T.oib - T.oibStart).toFixed(0)} 秒，把近地点抬到 ${mission.ship.orbit.peri} km：进入轨道`, `One Raptor Vacuum fires for ${(T.oib - T.oibStart).toFixed(0)} s, raising perigee to ${mission.ship.orbit.peri} km: orbit`));
    ev.push(
      E(TL.deploy[0], 'deploy0', '星链部署开始', 'Payload deploy', `“Pez”舱门打开，${nm} 颗${sat[0]}逐颗滑出`, `The "Pez" door opens and ${nm} ${sat[1]} slide out one by one`),
      E(TL.deploy[1], 'deploy1', '部署完成', 'Deploy complete', `${nm} 颗全部释放${orbital ? '，留在轨道上' : '，它们将随后再入烧毁'}`, `All ${nm} released${orbital ? ' into orbit' : '; they will burn up on re-entry'}`),
    );
    if (TL.relight) ev.push(E(TL.relight[0], 'relight', '猛禽发动机太空重启', 'In-space Raptor relight', '一台海平面猛禽短暂点火，验证离轨点火能力', 'One sea-level Raptor fires briefly, proving it could do a deorbit burn'));
    if (orbital) ev.push(E(T.deorbit, 'deorbit', '离轨点火', 'Deorbit burn', `反向点火 ${T.deorbitDur.toFixed(0)} 秒，近地点降入大气层`, `A ${T.deorbitDur.toFixed(0)} s retrograde burn drops perigee into the atmosphere`));
    ev.push(
      E(T.entry, 'entry', '再入大气层', 'Atmospheric entry', () => `隔热瓦朝前，攻角约 62°；${at(shipAt(T.entry), 1)}，周围出现等离子体`, () => `Heat shield first at about 62° angle of attack; ${at(shipAt(T.entry))}, wrapped in plasma`),
    );
    if (T.shipTransonic) ev.push(E(T.shipTransonic, 'strans', '飞船跨音速', 'Ship transonic', '前后襟翼控制姿态，开始“腹部朝下”下落', 'Flaps steer as it settles into the belly-flop'));
    if (T.shipSubsonic) ev.push(E(T.shipSubsonic, 'ssub', '飞船亚音速', 'Ship subsonic', () => `以约 ${kmh(shipAt(T.shipSubsonic + 30).v)} km/h 的终端速度水平下落`, () => `Falling flat at a terminal speed of about ${kmh(shipAt(T.shipSubsonic + 30).v)} km/h`));
    ev.push(
      E(T.flip, 'flip', '着陆翻转', 'Landing flip', '海平面猛禽点火，船身从水平翻转成竖直', 'Sea-level Raptors light and swing the ship upright'),
      E(T.landBurn, 'lburn', '着陆点火', 'Landing burn', '减速到接近零，准备溅落', 'Braking to a near standstill'),
      E(T.landShip, 'splash', `${splash[0]}溅落`, `Splashdown, ${splash[1]}`, () => { const [la, lo] = latLonOf(F.shipLandR); return `飞船溅落在 ${la}, ${lo}`; }, () => { const [la, lo] = latLonOf(F.shipLandR); return `The ship splashes down at ${la}, ${lo}`; }),
    );
    ev.sort((a, b) => a.t - b.t);
    const KEY = new Set(['liftoff', 'maxq', 'meco', 'stage', 'bb0', 'lb0', 'catch', 'bsplash', 'seco', 'oib', 'deploy0', 'relight', 'deorbit', 'entry', 'flip', 'splash']);
    const coast = orbital ? 90 : 25;
    const world = (r, jd, earthPos) => add(earthPos || bodyPos('earth', jd), M3.apply(bodyRot('earth', jd), r));
    return {
      kind: 'starship', mission, F, recovery, tLaunch: jdLaunch, events: ev, target: 'earth', site: STARSHIP_PADS[mission.pad],
      get name() { return tr(mission.name[0], mission.name[1]); },
      get craft() { return tr('星舰', 'Starship'); },
      tOf: jd => (jd - jdLaunch) * DAY,
      fmtT,
      phaseAt(jd) { let cur = null; for (const e of ev) if (jd >= e.t) cur = e; return cur; },
      nextEvent(jd) { return ev.find(e => e.t > jd + 1e-7) || null; },
      // Suggested clock rate: real time through the busy ascent and landings, faster across coasts
      paceAt(jd) {
        const s = (jd - jdLaunch) * DAY;
        if (s < Math.max(TL.land, T.seco) + 10) return 1;
        if (s > T.landShip + 30) return null;
        let r = coast;
        if (s > TL.deploy[0] - 20 && s < TL.deploy[1] + 10) r = Math.min(r, orbital ? 12 : 5);
        if (s > T.entry - 20 && s < (T.shipSubsonic || T.flip)) r = Math.min(r, 6);
        if (s > (T.shipSubsonic || T.flip) - 5) r = Math.min(r, 2);
        for (const e of ev) {
          if (!KEY.has(e.key)) continue;
          const d = e.s - s;
          if (d > 0) r = Math.min(r, Math.max(1, d / 4));
          else if (d > -8) r = Math.min(r, 1.5);
        }
        if (s > T.flip - 25) r = 1;
        return r;
      },
      // Earth-fixed state → world (heliocentric ecliptic km)
      world,
      state(which, jd) { const s = (jd - jdLaunch) * DAY; return which === 'booster' ? boostAt(s) : shipAt(s); },
      pos(jd) { return world(shipAt((jd - jdLaunch) * DAY).r, jd); },
      worldOf(which, jd, earthPos) { return world(this.state(which, jd).r, jd, earthPos); },
      vel(jd) { const h = 0.5 / DAY; return V3.mul(V3.sub(this.pos(jd + h), this.pos(jd - h)), 1); },
    };
  }
  const latLonOf = r => { const u = norm(r), la = Math.asin(u[2]) / DEG, lo = Math.atan2(u[1], u[0]) / DEG; return [`${Math.abs(la).toFixed(1)}°${la >= 0 ? 'N' : 'S'}`, `${Math.abs(lo).toFixed(1)}°${lo >= 0 ? 'E' : 'W'}`]; };

  return { plan, launch, planned, atmo, RE, OMEGA, ecefOf, enu, upOf, eastOf, latLonOf, fmtT };
})();
