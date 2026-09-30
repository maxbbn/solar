'use strict';
// Patched-conic mission design. Every trajectory is an analytic function of time,
// so the simulation can run at any speed, backwards, or jump straight to any date.

function stumpC(z) {
  if (z > 1e-6) { const s = Math.sqrt(z); return (1 - Math.cos(s)) / z; }
  if (z < -1e-6) { const s = Math.sqrt(-z); return (Math.cosh(s) - 1) / -z; }
  return 0.5 - z / 24 + z * z / 720;
}
function stumpS(z) {
  if (z > 1e-6) { const s = Math.sqrt(z); return (s - Math.sin(s)) / (s * s * s); }
  if (z < -1e-6) { const s = Math.sqrt(-z); return (Math.sinh(s) - s) / (s * s * s); }
  return 1 / 6 - z / 120 + z * z / 5040;
}

// Two-body orbit defined by a state vector at epoch t0 (JD); universal-variable propagation
class Conic {
  constructor(r, v, mu, t0) {
    this.r0 = r; this.v0 = v; this.mu = mu; this.t0 = t0;
    this.R0 = V3.len(r); this.vr0 = V3.dot(r, v) / this.R0;
    this.alpha = 2 / this.R0 - V3.dot(v, v) / mu;
    this.period = this.alpha > 1e-12 ? 2 * Math.PI / Math.sqrt(mu * this.alpha ** 3) : Infinity;
  }
  state(jd) {
    const mu = this.mu, sm = Math.sqrt(mu), r0 = this.R0, vr0 = this.vr0, a = this.alpha;
    let dt = (jd - this.t0) * DAY;
    if (isFinite(this.period)) dt -= this.period * Math.round(dt / this.period);
    if (Math.abs(dt) < 1e-9) return [this.r0.slice(), this.v0.slice()];
    let x;
    if (a > 1e-12) x = sm * a * dt;
    else if (a < -1e-12) {
      const aa = 1 / a, arg = (-2 * mu * a * dt) / (V3.dot(this.r0, this.v0) + Math.sign(dt) * Math.sqrt(-mu * aa) * (1 - r0 * a));
      x = arg > 0 ? Math.sign(dt) * Math.sqrt(-aa) * Math.log(arg) : sm * Math.abs(a) * dt;
    } else x = sm * dt / r0;
    for (let i = 0; i < 80; i++) {
      const z = a * x * x, C = stumpC(z), S = stumpS(z);
      const F = r0 * vr0 / sm * x * x * C + (1 - a * r0) * x * x * x * S + r0 * x - sm * dt;
      const dF = r0 * vr0 / sm * x * (1 - a * x * x * S) + (1 - a * r0) * x * x * C + r0;
      const dx = F / dF;
      x -= dx;
      if (Math.abs(dx) < 1e-10 * Math.max(1, Math.abs(x))) break;
    }
    const z = a * x * x, C = stumpC(z), S = stumpS(z);
    const f = 1 - x * x / r0 * C, g = dt - x * x * x * S / sm;
    const r = V3.add(V3.mul(this.r0, f), V3.mul(this.v0, g)), R = V3.len(r);
    const fd = sm / (R * r0) * (a * x * x * x * S - x), gd = 1 - x * x / R * C;
    return [r, V3.add(V3.mul(this.r0, fd), V3.mul(this.v0, gd))];
  }
  pos(jd) { return this.state(jd)[0]; }
  // Time (days) from epoch until next periapsis passage (hyperbolic: the only one)
  timeToPeri() {
    const r = this.r0, v = this.v0, mu = this.mu, R = this.R0;
    const ev = V3.mul(V3.sub(V3.mul(r, V3.dot(v, v) - mu / R), V3.mul(v, V3.dot(r, v))), 1 / mu);
    const e = V3.len(ev);
    let nu = V3.angle(ev, r);
    if (V3.dot(r, v) < 0) nu = -nu;
    if (e > 1) {
      const F = 2 * Math.atanh(Math.sqrt((e - 1) / (e + 1)) * Math.tan(nu / 2));
      const n = Math.sqrt(mu * (-this.alpha) ** 3);
      return -(e * Math.sinh(F) - F) / n / DAY;
    }
    const E = 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * Math.tan(nu / 2));
    const n = Math.sqrt(mu * this.alpha ** 3);
    let t = -(E - e * Math.sin(E)) / n;
    if (t < 0) t += 2 * Math.PI / n;
    return t / DAY;
  }
}

