'use strict';
// ─── Constants ───────────────────────────────────────────────────────────────
// World frame: heliocentric ecliptic J2000, kilometres. z = ecliptic north.
const AU = 149597870.7;
const C_KMS = 299792.458;
const DEG = Math.PI / 180;
const J2000 = 2451545.0;
const DAY = 86400;
const OBL = 23.4392911 * DEG;

// ─── Small vector / matrix helpers (plain arrays, float64) ──────────────────
const V3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: a => Math.hypot(a[0], a[1], a[2]),
  norm: a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
  angle: (a, b) => Math.atan2(V3.len(V3.cross(a, b)), V3.dot(a, b)),
  // Rotate v about unit axis k by angle (Rodrigues)
  rot(v, k, ang) {
    const c = Math.cos(ang), s = Math.sin(ang), kv = V3.cross(k, v), d = V3.dot(k, v) * (1 - c);
    return [v[0] * c + kv[0] * s + k[0] * d, v[1] * c + kv[1] * s + k[1] * d, v[2] * c + kv[2] * s + k[2] * d];
  },
  slerp(a, b, t) {
    const ang = V3.angle(a, b);
    if (ang < 1e-9) return a.slice();
    if (Math.PI - ang < 1e-6) { // antiparallel: pick any perpendicular axis
      const ax = V3.norm(Math.abs(a[2]) < 0.9 ? V3.cross(a, [0, 0, 1]) : V3.cross(a, [1, 0, 0]));
      return V3.rot(a, ax, ang * t);
    }
    return V3.rot(a, V3.norm(V3.cross(a, b)), ang * t);
  },
};
const M3 = {
  mul(A, B) {
    const r = new Array(9);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
      r[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
    return r;
  },
  apply: (M, v) => [M[0] * v[0] + M[1] * v[1] + M[2] * v[2], M[3] * v[0] + M[4] * v[1] + M[5] * v[2], M[6] * v[0] + M[7] * v[1] + M[8] * v[2]],
  T: M => [M[0], M[3], M[6], M[1], M[4], M[7], M[2], M[5], M[8]],
  rx: a => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; },
  rz: a => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; },
};
const EQ2ECL = M3.rx(-OBL);
const eqToEcl = v => M3.apply(EQ2ECL, v);
const raDecToVec = (ra, dec) => eqToEcl([Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)]);

// ─── Time ────────────────────────────────────────────────────────────────────
const jdFromMs = ms => ms / 86400000 + 2440587.5;
const msFromJd = jd => (jd - 2440587.5) * 86400000;

// ─── Planets: JPL "Keplerian Elements for Approximate Positions" (Standish), 1800–2050
// [a AU, e, I°, L°, ϖ°, Ω°] and rates per Julian century
const PLANET_EL = {
  mercury: [0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593,
    0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081],
  venus: [0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255,
    0.00000390, -0.00004107, -0.00078890, 58517.81538729, 0.00268329, -0.27769418],
  emb: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0,
    0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0],
  mars: [1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891,
    0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343],
  jupiter: [5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909,
    -0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106],
  saturn: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448,
    -0.00125060, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794],
  uranus: [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630, 74.01692503,
    -0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589],
  neptune: [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574,
    0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664],
  pluto: [39.48211675, 0.24882730, 17.14001206, 238.92903833, 224.06891629, 110.30393684,
    -0.00031596, 0.00005170, 0.00004818, 145.20780515, -0.04062942, -0.01183482],
};

