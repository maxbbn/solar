'use strict';
// International Space Station: orbit from a real TLE (CelesTrak, epoch 2026-09-29),
// propagated with J2 secular precession and the TLE's drag term. Accurate to a few
// seconds of along-track timing for days around the epoch; drifts further away.
const ISS_TLE = [
  '1 25544U 98067A   26272.81986231  .00003749  00000+0  76988-4 0  9991',
  '2 25544  51.6313 142.2618 0007070 203.5720 156.4945 15.48690662587975',
];

const ISS = (() => {
  const l1 = ISS_TLE[0], l2 = ISS_TLE[1];
  const yy = +l1.slice(18, 20), doy = +l1.slice(20, 32);
  const epoch = jdFromMs(Date.UTC(2000 + yy, 0, 1)) + doy - 1;
  const ndot2 = +l1.slice(33, 43);                 // (dn/dt)/2, rev/day²
  const inc = +l2.slice(8, 16) * DEG, raan0 = +l2.slice(17, 25) * DEG;
  const ecc = +('0.' + l2.slice(26, 33).trim()), argp0 = +l2.slice(34, 42) * DEG;
  const M0 = +l2.slice(43, 51) * DEG, n0 = +l2.slice(52, 63); // rev/day
  const mu = BODY.earth.mu, J2 = 1.08263e-3, Re = 6378.137;

  function geo(jd) { // Earth-centred ecliptic J2000, km
    const t = jd - epoch;
    const n = n0 + 2 * ndot2 * t;                   // rev/day
    const nr = n * 2 * Math.PI / DAY;               // rad/s
    const a = Math.cbrt(mu / (nr * nr)), p = a * (1 - ecc * ecc);
    const k = 1.5 * J2 * (Re / p) ** 2 * nr * DAY;  // rad/day
    const raan = raan0 - k * Math.cos(inc) * t;
    const argp = argp0 + 0.5 * k * (5 * Math.cos(inc) ** 2 - 1) * t;
    const M = M0 + 2 * Math.PI * (n0 * t + ndot2 * t * t);
    const E = solveKepler(M, ecc);
    const xp = a * (Math.cos(E) - ecc), yp = a * Math.sqrt(1 - ecc * ecc) * Math.sin(E);
    const cw = Math.cos(argp), sw = Math.sin(argp), cO = Math.cos(raan), sO = Math.sin(raan), ci = Math.cos(inc), si = Math.sin(inc);
    const eq = [
      (cw * cO - sw * sO * ci) * xp + (-sw * cO - cw * sO * ci) * yp,
      (cw * sO + sw * cO * ci) * xp + (-sw * sO + cw * cO * ci) * yp,
      (sw * si) * xp + (cw * si) * yp,
    ];
    // TLE frame is equator/equinox of date: take it to the ecliptic, then undo precession to J2000
    const ecl = eqToEcl(eq), pr = -1.3969713 * DEG * (jd - J2000) / 36525, cp = Math.cos(pr), sp = Math.sin(pr);
    return [ecl[0] * cp - ecl[1] * sp, ecl[0] * sp + ecl[1] * cp, ecl[2]];
  }
  const period = DAY / n0 / 60; // minutes
  return {
    epoch, period, inc: inc / DEG,
    cupola: [0, 6, -3.0], // camera spot inside the Cupola, station frame (m); matches buildISSModel
    geo,
    pos: (jd, earthPos) => V3.add(earthPos || bodyPos('earth', jd), geo(jd)),
    velGeo(jd) { const h = 0.5 / DAY; return V3.mul(V3.sub(geo(jd + h), geo(jd - h)), 1); },
    // Station frame: x forward (velocity), y port, z zenith
    frame(jd) {
      const r = geo(jd), up = V3.norm(r), v = ISS.velGeo(jd);
      const F = V3.norm(V3.sub(v, V3.mul(up, V3.dot(v, up))));
      return { F, port: V3.cross(up, F), up, r };
    },
    // Next time the ISS is visible from a site: observer in darkness, station sunlit and >25° up
    findPass(siteFrameAt, jd0, days = 4) {
      const step = 20 / DAY;
      const test = t => {
        const pos = { earth: bodyPos('earth', t), sun: [0, 0, 0] }, f = siteFrameAt(t, pos), p = ISS.pos(t, pos.earth);
        const d = V3.norm(V3.sub(p, f.C)), alt = Math.asin(V3.dot(d, f.up));
        const sunAlt = Math.asin(V3.dot(V3.norm(V3.sub(pos.sun, f.C)), f.up));
        const lit = sunVisibleFraction(p, pos.sun, pos.earth, BODY.earth.radius * 1.02) > 0.5;
        return { alt, ok: alt > 25 * DEG && sunAlt < -6 * DEG && lit };
      };
      for (let t = jd0 + step; t < jd0 + days; t += step) {
        if (!test(t).ok) continue;
        let peak = t, best = test(t).alt;
        for (let u = t + step; u < t + 0.01; u += step) { const a = test(u).alt; if (a > best) { best = a; peak = u; } else break; }
        return { start: t, peak, maxAlt: best / DEG };
      }
      return null;
    },
  };
})();