// Lambert problem, zero revolutions, prograde (Curtis Alg. 5.2 with bracketing)
function lambert(r1, r2, dt, mu) {
  const R1 = V3.len(r1), R2 = V3.len(r2);
  let th = Math.acos(Math.max(-1, Math.min(1, V3.dot(r1, r2) / (R1 * R2))));
  if (V3.cross(r1, r2)[2] < 0) th = 2 * Math.PI - th;
  const A = Math.sin(th) * Math.sqrt(R1 * R2 / (1 - Math.cos(th)));
  if (!isFinite(A) || Math.abs(A) < 1e-6) return null;
  const smu = Math.sqrt(mu);
  const y = z => R1 + R2 + A * (z * stumpS(z) - 1) / Math.sqrt(stumpC(z));
  const F = z => { const yz = y(z); if (yz < 0) return -1; return Math.pow(yz / stumpC(z), 1.5) * stumpS(z) + A * Math.sqrt(yz) - smu * dt; };
  let lo = -40, hi = 4 * Math.PI * Math.PI - 1e-7;
  while (F(lo) > 0 && lo > -4e4) lo *= 2;
  if (F(hi) < 0) return null;
  for (let i = 0; i < 70; i++) { const m = (lo + hi) / 2; if (F(m) > 0) hi = m; else lo = m; }
  const yz = y((lo + hi) / 2);
  const f = 1 - yz / R1, g = A * Math.sqrt(yz / mu), gd = 1 - yz / R2;
  return [V3.mul(V3.sub(r2, V3.mul(r1, f)), 1 / g), V3.mul(V3.sub(V3.mul(r2, gd), r1), 1 / g)];
}

const smoothstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const LAUNCH_SITES = [
  biProp({ id: 'wenchang', lat: 19.614, lon: 110.951 }, 'name', '文昌', 'Wenchang'),
  biProp({ id: 'jiuquan', lat: 40.958, lon: 100.291 }, 'name', '酒泉', 'Jiuquan'),
  biProp({ id: 'canaveral', lat: 28.573, lon: -80.649 }, 'name', '卡纳维拉尔角', 'Cape Canaveral'),
  biProp({ id: 'baikonur', lat: 45.920, lon: 63.342 }, 'name', '拜科努尔', 'Baikonur'),
];

const PARK_ALT = 200, ASCENT = 600 / DAY; // parking orbit altitude (km), ascent duration (days)

// Picks the parking-orbit coast so the ascent heads downrange from the launch site.
// Returns { tLaunch, tIns } for a burn at tBurn in the parking plane (pHat, nHat).
function planParking(site, tBurn, pHat, nHat) {
  const rp = BODY.earth.radius + PARK_ALT, w = Math.sqrt(BODY.earth.mu / rp ** 3), P = 2 * Math.PI / w / DAY;
  let best = null;
  for (let c = 0.3 * P; c < 1.3 * P; c += 15 / DAY) {
    const tLaunch = tBurn - c - ASCENT;
    const siteDir = V3.norm(V3.sub(surfacePos('earth', site.lat, site.lon, 0, tLaunch), bodyPos('earth', tLaunch)));
    const aim = V3.rot(pHat, nHat, -w * (c + 240 / DAY) * DAY);
    const ang = V3.angle(siteDir, aim);
    if (!best || ang < best.ang) best = { ang, c };
  }
  return { tLaunch: tBurn - best.c - ASCENT, tIns: tBurn - best.c };
}