function solveKepler(M, e) {
  M = ((M + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  let E = e < 0.8 ? M : Math.PI * Math.sign(M || 1);
  for (let i = 0; i < 30; i++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-13) break;
  }
  return E;
}

function planetHelio(key, jd) {
  const el = PLANET_EL[key], T = (jd - J2000) / 36525;
  const a = (el[0] + el[6] * T) * AU, e = el[1] + el[7] * T, I = (el[2] + el[8] * T) * DEG;
  const L = el[3] + el[9] * T, wb = el[4] + el[10] * T, O = (el[5] + el[11] * T) * DEG;
  const w = wb * DEG - O, M = (L - wb) * DEG;
  const E = solveKepler(M, e);
  const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O), sO = Math.sin(O), cI = Math.cos(I), sI = Math.sin(I);
  return [
    (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
    (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
    (sw * sI) * xp + (cw * sI) * yp,
  ];
}

// ─── Moon: Schlyter's lunar theory with the main perturbation terms (~1–2′) ─
function moonGeo(jd) {
  const d = jd - 2451543.5, r = DEG;
  const N = (125.1228 - 0.0529538083 * d) * r, i = 5.1454 * r, w = (318.0634 + 0.1643573223 * d) * r;
  const e = 0.0549, M = (115.3654 + 13.0649929509 * d) * r;
  const E = solveKepler(M, e);
  const xv = Math.cos(E) - e, yv = Math.sqrt(1 - e * e) * Math.sin(E);
  const v = Math.atan2(yv, xv);
  let dist = 60.2666 * Math.hypot(xv, yv);
  const cN = Math.cos(N), sN = Math.sin(N), cvw = Math.cos(v + w), svw = Math.sin(v + w);
  const xh = cN * cvw - sN * svw * Math.cos(i), yh = sN * cvw + cN * svw * Math.cos(i), zh = svw * Math.sin(i);
  let lon = Math.atan2(yh, xh), lat = Math.atan2(zh, Math.hypot(xh, yh));
  const Ms = (356.0470 + 0.9856002585 * d) * r, ws = (282.9404 + 4.70935e-5 * d) * r;
  const Ls = Ms + ws, Lm = N + w + M, D = Lm - Ls, F = Lm - N, s = Math.sin, c = Math.cos;
  lon += r * (-1.274 * s(M - 2 * D) + 0.658 * s(2 * D) - 0.186 * s(Ms) - 0.059 * s(2 * M - 2 * D)
    - 0.057 * s(M - 2 * D + Ms) + 0.053 * s(M + 2 * D) + 0.046 * s(2 * D - Ms) + 0.041 * s(M - Ms)
    - 0.035 * s(D) - 0.031 * s(M + Ms) - 0.015 * s(2 * F - 2 * D) + 0.011 * s(M - 4 * D));
  lat += r * (-0.173 * s(F - 2 * D) - 0.055 * s(M - F - 2 * D) - 0.046 * s(M + F - 2 * D)
    + 0.033 * s(F + 2 * D) + 0.017 * s(2 * M + F));
  dist += -0.58 * c(M - 2 * D) - 0.46 * c(2 * D);
  lon -= 1.3969713 * r * (jd - J2000) / 36525; // precession: ecliptic of date → J2000
  const R = dist * 6378.14;
  return [R * Math.cos(lat) * Math.cos(lon), R * Math.cos(lat) * Math.sin(lon), R * Math.sin(lat)];
}
const MOON_EMB = 0.0121505856; // M_moon / (M_earth + M_moon)

// ─── Bodies ──────────────────────────────────────────────────────────────────
// radius: mean (or equatorial for giants) km; flat: flattening; pole: IAU RA/Dec (°);
// W: prime meridian W0 + Wd·d (°, d = days from J2000)
const BODIES = [
  { id: 'sun', name: '太阳', kind: '恒星', radius: 695700, mu: 1.32712440018e11, pole: [286.13, 63.87], W: [84.176, 14.1844],
    tex: 'sun', color: '#ffc861', fact: '太阳直径约为地球的 109 倍，能装下约 130 万个地球。它占整个太阳系质量的 99.86%。' },
  { id: 'mercury', name: '水星', kind: '行星', radius: 2439.7, mu: 22032, pole: [281.0103, 61.4155], W: [329.5988, 6.1385108],
    tex: 'mercury', color: '#b3aca3', period: 87.969, day: '58.6 天（自转）', fact: '水星上一个太阳日（176 天）比它的一年（88 天）还长。' },
  { id: 'venus', name: '金星', kind: '行星', radius: 6051.8, mu: 324858.59, pole: [272.76, 67.16], W: [160.20, -1.4813688],
    tex: 'venus_atmosphere', color: '#e8cf9a', period: 224.701, day: '243 天（逆向自转）', fact: '金星自转方向与多数行星相反，在那里太阳从西边升起。' },
  { id: 'earth', name: '地球', kind: '行星', radius: 6371.0, mu: 398600.4418, pole: [0, 90], W: [190.147, 360.9856235],
    tex: 'earth_daymap', color: '#6fa8ff', period: 365.256, day: '23 时 56 分', fact: '光绕地球一圈只需 0.13 秒，但从太阳到这里要走 8 分 20 秒。' },
  { id: 'moon', name: '月球', kind: '卫星', parent: 'earth', radius: 1737.4, mu: 4902.8, pole: [269.9949, 66.5392], W: [38.3213, 13.17635815],
    tex: 'moon', color: '#d9d6cf', period: 27.3217, day: '27.3 天（潮汐锁定）', fact: '地月之间能并排放下约 30 个地球，而太阳系里所有行星也能塞进这段距离。' },
  { id: 'mars', name: '火星', kind: '行星', radius: 3389.5, mu: 42828.37, pole: [317.269, 54.432], W: [176.049, 350.891982443],
    tex: 'mars', color: '#e27b58', period: 686.98, day: '24 时 37 分', fact: '火星与地球每 26 个月才会“对齐”一次，这就是火星发射窗口。' },
  { id: 'jupiter', name: '木星', kind: '行星', radius: 71492, flat: 0.06487, mu: 1.26686534e8, pole: [268.056595, 64.495303], W: [284.95, 870.536],
    tex: 'jupiter', color: '#d8b48a', period: 4332.59, day: '9 时 56 分', fact: '木星能装下约 1300 个地球，质量是其他所有行星总和的 2.5 倍。' },
  { id: 'saturn', name: '土星', kind: '行星', radius: 60268, flat: 0.09796, mu: 3.7931187e7, pole: [40.589, 83.537], W: [38.90, 810.7939024],
    tex: 'saturn', color: '#e6cf98', period: 10759.22, day: '10 时 33 分', ring: [74500, 140220], fact: '土星环宽约 28 万公里，厚度却通常只有几十米。' },
  { id: 'uranus', name: '天王星', kind: '行星', radius: 25559, flat: 0.02293, mu: 5.793939e6, pole: [257.311, -15.175], W: [203.81, -501.1600928],
    tex: 'uranus', color: '#a6dce6', period: 30688.5, day: '17 时 14 分', fact: '天王星几乎“躺着”自转，自转轴倾角约 98°。' },
  { id: 'neptune', name: '海王星', kind: '行星', radius: 24764, flat: 0.01708, mu: 6.836529e6, pole: [299.36, 43.46], W: [249.978, 541.1397757],
    tex: 'neptune', color: '#5b7fe0', period: 60182, day: '16 时 6 分', fact: '阳光到达海王星需要约 4 小时 10 分钟。' },
  { id: 'pluto', name: '冥王星', kind: '矮行星', radius: 1188.3, mu: 869.6, pole: [132.993, -6.163], W: [302.695, 56.3625225],
    color: '#cdb8a0', period: 90560, day: '6.4 天', fact: '冥王星比月球还小，绕太阳一圈要 248 年。' },
  // Moons of other planets: circular orbits in the parent's equatorial plane (approximate phases)
  { id: 'phobos', name: '火卫一', kind: '卫星', parent: 'mars', radius: 11.3, orbit: [9376, 0.31891023, 35.06], color: '#8f8579', fact: '火卫一离火星只有 6000 公里，一天绕火星三圈。' },
  { id: 'deimos', name: '火卫二', kind: '卫星', parent: 'mars', radius: 6.2, orbit: [23463.2, 1.263, 79.41], color: '#a09383', fact: '火卫二直径仅约 12 公里。' },
  { id: 'io', name: '木卫一', kind: '卫星', parent: 'jupiter', radius: 1821.6, orbit: [421700, 1.769137786, 163.8], color: '#e3d06a', fact: '木卫一是太阳系火山活动最剧烈的天体。' },
  { id: 'europa', name: '木卫二', kind: '卫星', parent: 'jupiter', radius: 1560.8, orbit: [671034, 3.551181, 358.4], color: '#cdbfa6', fact: '木卫二冰壳下可能有比地球海洋总量还多的液态水。' },
  { id: 'ganymede', name: '木卫三', kind: '卫星', parent: 'jupiter', radius: 2634.1, orbit: [1070412, 7.15455296, 5.7], color: '#a89c8c', fact: '木卫三是太阳系最大的卫星，比水星还大。' },
  { id: 'callisto', name: '木卫四', kind: '卫星', parent: 'jupiter', radius: 2410.3, orbit: [1882709, 16.6890184, 224.8], color: '#6f6559', fact: '木卫四表面布满撞击坑，是太阳系最古老的地表之一。' },
  { id: 'titan', name: '土卫六', kind: '卫星', parent: 'saturn', radius: 2574.7, orbit: [1221870, 15.945, 120], color: '#d9a650', fact: '土卫六有浓厚的大气和液态甲烷湖泊。' },
];
const BODY_EN = {
  sun: { name: 'Sun', fact: "The Sun is about 109 Earths across and could hold roughly 1.3 million Earths. It holds 99.86% of the Solar System's mass." },
  mercury: { name: 'Mercury', day: '58.6 days (rotation)', fact: 'A solar day on Mercury (176 days) lasts longer than its year (88 days).' },
  venus: { name: 'Venus', day: '243 days (retrograde)', fact: 'Venus spins the opposite way to most planets, so there the Sun rises in the west.' },
  earth: { name: 'Earth', day: '23 h 56 min', fact: 'Light circles the Earth in 0.13 s, yet needs 8 min 20 s to reach us from the Sun.' },
  moon: { name: 'Moon', day: '27.3 days (tidally locked)', fact: 'About 30 Earths fit side by side between Earth and the Moon, and so would all the other planets.' },
  mars: { name: 'Mars', day: '24 h 37 min', fact: 'Earth and Mars line up for an efficient trip only once every 26 months: the Mars launch window.' },
  jupiter: { name: 'Jupiter', day: '9 h 56 min', fact: 'Jupiter could hold about 1,300 Earths and has 2.5 times the mass of all other planets combined.' },
  saturn: { name: 'Saturn', day: '10 h 33 min', fact: "Saturn's rings span about 280,000 km, yet are usually only tens of metres thick." },
  uranus: { name: 'Uranus', day: '17 h 14 min', fact: 'Uranus spins almost on its side, with an axial tilt of about 98°.' },
  neptune: { name: 'Neptune', day: '16 h 6 min', fact: 'Sunlight takes about 4 hours 10 minutes to reach Neptune.' },
  pluto: { name: 'Pluto', day: '6.4 days', fact: 'Pluto is smaller than our Moon and takes 248 years to circle the Sun.' },
  phobos: { name: 'Phobos', fact: 'Phobos orbits just 6,000 km above Mars and goes around it three times a day.' },
  deimos: { name: 'Deimos', fact: 'Deimos is only about 12 km across.' },
  io: { name: 'Io', fact: 'Io is the most volcanically active world in the Solar System.' },
  europa: { name: 'Europa', fact: "Beneath its ice shell, Europa may hold more liquid water than all of Earth's oceans." },
  ganymede: { name: 'Ganymede', fact: 'Ganymede is the largest moon in the Solar System, bigger than Mercury.' },
  callisto: { name: 'Callisto', fact: 'Callisto is saturated with craters; its surface is among the oldest in the Solar System.' },
  titan: { name: 'Titan', fact: 'Titan has a thick atmosphere and lakes of liquid methane.' },
};
const KIND_EN = { 恒星: 'Star', 行星: 'Planet', 卫星: 'Natural satellite', 矮行星: 'Dwarf planet' };
for (const b of BODIES) {
  const en = BODY_EN[b.id] || {};
  for (const f of ['name', 'day', 'fact']) if (b[f] != null) biProp(b, f, b[f], en[f] || b[f]);
  biProp(b, 'kind', b.kind, KIND_EN[b.kind]);
}
const BODY = Object.fromEntries(BODIES.map(b => [b.id, b]));
const PLANET_IDS = ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];

function poleFrame(b) { // body equator frame → ecliptic (without spin)
  if (!b._pf) b._pf = M3.mul(EQ2ECL, M3.mul(M3.rz((b.pole[0] + 90) * DEG), M3.rx((90 - b.pole[1]) * DEG)));
  return b._pf;
}
// Body-fixed → ecliptic rotation matrix
function bodyRot(id, jd) {
  const b = BODY[id];
  if (!b.pole) { // small moons: tidally locked, point prime meridian at parent
    return null;
  }
  const W = ((b.W[0] + b.W[1] * (jd - J2000)) % 360) * DEG;
  return M3.mul(poleFrame(b), M3.rz(W));
}

// Heliocentric position of any body (km)
function bodyPos(id, jd) {
  switch (id) {
    case 'sun': return [0, 0, 0];
    case 'earth': { const e = planetHelio('emb', jd), m = moonGeo(jd); return V3.sub(e, V3.mul(m, MOON_EMB)); }
    case 'moon': { const e = planetHelio('emb', jd), m = moonGeo(jd); return V3.add(e, V3.mul(m, 1 - MOON_EMB)); }
  }
  const b = BODY[id];
  if (b.orbit) {
    const P = bodyPos(b.parent, jd), pf = poleFrame(BODY[b.parent]);
    const th = (b.orbit[2] + 360 / b.orbit[1] * (jd - J2000)) * DEG;
    const x = b.orbit[0] * Math.cos(th), y = b.orbit[0] * Math.sin(th);
    return V3.add(P, [pf[0] * x + pf[1] * y, pf[3] * x + pf[4] * y, pf[6] * x + pf[7] * y]);
  }
  return planetHelio(id, jd);
}

// All positions at once (shares the Earth/Moon computation)
function allPositions(jd) {
  const pos = { sun: [0, 0, 0] };
  const emb = planetHelio('emb', jd), m = moonGeo(jd);
  pos.earth = V3.sub(emb, V3.mul(m, MOON_EMB));
  pos.moon = V3.add(emb, V3.mul(m, 1 - MOON_EMB));
  for (const b of BODIES) if (!pos[b.id] && !b.orbit) pos[b.id] = planetHelio(b.id, jd);
  for (const b of BODIES) if (b.orbit) {
    const P = pos[b.parent], pf = poleFrame(BODY[b.parent]);
    const th = (b.orbit[2] + 360 / b.orbit[1] * (jd - J2000)) * DEG;
    const x = b.orbit[0] * Math.cos(th), y = b.orbit[0] * Math.sin(th);
    pos[b.id] = V3.add(P, [pf[0] * x + pf[1] * y, pf[3] * x + pf[4] * y, pf[6] * x + pf[7] * y]);
  }
  return pos;
}

function bodyVel(id, jd) {
  const h = 60 / DAY;
  return V3.mul(V3.sub(bodyPos(id, jd + h), bodyPos(id, jd - h)), 1 / (2 * h * DAY));
}

// Surface point (lat, lon in degrees, east-positive) → heliocentric position
function surfaceUnit(lat, lon) {
  return [Math.cos(lat * DEG) * Math.cos(lon * DEG), Math.cos(lat * DEG) * Math.sin(lon * DEG), Math.sin(lat * DEG)];
}
function surfacePos(id, lat, lon, alt, jd) {
  const R = bodyRot(id, jd), u = M3.apply(R, surfaceUnit(lat, lon));
  return V3.add(bodyPos(id, jd), V3.mul(u, BODY[id].radius + alt));
}
function toLatLon(id, geoVec, jd) {
  const u = V3.norm(M3.apply(M3.T(bodyRot(id, jd)), geoVec));
  return [Math.asin(u[2]) / DEG, Math.atan2(u[1], u[0]) / DEG];
}

// ─── Eclipse geometry ────────────────────────────────────────────────────────
// Fraction of the solar disc visible from point p, given one occluder (JS twin of the shader)
function sunVisibleFraction(p, sunPos, occPos, occR) {
  const ds = V3.sub(sunPos, p), dO = V3.sub(occPos, p);
  const dS = V3.len(ds), dOl = V3.len(dO);
  if (V3.dot(ds, dO) <= 0 || dOl > dS) return 1;
  const as = Math.asin(Math.min(BODY.sun.radius / dS, 1)), ao = Math.asin(Math.min(occR / dOl, 1));
  const sep = V3.angle(ds, dO);
  if (sep >= as + ao) return 1;
  if (sep <= ao - as) return 0;
  if (sep <= as - ao) return 1 - (ao * ao) / (as * as);
  const r1 = as, r2 = ao, d = sep;
  const a1 = r1 * r1 * Math.acos(Math.max(-1, Math.min(1, (d * d + r1 * r1 - r2 * r2) / (2 * d * r1))));
  const a2 = r2 * r2 * Math.acos(Math.max(-1, Math.min(1, (d * d + r2 * r2 - r1 * r1) / (2 * d * r2))));
  const a3 = 0.5 * Math.sqrt(Math.max(0, (-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2)));
  return Math.max(0, 1 - (a1 + a2 - a3) / (Math.PI * r1 * r1));
}

function goldenMin(f, a, b, iters = 40) {
  const g = (Math.sqrt(5) - 1) / 2;
  let c = b - g * (b - a), d = a + g * (b - a), fc = f(c), fd = f(d);
  for (let i = 0; i < iters; i++) {
    if (fc < fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = f(c); }
    else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = f(d); }
  }
  return (a + b) / 2;
}