// Procedural station model (km units), built in the station frame above.
function buildISSModel() {
  const M = 0.001; // metres → km
  const g = new THREE.Group();
  const white = new THREE.MeshLambertMaterial({ color: 0xe9e6de });
  const grey = new THREE.MeshLambertMaterial({ color: 0x9a9da3 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x3a3f47 });
  const gold = new THREE.MeshLambertMaterial({ color: 0xc89a4a });
  const cyl = (len, r, mat, axis, x, y, z) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r * M, r * M, len * M, 28), mat);
    if (axis === 'x') m.rotation.z = Math.PI / 2; // cylinder default axis is y
    m.position.set(x * M, y * M, z * M);
    g.add(m);
    return m;
  };
  const box = (sx, sy, sz, mat, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx * M, sy * M, sz * M), mat);
    m.position.set(x * M, y * M, z * M);
    g.add(m);
    return m;
  };
  // Pressurised modules
  cyl(5.5, 2.3, white, 'x', 0, 0, 0);         // Unity
  cyl(8.5, 2.2, white, 'x', 8.5, 0, 0);       // Destiny
  cyl(7.0, 2.2, white, 'x', 16.5, 0, 0);      // Harmony
  cyl(2.0, 1.2, grey, 'x', 21, 0, 0);         // PMA-2 / docking port
  cyl(7.0, 2.25, white, 'y', 16.5, -5.8, 0);  // Columbus (starboard)
  cyl(11.2, 2.2, white, 'y', 16.5, 8, 0);     // Kibo (port)
  box(5, 5, 1.2, grey, 16.5, 16, 0);          // Kibo exposed facility
  cyl(6.7, 2.2, white, 'y', 0, 6, 0);         // Tranquility (Node 3)
  cyl(12.6, 2.05, white, 'x', -9.4, 0, 0);    // Zarya
  cyl(13.1, 2.1, white, 'x', -22.3, 0, 0);    // Zvezda
  cyl(7, 1.35, grey, 'x', -32, 0, 0);         // Soyuz/Progress
  // Truss and radiators
  box(4.5, 109, 4, grey, 0, 0, 5.2);
  for (const s of [-1, 1]) {
    box(22, 3, 0.2, white, -12, s * 13, 5.2);
    box(22, 3, 0.2, white, -12, s * 16.5, 5.2);
    box(22, 3, 0.2, white, -12, s * 20, 5.2);
    box(9, 13, 0.1, gold, -26, s * 9, 0);       // Zvezda's own small arrays
  }
  // Solar arrays (4 alpha-joint groups, each with blankets above and below the truss)
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 256;
  const c = cv.getContext('2d');
  c.fillStyle = '#1a2440'; c.fillRect(0, 0, 64, 256);
  c.strokeStyle = 'rgba(214, 170, 90, 0.75)'; c.lineWidth = 1;
  for (let x = 0; x <= 64; x += 8) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, 256); c.stroke(); }
  for (let y = 0; y <= 256; y += 8) { c.beginPath(); c.moveTo(0, y); c.lineTo(64, y); c.stroke(); }
  const panelTex = new THREE.CanvasTexture(cv);
  const panelMat = new THREE.MeshLambertMaterial({ map: panelTex, side: THREE.DoubleSide, color: 0xffffff, emissive: 0x141a2a });
  const arrays = [];
  for (const y of [-52, -38, 38, 52]) {
    const grp = new THREE.Group();
    grp.position.set(0, y * M, 5.2 * M);
    for (const s of [-1, 1]) {
      const blanket = new THREE.Mesh(new THREE.PlaneGeometry(11.6 * M, 34 * M), panelMat);
      blanket.rotation.y = Math.PI / 2;           // plane in y-z, normal along x
      blanket.position.set(0, 0, s * 20 * M);
      grp.add(blanket);
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.15 * M, 0.15 * M, 36 * M, 6), dark);
      mast.rotation.x = Math.PI / 2;
      mast.position.set(0, 0, s * 20 * M);
      grp.add(mast);
    }
    g.add(grp);
    arrays.push(grp);
  }
  // Cupola on Tranquility's nadir port: a 7-window dome you can sit inside
  const cup = new THREE.Group();
  cup.position.set(0, 6 * M, -2.4 * M);
  const r1 = 0.55, r2 = 1.45, zb = -1.35, zt = -0.05;
  const hex = (r, z) => [0, 1, 2, 3, 4, 5].map(k => { const a = (k + 0.5) * Math.PI / 3; return new THREE.Vector3(r * Math.cos(a) * M, r * Math.sin(a) * M, z * M); }); // windows (not struts) face fore/aft
  const lo = hex(r1, zb), hi = hex(r2, zt);
  const strut = (a, b, rad) => {
    const d = new THREE.Vector3().subVectors(b, a), m = new THREE.Mesh(new THREE.CylinderGeometry(rad * M, rad * M, d.length(), 8), dark);
    m.position.copy(a).addScaledVector(d, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    cup.add(m);
  };
  for (let k = 0; k < 6; k++) { strut(lo[k], lo[(k + 1) % 6], 0.06); strut(hi[k], hi[(k + 1) % 6], 0.09); strut(lo[k], hi[k], 0.07); }
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.42 * M, 0.05 * M, 8, 32), dark);
  rim.position.z = zb * M;
  cup.add(rim);
  const ceiling = new THREE.Mesh(new THREE.CircleGeometry(1.6 * M, 24), new THREE.MeshLambertMaterial({ color: 0x5a5e66, side: THREE.DoubleSide }));
  ceiling.position.z = 0.1 * M;
  cup.add(ceiling);
  g.add(cup);
  g.userData = { arrays };
  return g;
}