// Builds the launch → parking orbit segments shared by all missions
function launchSegments(site, tLaunch, tIns, tBurn, pHat, nHat) {
  const rp = BODY.earth.radius + PARK_ALT;
  const park = new Conic(V3.mul(pHat, rp), V3.mul(V3.cross(nHat, pHat), Math.sqrt(BODY.earth.mu / rp)), BODY.earth.mu, tBurn);
  const sitePos = t => surfacePos('earth', site.lat, site.lon, 0.03, t);
  const ascent = t => {
    const s = (t - tLaunch) / (tIns - tLaunch), E = bodyPos('earth', t);
    const a = V3.norm(V3.sub(sitePos(t), E)), b = V3.norm(park.pos(t));
    const dir = V3.slerp(a, b, s * s * (3 - 2 * s)), alt = PARK_ALT * (1 - (1 - s) * (1 - s));
    return V3.add(E, V3.mul(dir, BODY.earth.radius + 0.03 + alt));
  };
  return {
    park,
    segs: [
      { t0: -Infinity, t1: tLaunch, fn: sitePos },
      { t0: tLaunch, t1: tIns, fn: ascent },
      { t0: tIns, t1: tBurn, fn: t => V3.add(bodyPos('earth', t), park.pos(t)) },
    ],
  };
}

// Mission event with live bilingual text (label/detail are functions evaluated on read)
const ev = (t, label, detail) => ({ t, get label() { return label(); }, get detail() { return detail(); } });

class Mission {
  constructor(o) { Object.assign(this, o); }
  get name() { return tr(this.names[0], this.names[1]); }
  get craft() { return tr(this.names[2], this.names[3]); }
  pos(jd) {
    const s = this.segs;
    for (let i = s.length - 1; i >= 0; i--) if (jd >= s[i].t0) return s[i].fn(jd);
    return s[0].fn(jd);
  }
  vel(jd) { const h = 1 / DAY; return V3.mul(V3.sub(this.pos(jd + h), this.pos(jd - h)), 1 / 2); }
  phaseAt(jd) {
    let cur = null;
    for (const e of this.events) if (jd >= e.t) cur = e;
    return cur;
  }
  nextEvent(jd) { return this.events.find(e => e.t > jd + 1e-7) || null; }
  // Velocity of the reference the craft "flies relative to", blended smoothly across
  // sphere-of-influence handovers so the craft's attitude never snaps.
  refVel(jd) {
    const b = this.blend;
    if (this.kind === 'moon') return V3.lerp(bodyVel('earth', jd), bodyVel('moon', jd), smoothstep(b.aA, b.aB, jd));
    if (jd < b.aA) return V3.mul(bodyVel('earth', jd), 1 - smoothstep(b.dA, b.dB, jd));
    return V3.mul(bodyVel(this.target, jd), smoothstep(b.aA, b.aB, jd));
  }
}

// ─── Earth → Moon (patched conic, Bate–Mueller–White style) ────────────────
const MOON_SOI = 66183;