function lunarGeometry(jd) {
  const E = V3.sub(planetHelio('emb', jd), V3.mul(moonGeo(jd), MOON_EMB)), M = moonGeo(jd);
  const dm = V3.len(M), ds = V3.len(E), Re = BODY.earth.radius;
  const sep = V3.angle(M, E); // moon vs anti-sun direction
  const pm = Math.asin(Re / dm), ps = Math.asin(Re / ds), ss = Math.asin(BODY.sun.radius / ds), sm = Math.asin(BODY.moon.radius / dm);
  const umbra = 1.02 * (pm + ps - ss), pen = 1.02 * (pm + ps + ss);
  return { sep, umbra, pen, sm, M };
}

// Next umbral lunar eclipse after jd0
function findLunarEclipse(jd0) {
  const step = 1 / 24;
  let a = lunarGeometry(jd0).sep, b = lunarGeometry(jd0 + step).sep;
  for (let k = 2; k < 24 * 366 * 4; k++) {
    const t = jd0 + k * step, c = lunarGeometry(t).sep;
    if (b < a && b <= c && b < 1.6 * DEG) {
      const tm = goldenMin(x => lunarGeometry(x).sep, t - 2 * step, t);
      const g = lunarGeometry(tm);
      if (tm > jd0 + 0.01 && g.sep < g.umbra + g.sm) {
        const total = g.sep < g.umbra - g.sm;
        return { jd: tm, total, get type() { return total ? tr('月全食', 'Total lunar eclipse') : tr('月偏食', 'Partial lunar eclipse'); }, g };
      }
    }
    a = b; b = c;
  }
  return null;
}