function moonTransferDesign(tBurn, v0, rpTarget) {
  const muE = BODY.earth.mu, rE0 = BODY.earth.radius + PARK_ALT;
  const h = rE0 * v0, e = h * h / (muE * rE0) - 1, p = h * h / muE, a = p / (1 - e * e);
  const n = Math.sqrt(muE / a ** 3);
  const evalLam = lam => {
    let tArr = tBurn + 3, geo;
    for (let it = 0; it < 6; it++) {
      const D = moonGeo(tArr), Dp = moonGeo(tArr + 1 / 1440), Vm = V3.mul(V3.sub(Dp, D), 1 / 60);
      const dH = V3.norm(D), nH = V3.norm(V3.cross(D, Vm)), eH = V3.cross(nH, dH);
      const rel = V3.add(V3.mul(dH, -Math.cos(lam) * MOON_SOI), V3.mul(eH, Math.sin(lam) * MOON_SOI));
      const r1 = V3.add(D, rel), R1 = V3.len(r1);
      const cnu = (p / R1 - 1) / e;
      if (cnu < -1 || cnu > 1) return null;
      const nu = Math.acos(cnu);
      const E = 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * Math.tan(nu / 2));
      const tof = (E - e * Math.sin(E)) / n / DAY;
      const newArr = tBurn + tof;
      geo = { D, Vm, nH, rel, r1, R1, nu, tArr: newArr };
      if (Math.abs(newArr - tArr) < 1e-7) break;
      tArr = newArr;
    }
    const r1H = V3.norm(geo.r1), pH = V3.sub(V3.mul(r1H, Math.cos(geo.nu)), V3.mul(V3.cross(geo.nH, r1H), Math.sin(geo.nu)));
    const qH = V3.cross(geo.nH, pH);
    const v1 = V3.mul(V3.add(V3.mul(pH, -Math.sin(geo.nu)), V3.mul(qH, e + Math.cos(geo.nu))), muE / h);
    const vrel = V3.sub(v1, geo.Vm);
    const hm = V3.cross(geo.rel, vrel), muM = BODY.moon.mu;
    const em = V3.len(V3.sub(V3.mul(V3.cross(vrel, hm), 1 / muM), V3.norm(geo.rel)));
    const rp = V3.dot(hm, hm) / muM / (1 + em);
    return { ...geo, pH, qH, v1, vrel, rp, signed: rp * Math.sign(V3.dot(hm, geo.nH)), approaching: V3.dot(geo.rel, vrel) < 0 };
  };
  let prev = null, best = null;
  for (let deg = -85; deg <= 85; deg += 1) {
    const cur = evalLam(deg * DEG);
    if (cur && prev && cur.approaching && prev.approaching) {
      for (const target of [rpTarget, -rpTarget]) {
        if ((prev.signed - target) * (cur.signed - target) <= 0) {
          let lo = (deg - 1) * DEG, hi = deg * DEG, flo = prev.signed - target;
          for (let i = 0; i < 50; i++) {
            const m = (lo + hi) / 2, r = evalLam(m);
            if (!r) break;
            if ((r.signed - target) * flo <= 0) hi = m; else { lo = m; flo = r.signed - target; }
          }
          const sol = evalLam((lo + hi) / 2);
          if (sol && Math.abs(Math.abs(sol.signed) - rpTarget) < 5 && (!best || sol.tArr < best.tArr)) best = sol;
        }
      }
    }
    prev = cur;
  }
  return best;
}