function solarGeometry(jd) {
  const M = moonGeo(jd), E = V3.sub(planetHelio('emb', jd), V3.mul(M, MOON_EMB));
  const Mh = V3.add(E, M), u = V3.norm(Mh);
  const w = V3.mul(M, -1); // Earth relative to Moon
  const along = V3.dot(w, u), perp = V3.sub(w, V3.mul(u, along));
  return { dperp: V3.len(perp), u, M, E, Mh, along };
}

// Next central (total / annular) solar eclipse after jd0
function findSolarEclipse(jd0) {
  const step = 1 / 24, sepAt = t => { const M = moonGeo(t), E = V3.sub(planetHelio('emb', t), V3.mul(M, MOON_EMB)); return V3.angle(M, V3.mul(E, -1)); };
  let a = sepAt(jd0), b = sepAt(jd0 + step);
  for (let k = 2; k < 24 * 366 * 4; k++) {
    const t = jd0 + k * step, c = sepAt(t);
    if (b < a && b <= c && b < 1.8 * DEG) {
      const tm = goldenMin(x => solarGeometry(x).dperp, t - 3 * step, t + step);
      const g = solarGeometry(tm), Re = BODY.earth.radius;
      if (tm > jd0 + 0.01 && g.dperp < Re) {
        // Where the shadow axis meets Earth
        const mu = V3.dot(g.M, g.u), disc = mu * mu - V3.dot(g.M, g.M) + Re * Re;
        const s = -mu - Math.sqrt(Math.max(0, disc));
        const hit = V3.add(g.M, V3.mul(g.u, s));
        const Rs = BODY.sun.radius, Rm = BODY.moon.radius;
        const umbraLen = V3.len(g.Mh) * Rm / (Rs - Rm);
        const total = umbraLen > s;
        const [lat, lon] = toLatLon('earth', hit, tm);
        return { jd: tm, total, get type() { return total ? tr('日全食', 'Total solar eclipse') : tr('日环食', 'Annular solar eclipse'); }, lat, lon };
      }
    }
    a = b; b = c;
  }
  return null;
}

// Apparent altitude (rad) of target body seen from a surface point
function altitudeOf(targetPos, obsPos, up) {
  return Math.asin(Math.max(-1, Math.min(1, V3.dot(V3.norm(V3.sub(targetPos, obsPos)), up))));
}