function planMoonMission(site, now) {
  const rpTarget = BODY.moon.radius + 100, v0 = 10.93;
  const rp = BODY.earth.radius + PARK_ALT, w = Math.sqrt(BODY.earth.mu / rp ** 3), P = 2 * Math.PI / w / DAY;
  // The transfer lies in the Moon's orbital plane. Launch when Earth's rotation carries
  // the site closest to that plane (the daily launch window), then pick the coast.
  let design = moonTransferDesign(now + 0.5, v0, rpTarget);
  if (!design) return null;
  let tLaunch0 = now + 60 / DAY, bestCost = Infinity;
  for (let t = now + 60 / DAY; t < now + 1; t += 60 / DAY) {
    const sd = V3.norm(V3.sub(surfacePos('earth', site.lat, site.lon, 0, t + ASCENT / 2), bodyPos('earth', t + ASCENT / 2)));
    const cost = Math.abs(Math.asin(V3.dot(sd, design.nH))) / DEG + 0.3 * (t - now) * 24;
    if (cost < bestCost) { bestCost = cost; tLaunch0 = t; }
  }
  const tIns0 = tLaunch0 + ASCENT;
  design = moonTransferDesign(tIns0 + 0.8 * P, v0, rpTarget);
  if (!design) return null;
  let bestC = 0.8 * P, bestA = 9;
  for (let c = 0.3 * P; c < 1.3 * P; c += 15 / DAY) {
    const siteDir = V3.norm(V3.sub(surfacePos('earth', site.lat, site.lon, 0, tLaunch0), bodyPos('earth', tLaunch0)));
    const aim = V3.rot(design.pH, design.nH, -w * (c + 240 / DAY) * DAY);
    const ang = V3.angle(siteDir, aim);
    if (ang < bestA) { bestA = ang; bestC = c; }
  }
  const tBurn = tIns0 + bestC;
  design = moonTransferDesign(tBurn, v0, rpTarget);
  if (!design) return null;
  const muE = BODY.earth.mu, pH = design.pH, nH = design.nH;
  const { park, segs } = launchSegments(site, tLaunch0, tIns0, tBurn, pH, nH);
  const transfer = new Conic(V3.mul(pH, rp), V3.mul(design.qH, v0), muE, tBurn);
  const approach = new Conic(design.rel, design.vrel, BODY.moon.mu, design.tArr);
  const tPeri = design.tArr + approach.timeToPeri();
  const [rP, vP] = approach.state(tPeri);
  const vCirc = Math.sqrt(BODY.moon.mu / V3.len(rP));
  const lunarOrbit = new Conic(rP, V3.mul(V3.norm(vP), vCirc), BODY.moon.mu, tPeri);
  segs.push(
    { t0: tBurn, t1: design.tArr, fn: t => V3.add(bodyPos('earth', t), transfer.pos(t)) },
    { t0: design.tArr, t1: tPeri, fn: t => V3.add(bodyPos('moon', t), approach.pos(t)) },
    { t0: tPeri, t1: Infinity, fn: t => V3.add(bodyPos('moon', t), lunarOrbit.pos(t)) },
  );
  const dvTLI = v0 - Math.sqrt(muE / rp), dvLOI = V3.len(vP) - vCirc;
  return new Mission({
    kind: 'moon', target: 'moon', names: ['探月任务', 'Moon mission', '月球探测器', 'Lunar probe'], site, segs,
    blend: { aA: design.tArr - 0.25, aB: design.tArr + 0.05 },
    tLaunch: tLaunch0, tBurn, tArr: design.tArr, tPeri,
    dv: dvTLI + dvLOI + 9.4,
    stats: [['地月转移加速 (TLI)', dvTLI], ['近月制动 (LOI)', dvLOI]],
    burns: [{ t: tBurn, dur: 360 / DAY }, { t: tPeri, dur: 240 / DAY }],
    events: [
      ev(tLaunch0, () => tr('点火升空', 'Liftoff'), () => tr(`从${site.name}发射，约 10 分钟进入 ${PARK_ALT} km 停泊轨道`, `Lifting off from ${site.name}; about 10 minutes to a ${PARK_ALT} km parking orbit`)),
      ev(tIns0, () => tr('进入停泊轨道', 'Parking orbit'), () => tr(`绕地球滑行，速度 ${Math.sqrt(muE / rp).toFixed(2)} km/s，约 88 分钟一圈`, `Coasting around Earth at ${Math.sqrt(muE / rp).toFixed(2)} km/s, one lap every 88 minutes`)),
      ev(tBurn, () => tr('地月转移加速', 'Trans-lunar injection'), () => tr(`发动机加速 ${dvTLI.toFixed(2)} km/s，飞向约 38 万公里外的月球`, `Engine adds ${dvTLI.toFixed(2)} km/s, heading for the Moon about 384,000 km away`)),
      ev(design.tArr, () => tr('进入月球引力范围', "Entering the Moon's sphere of influence"), () => tr('距月球 6.6 万公里，此后月球引力占主导', "66,000 km from the Moon; from here the Moon's gravity dominates")),
      ev(tPeri, () => tr('近月制动', 'Lunar orbit insertion'), () => tr(`在距月面 100 km 处减速 ${dvLOI.toFixed(2)} km/s，被月球捕获`, `Braking by ${dvLOI.toFixed(2)} km/s 100 km above the surface; captured by the Moon`)),
      ev(tPeri + 0.08, () => tr('环月飞行', 'Lunar orbit'), () => tr(`在 100 km 高的环月轨道上，约 ${(lunarOrbit.period / 60).toFixed(0)} 分钟一圈`, `Circling the Moon at 100 km, one lap every ${(lunarOrbit.period / 60).toFixed(0)} minutes`)),
    ],
    paths: [
      { frame: 'earth', t0: tLaunch0, t1: design.tArr + 0.4 },
      { frame: 'moon', t0: design.tArr, t1: tPeri + lunarOrbit.period / DAY },
    ],
  });
}

// ─── Earth → planet (Lambert + hyperbolic departure/arrival) ────────────────
const TRANSFER_CFG = {
  mars: { search: 820, depStep: 2, tof: [120, 420, 4], rpAlt: 400, raAlt: 400, names: ['火星任务', 'Mars mission', '火星探测器', 'Mars probe'] },
  venus: { search: 600, depStep: 2, tof: [80, 240, 4], rpAlt: 400, raAlt: 400, names: ['金星任务', 'Venus mission', '金星探测器', 'Venus probe'] },
  jupiter: { search: 420, depStep: 3, tof: [480, 1200, 12], rpAlt: 4 * 71492, raAlt: 100 * 71492, names: ['木星任务', 'Jupiter mission', '木星探测器', 'Jupiter probe'] },
};

function captureDv(target, vinf) {
  const cfg = TRANSFER_CFG[target], b = BODY[target];
  const rp = b.radius + cfg.rpAlt, ra = b.radius + cfg.raAlt, mu = b.mu;
  return Math.sqrt(vinf * vinf + 2 * mu / rp) - Math.sqrt(mu * (2 / rp - 2 / (rp + ra)));
}
function departDv(vinf) {
  const rp = BODY.earth.radius + PARK_ALT, mu = BODY.earth.mu;
  return Math.sqrt(vinf * vinf + 2 * mu / rp) - Math.sqrt(mu / rp);
}

// Porkchop grid: total Δv over departure date × time of flight
function porkchop(target, jd0) {
  const cfg = TRANSFER_CFG[target], step = cfg.depStep;
  const nDep = Math.floor(cfg.search / step);
  const tofs = [];
  for (let t = cfg.tof[0]; t <= cfg.tof[1]; t += cfg.tof[2]) tofs.push(t);
  const earth = [], evel = [];
  for (let i = 0; i < nDep; i++) { const t = jd0 + i * step; earth.push(bodyPos('earth', t)); evel.push(bodyVel('earth', t)); }
  const tgtCache = new Map();
  const tgt = t => {
    const k = Math.round(t * 4);
    if (!tgtCache.has(k)) tgtCache.set(k, [bodyPos(target, t), bodyVel(target, t)]);
    return tgtCache.get(k);
  };
  const grid = new Float32Array(nDep * tofs.length).fill(NaN);
  let best = null;
  for (let i = 0; i < nDep; i++) {
    for (let j = 0; j < tofs.length; j++) {
      const td = jd0 + i * step, ta = td + tofs[j], [rP, vP] = tgt(ta);
      const sol = lambert(earth[i], rP, tofs[j] * DAY, BODY.sun.mu);
      if (!sol) continue;
      const vi1 = V3.len(V3.sub(sol[0], evel[i])), vi2 = V3.len(V3.sub(sol[1], vP));
      const dv = departDv(vi1) + captureDv(target, vi2);
      grid[i * tofs.length + j] = dv;
      if (!best || dv < best.dv) best = { dv, td, tof: tofs[j], i, j };
    }
  }
  // Prefer the earliest window that is nearly as cheap as the global optimum
  const rowBest = [];
  for (let i = 0; i < nDep; i++) {
    let b = null;
    for (let j = 0; j < tofs.length; j++) { const v = grid[i * tofs.length + j]; if (v === v && (!b || v < b.dv)) b = { dv: v, td: jd0 + i * step, tof: tofs[j], i, j }; }
    rowBest.push(b);
  }
  for (let i = 1; i < nDep - 1; i++) {
    const a = rowBest[i - 1], b = rowBest[i], c = rowBest[i + 1];
    if (a && b && c && b.dv <= a.dv && b.dv <= c.dv && b.dv < best.dv * 1.15) { best = b; break; }
  }
  return { grid, nDep, tofs, jd0, step, best, target };
}

// Best time of flight for a fixed departure date
function bestTofFor(target, td) {
  const cfg = TRANSFER_CFG[target], rE = bodyPos('earth', td), vE = bodyVel('earth', td);
  let best = null;
  for (let tof = cfg.tof[0]; tof <= cfg.tof[1]; tof += cfg.tof[2] / 2) {
    const ta = td + tof, sol = lambert(rE, bodyPos(target, ta), tof * DAY, BODY.sun.mu);
    if (!sol) continue;
    const dv = departDv(V3.len(V3.sub(sol[0], vE))) + captureDv(target, V3.len(V3.sub(sol[1], bodyVel(target, ta))));
    if (!best || dv < best.dv) best = { dv, td, tof };
  }
  return best;
}

// Hyperbola with periapsis at t (JD), asymptote along vinfVec (outbound if dir=+1, inbound if -1)
function hyperbola(mu, rp, vinfVec, nHat, t, dir) {
  const vinf = V3.len(vinfVec), u0 = V3.norm(vinfVec);
  const e = 1 + rp * vinf * vinf / mu, nuInf = Math.acos(-1 / e);
  const u = dir > 0 ? u0 : V3.mul(u0, -1), w = V3.cross(nHat, u);
  const pH = dir > 0
    ? V3.sub(V3.mul(u, Math.cos(nuInf)), V3.mul(w, Math.sin(nuInf)))
    : V3.add(V3.mul(u, Math.cos(nuInf)), V3.mul(w, Math.sin(nuInf)));
  const vp = Math.sqrt(vinf * vinf + 2 * mu / rp);
  return { conic: new Conic(V3.mul(pH, rp), V3.mul(V3.cross(nHat, pH), vp), mu, t), pH, vp };
}

function planPlanetMission(target, site, td, tof) {
  const cfg = TRANSFER_CFG[target], tb = BODY[target];
  const ta = td + tof;
  const rE = bodyPos('earth', td), vE = bodyVel('earth', td), rT = bodyPos(target, ta), vT = bodyVel(target, ta);
  const sol = lambert(rE, rT, tof * DAY, BODY.sun.mu);
  if (!sol) return null;
  const vinfD = V3.sub(sol[0], vE), vinfA = V3.sub(sol[1], vT);
  const cruise = new Conic(rE, sol[0], BODY.sun.mu, td);
  // Departure plane contains the launch site and the outgoing asymptote, flown eastward
  const earthPole = poleFrame(BODY.earth).filter((_, i) => i % 3 === 2);
  const rp = BODY.earth.radius + PARK_ALT;
  const siteDir0 = V3.norm(V3.sub(surfacePos('earth', site.lat, site.lon, 0, td - 0.07), rE));
  let nH, dep, tLaunch, tIns, siteDir = siteDir0;
  for (let it = 0; it < 3; it++) { // plane through the site at liftoff; liftoff depends on the plane
    nH = V3.norm(V3.cross(siteDir, V3.norm(vinfD)));
    if (V3.dot(nH, earthPole) < 0) nH = V3.mul(nH, -1);
    dep = hyperbola(BODY.earth.mu, rp, vinfD, nH, td, +1);
    ({ tLaunch, tIns } = planParking(site, td, dep.pH, nH));
    siteDir = V3.norm(V3.sub(surfacePos('earth', site.lat, site.lon, 0, tLaunch + ASCENT / 2), bodyPos('earth', tLaunch + ASCENT / 2)));
  }
  const { segs } = launchSegments(site, tLaunch, tIns, td, dep.pH, nH);
  // Arrival: near-equatorial capture orbit
  const tPole = poleFrame(tb).filter((_, i) => i % 3 === 2), uA = V3.norm(vinfA);
  let nA = V3.sub(tPole, V3.mul(uA, V3.dot(tPole, uA)));
  nA = V3.len(nA) < 1e-6 ? V3.norm(V3.cross(uA, [0, 0, 1])) : V3.norm(nA);
  const rpA = tb.radius + cfg.rpAlt, raA = tb.radius + cfg.raAlt;
  const arr = hyperbola(tb.mu, rpA, vinfA, nA, ta, -1);
  const vCap = Math.sqrt(tb.mu * (2 / rpA - 2 / (rpA + raA)));
  const capture = new Conic(V3.mul(arr.pH, rpA), V3.mul(V3.cross(nA, arr.pH), vCap), tb.mu, ta);
  // Blend windows sized to each sphere of influence
  const soiE = 925000, soiT = { mars: 577000, venus: 616000, jupiter: 48.2e6 }[target];
  const tsE = soiE / V3.len(vinfD) / DAY, tsT = soiT / V3.len(vinfA) / DAY;
  const dA = td + 0.25 * tsE, dB = td + 1.2 * tsE, aA = ta - 1.2 * tsT, aB = ta - 0.25 * tsT;
  const helio = t => cruise.pos(t);
  const nearE = t => V3.add(bodyPos('earth', t), dep.conic.pos(t));
  const nearT = t => V3.add(bodyPos(target, t), arr.conic.pos(t));
  segs.push(
    { t0: td, t1: dB, fn: t => { const w = smoothstep(dA, dB, t); return w <= 0 ? nearE(t) : V3.lerp(nearE(t), helio(t), w); } },
    { t0: dB, t1: aA, fn: helio },
    { t0: aA, t1: ta, fn: t => { const w = smoothstep(aA, aB, t); return w >= 1 ? nearT(t) : V3.lerp(helio(t), nearT(t), w); } },
    { t0: ta, t1: Infinity, fn: t => V3.add(bodyPos(target, t), capture.pos(t)) },
  );
  const dvD = dep.vp - Math.sqrt(BODY.earth.mu / rp), dvA = arr.vp - vCap;
  const circ = cfg.raAlt === cfg.rpAlt;
  const orbitTxt = () => circ ? tr(`${cfg.rpAlt} km 高的圆轨道`, `a ${cfg.rpAlt} km circular orbit`) : tr('大椭圆捕获轨道', 'a long elliptical capture orbit');
  return new Mission({
    kind: 'planet', target, names: cfg.names, site, segs,
    blend: { dA, dB, aA, aB },
    tLaunch, tBurn: td, tArr: ta, tPeri: ta, tof,
    dv: dvD + dvA + 9.4,
    stats: [['离开地球加速', dvD], ['捕获制动', dvA], ['出发剩余速度 v∞', V3.len(vinfD)], ['到达相对速度 v∞', V3.len(vinfA)]],
    burns: [{ t: td, dur: 600 / DAY }, { t: ta, dur: 900 / DAY }],
    events: [
      ev(tLaunch, () => tr('点火升空', 'Liftoff'), () => tr(`从${site.name}发射，约 10 分钟进入停泊轨道`, `Lifting off from ${site.name}; about 10 minutes to parking orbit`)),
      ev(tIns, () => tr('进入停泊轨道', 'Parking orbit'), () => tr('在 200 km 高度绕地球滑行，等待最佳点火位置', 'Coasting around Earth at 200 km, waiting for the right spot to fire')),
      ev(td, () => tr(`${tb.name}转移加速`, `${tb.name} transfer burn`), () => tr(`加速 ${dvD.toFixed(2)} km/s，逃离地球引力，进入绕太阳的转移轨道`, `Adding ${dvD.toFixed(2)} km/s to escape Earth onto a transfer orbit around the Sun`)),
      ev(td + tsE, () => tr('离开地球引力范围', "Leaving Earth's sphere of influence"), () => tr('距地球约 92 万公里，此后主要受太阳引力支配', "About 920,000 km out; from here the Sun's gravity dominates")),
      ev(td + tof / 2, () => tr('行星际巡航', 'Interplanetary cruise'), () => tr(`飞行 ${Math.round(tof)} 天，沿椭圆轨道“追赶”${tb.name}`, `A ${Math.round(tof)}-day flight along an ellipse that "catches up" with ${tb.name}`)),
      ev(ta - tsT, () => tr(`进入${tb.name}引力范围`, `Entering ${tb.name}'s sphere of influence`), () => tr(`${tb.name}引力开始主导`, `${tb.name}'s gravity takes over`)),
      ev(ta, () => tr('捕获制动', 'Orbit insertion'), () => tr(`在近${tb.name}点减速 ${dvA.toFixed(2)} km/s，进入${orbitTxt()}`, `Braking by ${dvA.toFixed(2)} km/s at closest approach into ${orbitTxt()}`)),
      ev(ta + 0.1, () => tr(`环绕${tb.name}`, `Orbiting ${tb.name}`), () => tr(`任务完成：探测器已成为${tb.name}的人造卫星`, `Mission complete: the probe is now an artificial satellite of ${tb.name}`)),
    ],
    paths: [
      { frame: 'earth', t0: tLaunch, t1: td + 1.5 * tsE },
      { frame: 'sun', t0: td, t1: ta },
      { frame: target, t0: ta - 1.2 * tsT, t1: ta + Math.min(capture.period / DAY, 30) },
    ],
  });
}
