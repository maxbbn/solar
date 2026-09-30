'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const JD_MIN = jdFromMs(Date.UTC(1800, 0, 1)), JD_MAX = jdFromMs(Date.UTC(2199, 11, 31));
  const JD_OK0 = jdFromMs(Date.UTC(1800, 0, 1)), JD_OK1 = jdFromMs(Date.UTC(2050, 11, 31));
  const ECL = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

  const RATES = [
    { v: 1, zh: '实时', en: 'Real time' }, { v: 60, zh: '1分/秒', en: '1 min/s' }, { v: 600, zh: '10分/秒', en: '10 min/s' }, { v: 3600, zh: '1时/秒', en: '1 h/s' },
    { v: 21600, zh: '6时/秒', en: '6 h/s' }, { v: 86400, zh: '1天/秒', en: '1 day/s' }, { v: 604800, zh: '1周/秒', en: '1 wk/s' },
    { v: 2629800, zh: '1月/秒', en: '1 mo/s' }, { v: 31557600, zh: '1年/秒', en: '1 yr/s' },
  ];
  const site = (zh, en, lat, lon) => biProp({ lat, lon }, 'name', zh, en);
  const SITES = {
    earth: [
      site('北京', 'Beijing', 39.904, 116.407), site('上海', 'Shanghai', 31.23, 121.47), site('广州', 'Guangzhou', 23.13, 113.26),
      site('拉萨', 'Lhasa', 29.65, 91.1), site('纽约', 'New York', 40.71, -74.01), site('伦敦', 'London', 51.51, -0.13),
      site('悉尼', 'Sydney', -33.87, 151.21), site('基多（赤道）', 'Quito (equator)', -0.18, -78.47), site('北极点', 'North Pole', 89.99, 0),
    ],
    moon: [
      site('危海', 'Mare Crisium', 17.0, 59.1), site('静海 · 阿波罗 11 号', 'Sea of Tranquility · Apollo 11', 0.67, 23.47),
      site('月球背面 · 嫦娥四号', "Far side · Chang'e 4", -45.44, 177.6), site('月球南极', 'Lunar south pole', -89.5, 0),
    ],
    mars: [
      site('杰泽罗陨坑 · 毅力号', 'Jezero Crater · Perseverance', 18.44, 77.45), site('乌托邦平原 · 祝融号', 'Utopia Planitia · Zhurong', 25.07, 109.93),
      site('盖尔陨坑 · 好奇号', 'Gale Crater · Curiosity', -5.4, 137.8),
    ],
  };
  const LOOK = {
    earth: ['moon', 'sun', 'iss', 'venus', 'mars', 'jupiter'],
    moon: ['earth', 'sun'],
    mars: ['earth', 'sun', 'phobos'],
  };
  // In Chinese the Moon in the sky is 月亮 rather than 月球
  const skyName = id => id === 'moon' ? tr('月亮', 'Moon') : id === 'iss' ? tr('空间站', 'ISS') : BODY[id].name;

  const S = {
    jd: jdFromMs(Date.now()),
    rate: 60, paused: false, reverse: false,
    mode: 'orbit', view: 'earthMoon',
    orbit: { target: 'earth', dist: 60000, yaw: 0, pitch: 0.3, basis: null },
    orbitFov: 50,
    surf: { body: 'earth', site: SITES.earth[0], h: 0.0017, az: 0, alt: 0.3, fov: 60, track: 'moon' },
    cock: { look: 'back', yaw: Math.PI, pitch: 0, fov: 70, track: null },
    vehicle: 'rocket',
    cs: null,
    trans: null, last: null,
    toggles: { labels: true, orbits: true, constellations: false },
    mission: null, autoPace: true,
    plan: { target: 'moon', site: LAUNCH_SITES[0], result: null, pork: null, pick: null },
    pulses: [],
  };

  // ─── Formatting ───────────────────────────────────────────────────────────
  const pad = (n, w = 2) => String(Math.floor(n)).padStart(w, '0');
  const fmtNum = (x, d = 0) => x.toLocaleString(tr('zh-CN', 'en-US'), { minimumFractionDigits: d, maximumFractionDigits: d });
  function fmtKm(d) {
    if (I18N.lang === 'en') {
      if (d < 1) return `${fmtNum(d * 1000)} m`;
      if (d < 1e6) return `${fmtNum(d, d < 100 ? 1 : 0)} km`;
      if (d < 1e9) return `${fmtNum(d / 1e6, 2)} million km`;
      return `${fmtNum(d / 1e9, 2)} billion km`;
    }
    if (d < 1) return `${fmtNum(d * 1000)} 米`;
    if (d < 1e4) return `${fmtNum(d, d < 100 ? 1 : 0)} 公里`;
    if (d < 1e8) return `${fmtNum(d / 1e4, d < 1e5 ? 2 : 1)} 万公里`;
    return `${fmtNum(d / 1e8, 2)} 亿公里`;
  }
  const fmtAU = d => d > 0.02 * AU ? `${fmtNum(d / AU, d > 10 * AU ? 1 : 3)} AU` : '';
  function fmtDur(s) {
    s = Math.abs(s);
    if (I18N.lang === 'en') {
      if (s < 0.001) return `${(s * 1e6).toFixed(1)} µs`;
      if (s < 1) return `${(s * 1000).toFixed(1)} ms`;
      if (s < 60) return `${s.toFixed(1)} s`;
      if (s < 3600) return `${Math.floor(s / 60)} min ${pad(s % 60)} s`;
      if (s < 86400) return `${Math.floor(s / 3600)} h ${pad((s % 3600) / 60)} min`;
      if (s < 86400 * 400) return `${Math.floor(s / 86400)} d ${Math.floor((s % 86400) / 3600)} h`;
      return `${(s / 86400 / 365.25).toFixed(1)} yr`;
    }
    if (s < 0.001) return `${(s * 1e6).toFixed(1)} 微秒`;
    if (s < 1) return `${(s * 1000).toFixed(1)} 毫秒`;
    if (s < 60) return `${s.toFixed(1)} 秒`;
    if (s < 3600) return `${Math.floor(s / 60)} 分 ${pad(s % 60)} 秒`;
    if (s < 86400) return `${Math.floor(s / 3600)} 小时 ${pad((s % 3600) / 60)} 分`;
    if (s < 86400 * 400) return `${Math.floor(s / 86400)} 天 ${Math.floor((s % 86400) / 3600)} 小时`;
    return `${(s / 86400 / 365.25).toFixed(1)} 年`;
  }
  function fmtAngle(r) {
    const d = Math.abs(r) / DEG;
    if (d >= 2) return `${d.toFixed(1)}°`;
    if (d >= 1 / 60) return `${Math.floor(d)}° ${pad((d * 60) % 60)}′ ${pad((d * 3600) % 60)}″`.replace(/^0° /, '');
    return `${(d * 3600).toFixed(d * 3600 < 10 ? 2 : 1)}″`;
  }
  function rateLabel(v) {
    const a = Math.abs(v), sg = v < 0 ? '−' : '';
    const f = x => (Math.round(x * 10) / 10).toString();
    if (a < 1.5 && a > 0.5) return sg ? tr('倒流 实时', 'Real time, reversed') : tr('实时', 'Real time');
    if (a < 60) return `${sg}${f(a)}${tr(' 倍速', '×')}`;
    if (a < 3600) return `${sg}${f(a / 60)} ${tr('分/秒', 'min/s')}`;
    if (a < 86400) return `${sg}${f(a / 3600)} ${tr('时/秒', 'h/s')}`;
    if (a < 2629800) return `${sg}${f(a / 86400)} ${tr('天/秒', 'days/s')}`;
    if (a < 31557600) return `${sg}${f(a / 2629800)} ${tr('月/秒', 'mo/s')}`;
    return `${sg}${f(a / 31557600)} ${tr('年/秒', 'yr/s')}`;
  }
  const localDate = jd => new Date(msFromJd(jd));
  const fmtDate = jd => { const d = localDate(jd); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const fmtDateTime = jd => { const d = localDate(jd); return `${fmtDate(jd)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const tzName = (() => { const o = -new Date().getTimezoneOffset() / 60; return `UTC${o >= 0 ? '+' : '−'}${Math.abs(o)}`; })();
  const weekday = d => tr(`星期${'日一二三四五六'[d.getDay()]}`, ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]);
  const NO_MISSION = () => tr('还没有任务 —— 先在“发射任务”里选择目标并发射', 'No mission yet. Pick a destination under "Launch" and fire away.');

  let toastTimer;
  function toast(msg, ms = 4200) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  // ─── Camera ───────────────────────────────────────────────────────────────
  function targetPos(id, pos, jd) {
    if (id === 'craft') return S.mission ? S.mission.pos(jd) : pos.earth;
    if (id === 'iss') return ISS.pos(jd, pos.earth);
    return pos[id];
  }
  const targetRadius = id => id === 'craft' ? 0.02 : id === 'iss' ? 0.055 : BODY[id].radius;
  const minDist = id => id === 'craft' ? 0.06 : id === 'iss' ? 0.075 : BODY[id].radius * (1 + (id === 'sun' ? 0.02 : 0.004)) + 1;
  const issBasis = jd => { const f = ISS.frame(jd); return [f.F, f.port, f.up]; }; // follows the station around its orbit

  function orbitCam(jd, pos) {
    const o = S.orbit, B = o.basis === 'iss' ? issBasis(jd) : o.basis || ECL, T = targetPos(o.target, pos, jd);
    const cp = Math.cos(o.pitch);
    const off = V3.add(V3.add(V3.mul(B[0], cp * Math.cos(o.yaw)), V3.mul(B[1], cp * Math.sin(o.yaw))), V3.mul(B[2], Math.sin(o.pitch)));
    return { C: V3.add(T, V3.mul(off, o.dist)), dir: V3.mul(off, -1), up: B[2], fov: S.orbitFov, anchor: T, anchorId: o.target };
  }
  function surfaceFrame(jd, pos) {
    const s = S.surf, b = BODY[s.body], R = bodyRot(s.body, jd);
    const up = M3.apply(R, surfaceUnit(s.site.lat, s.site.lon));
    const pole = [R[2], R[5], R[8]];
    let east = V3.cross(pole, up);
    east = V3.len(east) < 1e-6 ? [R[1], R[4], R[7]] : V3.norm(east);
    const north = V3.cross(up, east);
    return { up, east, north, C: V3.add(pos[s.body], V3.mul(up, b.radius + s.h)) };
  }
  function altAz(target, f) {
    const d = V3.norm(V3.sub(target, f.C));
    return { alt: Math.asin(clamp(V3.dot(d, f.up), -1, 1)), az: Math.atan2(V3.dot(d, f.east), V3.dot(d, f.north)) };
  }
  function surfaceCam(jd, pos) {
    const s = S.surf, f = surfaceFrame(jd, pos);
    if (s.track) { const a = altAz(targetPos(s.track, pos, jd), f); s.alt = a.alt; s.az = a.az; }
    const alt = clamp(s.alt, -89.9 * DEG, 89.9 * DEG);
    const dir = V3.add(V3.mul(V3.add(V3.mul(f.north, Math.cos(s.az)), V3.mul(f.east, Math.sin(s.az))), Math.cos(alt)), V3.mul(f.up, Math.sin(alt)));
    return { C: f.C, dir, up: f.up, fov: s.fov, anchor: pos[s.body], anchorId: s.body, surface: { body: s.body, up: f.up, east: f.east, north: f.north, h: s.h }, frame: f };
  }
  // Craft state for this frame: position, attitude (nose direction), engine state
  function craftState(jd, pos) {
    const m = S.mission;
    if (!m) return null;
    const craftPos = m.pos(jd), frame = craftFrame(jd), fb = pos[frame] || bodyPos(frame, jd);
    const v = V3.sub(m.vel(jd), m.refVel(jd));
    const up = V3.norm(V3.sub(craftPos, pos.earth));
    let att;
    if (jd < m.tLaunch) att = up;
    else if (jd < m.tLaunch + ASCENT) att = V3.norm(V3.slerp(up, V3.norm(v), smoothstep(0.05, 0.9, (jd - m.tLaunch) / ASCENT)));
    else att = V3.norm(v);
    const burning = (jd >= m.tLaunch && jd < m.tLaunch + ASCENT) || m.burns.some(b => Math.abs(jd - b.t) < b.dur / 2);
    return { craftPos, att, burning, frame, fb, alt: V3.len(V3.sub(craftPos, fb)) - BODY[frame].radius };
  }
  function issState(jd, pos) {
    const f = ISS.frame(jd);
    return { craftPos: V3.add(pos.earth, f.r), att: f.F, burning: false, frame: 'earth', fb: pos.earth, alt: V3.len(f.r) - BODY.earth.radius, f };
  }
  // Onboard camera: mounted on the side of the rocket at mid-body, oriented in the rocket's own frame
  // (forward = nose, "up" = away from the body it flies around), like an onboard camera.
  function cockpitCam(jd, pos) {
    const iss = S.vehicle === 'iss', cs = iss ? issState(jd, pos) : S.cs, k = S.cock;
    if (!cs) return orbitCam(jd, pos);
    const F = cs.att, radial = V3.norm(V3.sub(cs.craftPos, cs.fb));
    const R = bodyRot(cs.frame, jd), pole = R ? [R[2], R[5], R[8]] : [0, 0, 1];
    const a = smoothstep(0.75, 0.97, Math.abs(V3.dot(F, radial))); // nose pointing straight up: use north as reference
    let right = V3.cross(F, V3.norm(V3.add(V3.mul(radial, 1 - a), V3.mul(pole, a))));
    right = V3.len(right) < 1e-6 ? V3.norm(V3.cross(F, [1, 0, 0])) : V3.norm(right);
    const up = V3.cross(right, F);
    const cup = ISS.cupola; // ISS: sit inside the Cupola (station frame, metres)
    const C = iss ? V3.add(cs.craftPos, V3.add(V3.add(V3.mul(cs.f.F, cup[0] / 1000), V3.mul(cs.f.port, cup[1] / 1000)), V3.mul(cs.f.up, cup[2] / 1000)))
      : V3.add(cs.craftPos, V3.add(V3.mul(F, 0.018), V3.mul(right, 0.0048)));
    if (k.track) {
      const d = V3.norm(V3.sub(targetPos(k.track, pos, jd), C));
      k.yaw = Math.atan2(V3.dot(d, right), V3.dot(d, F));
      k.pitch = Math.asin(clamp(V3.dot(d, up), -1, 1));
    }
    const cy = Math.cos(k.yaw), sy = Math.sin(k.yaw), cp = Math.cos(k.pitch), sp = Math.sin(k.pitch);
    const horiz = V3.add(V3.mul(F, cy), V3.mul(right, sy));
    const dir = V3.add(V3.mul(horiz, cp), V3.mul(up, sp));
    const camUp = V3.sub(V3.mul(up, cp), V3.mul(horiz, sp));
    // Low over Earth: reuse the surface sky/ground so liftoff happens on real ground under a real sky
    let surface = null, skyOnly = null;
    if (cs.frame === 'earth' && cs.alt < 150) {
      const east = V3.norm(V3.cross(pole, radial)), north = V3.cross(radial, east);
      if (cs.alt < 3) surface = { body: 'earth', up: radial, east, north, h: cs.alt + 0.018 * V3.dot(F, radial) - 0.027, noCompass: true }; // ground stays at pad level, just under the tail
      else skyOnly = { body: 'earth', up: radial, fade: 1 - smoothstep(15, 140, cs.alt) };
    }
    return { C, dir, up: camUp, fov: k.fov, anchor: cs.craftPos, anchorId: iss ? 'iss' : 'craft', surface, skyOnly, cockpit: { F, up, right, cs } };
  }
  const ease = s => s < 0.5 ? 4 * s * s * s : 1 - Math.pow(-2 * s + 2, 3) / 2;
  function startTransition() {
    if (!S.last) return;
    const L = S.last;
    S.trans = { t0: performance.now(), dur: 2600, anchorId: L.anchorId, off: V3.sub(L.C, L.anchor), dir: L.dir, up: L.up, fov: L.fov };
  }
  function computeCamera(jd, pos) {
    let cam = S.mode === 'surface' ? surfaceCam(jd, pos) : S.mode === 'cockpit' ? cockpitCam(jd, pos) : orbitCam(jd, pos);
    const tr = S.trans;
    if (tr) {
      const s = clamp((performance.now() - tr.t0) / tr.dur, 0, 1), e = ease(s);
      const PA = V3.add(targetPos(tr.anchorId, pos, jd), tr.off), TB = cam.anchor;
      const vA = V3.sub(PA, TB), vB = V3.sub(cam.C, TB);
      const dA = Math.max(V3.len(vA), 1e-6), dB = Math.max(V3.len(vB), 1e-6);
      const offDir = V3.slerp(V3.mul(vA, 1 / dA), V3.mul(vB, 1 / dB), e);
      const C = V3.add(TB, V3.mul(offDir, Math.exp(Math.log(dA) + (Math.log(dB) - Math.log(dA)) * e)));
      const toward = V3.norm(V3.sub(TB, C));
      const base = V3.slerp(V3.norm(tr.dir), V3.norm(cam.dir), e);
      const w = Math.sin(Math.PI * s) * 0.9;
      const dir = V3.norm(V3.lerp(base, toward, w));
      cam = { ...cam, C, dir, up: V3.norm(V3.slerp(V3.norm(tr.up), V3.norm(cam.up), e)), fov: tr.fov + (cam.fov - tr.fov) * e,
        surface: s > 0.97 ? cam.surface : null, skyOnly: s > 0.97 ? cam.skyOnly : null };
      if (s >= 1) S.trans = null;
    }
    S.last = cam;
    return cam;
  }

  // ─── Views ────────────────────────────────────────────────────────────────
  function setOrbit(target, dist, yaw, pitch, fov = 50, basis = null) {
    startTransition();
    S.mode = 'orbit';
    S.orbit = { target, dist, yaw, pitch: clamp(pitch, -1.56, 1.56), basis };
    S.orbitFov = fov;
    refreshUI();
  }
  function focusBody(id, silentView) {
    if (id === 'craft') return followCraft();
    if (id === 'iss') return issView();
    const pos = allPositions(S.jd), P = pos[id];
    const sd = id === 'sun' ? [1, 0, 0] : V3.norm(V3.sub(pos.sun, P));
    if (!silentView) S.view = null;
    setOrbit(id, BODY[id].radius * (id === 'sun' ? 5 : BODY[id].ring ? 7 : 3.6), Math.atan2(sd[1], sd[0]) + 40 * DEG, 14 * DEG);
  }
  function setSurface(body, site, track, fov = 60) {
    startTransition();
    S.mode = 'surface';
    S.surf = { ...S.surf, body, site, track, fov, h: body === 'earth' ? 0.0017 : 0.0016 };
    if (!track) { S.surf.alt = 20 * DEG; }
    refreshUI();
  }
  // Advance time (if needed) until `id` stands above the horizon; returns true if time moved
  function waitForRise(id, body, site, opts = {}) {
    const test = jd => {
      const pos = allPositions(jd), saved = S.surf;
      S.surf = { ...S.surf, body, site };
      const f = surfaceFrame(jd, pos);
      S.surf = saved;
      const a = altAz(pos[id], f).alt, sunAlt = altAz(pos.sun, f).alt;
      return a > (opts.minAlt || 12) * DEG && (!opts.dark || sunAlt < -8 * DEG);
    };
    if (test(S.jd)) return false;
    for (let k = 1; k < 24 * 6 * (opts.days || 3); k++) {
      const t = S.jd + k / 144;
      if (test(t)) { S.jd = t; return true; }
    }
    if (opts.dark) return waitForRise(id, body, site, { ...opts, dark: false });
    return false;
  }

  const VIEWS = [
    { id: 'earthMoon', n: ['地球与月亮', 'Earth & Moon'], h: ['远处那颗小小的就是月亮', 'That tiny dot far away is the Moon'], go() {
      const pos = allPositions(S.jd), md = V3.norm(V3.sub(pos.moon, pos.earth));
      setOrbit('earth', 62000, Math.atan2(-md[1], -md[0]), Math.asin(-md[2]) + 14 * DEG, 50);
    } },
    { id: 'emSystem', n: ['地月系统', 'Earth–Moon system'], h: ['月球轨道的真实大小', "The true size of the Moon's orbit"], go() {
      setOrbit('earth', 1.15e6, S.mode === 'orbit' ? S.orbit.yaw : 0, 62 * DEG, 50);
    } },
    { id: 'onEarth', n: ['站在地球上', 'Stand on Earth'], h: ['看月亮、太阳和星空', 'The Moon, Sun and stars'], go() {
      const site = S.surf.body === 'earth' ? S.surf.site : SITES.earth[0];
      if (waitForRise('moon', 'earth', site, { days: 2 })) toast(tr(`月亮此刻在地平线下，已把时间快进到 ${fmtDateTime(S.jd)}，它升起之后`, `The Moon was below the horizon, so time jumped ahead to ${fmtDateTime(S.jd)}, after moonrise`));
      setSurface('earth', site, 'moon', 60);
    } },
    { id: 'onMoon', n: ['在月球上看地球', 'Earth from the Moon'], h: ['地球几乎一动不动地挂在天上', 'Earth hangs almost still in the sky'], go() {
      setSurface('moon', SITES.moon[0], 'earth', 45);
    } },
    { id: 'onMars', n: ['在火星上看地球', 'Earth from Mars'], h: ['地球只是一颗亮星', 'Earth is just a bright star'], go() {
      const site = SITES.mars[0];
      if (waitForRise('earth', 'mars', site, { minAlt: 6, dark: true, days: 4 })) toast(tr(`已快进到 ${fmtDateTime(S.jd)}：地球在火星夜空中升起`, `Time jumped to ${fmtDateTime(S.jd)}: Earth has risen in the Martian night sky`));
      setSurface('mars', site, 'earth', 40);
    } },
    { id: 'inner', n: ['内太阳系', 'Inner Solar System'], h: ['水星、金星、地球、火星', 'Mercury, Venus, Earth, Mars'], go() { setOrbit('sun', 3.4 * AU, S.orbit.yaw || -1.2, 50 * DEG, 50); } },
    { id: 'outer', n: ['太阳系全景', 'Whole Solar System'], h: ['一直到海王星', 'All the way out to Neptune'], go() { setOrbit('sun', 78 * AU, S.orbit.yaw || -1.2, 52 * DEG, 50); } },
    { id: 'saturnBack', n: ['从土星回望', 'Looking back from Saturn'], h: ['找找那个“暗淡蓝点”', 'Find the "pale blue dot"'], go() {
      const pos = allPositions(S.jd), v = V3.norm(pos.saturn);
      setOrbit('saturn', 2.4e6, Math.atan2(v[1], v[0]), Math.asin(v[2]) + 1.2 * DEG, 32);
    } },
    { id: 'iss', n: ['国际空间站', 'Space Station'], h: ['以 7.66 km/s 绕地球飞行', 'Circling Earth at 7.66 km/s'], go: () => issView() },
    { id: 'cupola', n: ['空间站舷窗', 'ISS Cupola'], h: ['从穹顶舱俯瞰地球', 'Look down on Earth from the Cupola'], go: () => setCockpit(null, 'iss') },
    { id: 'craft', n: ['跟随探测器', 'Follow the probe'], h: ['先在右侧发射一个任务', 'Launch a mission first (right panel)'], go: () => followCraft() },
    { id: 'cockpit', n: ['驾驶视图', 'Onboard camera'], h: ['箭体中部的摄像头看出去', "A camera on the rocket's mid-body"], go: () => setCockpit() },
  ];
  const COCK_LOOKS = {
    rocket: [['back', '回望箭体', 'Look aft'], ['fwd', '前方', 'Forward'], ['earth', '看地球', 'Earth'], ['target', '看目的地', 'Target']],
    iss: [['limb', '地平线', 'Horizon'], ['nadir', '正下方', 'Straight down'], ['moon', '看月亮', 'Moon']],
  };
  function setCockpit(look, vehicle = 'rocket') {
    if (vehicle === 'rocket' && !S.mission) { toast(NO_MISSION()); return; }
    if (S.mode !== 'cockpit' || S.vehicle !== vehicle) startTransition();
    S.mode = 'cockpit';
    S.vehicle = vehicle;
    S.view = vehicle === 'iss' ? 'cupola' : 'cockpit';
    if (!look) look = vehicle === 'iss' ? 'limb' : S.jd < S.mission.tBurn + 0.05 ? 'back' : 'fwd';
    S.cock.fov = 70;
    setCockLook(look);
    refreshUI();
  }
  function setCockLook(look) {
    const k = S.cock;
    k.look = look;
    k.track = look === 'earth' ? 'earth' : look === 'moon' ? 'moon' : look === 'target' ? S.mission.target : null;
    if (look === 'fwd') { k.yaw = 0; k.pitch = 0; }
    if (look === 'back') { k.yaw = Math.PI - 14 * DEG; k.pitch = -4 * DEG; }
    if (look === 'limb') { k.yaw = 0; k.pitch = -12 * DEG; }
    if (look === 'nadir') { k.yaw = 0; k.pitch = -89 * DEG; }
    renderCockpitHud();
  }
  function issView() {
    S.view = 'iss';
    setOrbit('iss', 0.16, 200 * DEG, 20 * DEG, 55, 'iss');
  }
  function followCraft() {
    if (!S.mission) { toast(NO_MISSION()); return; }
    const m = S.mission, pos = allPositions(S.jd);
    S.view = 'craft';
    if (S.jd < m.tLaunch + 0.02) {
      const f = localBasis(m.site, m.tLaunch);
      setOrbit('craft', 0.22, 200 * DEG, 12 * DEG, 50, f);
    } else {
      const frame = craftFrame(S.jd), fp = pos[frame] || bodyPos(frame, S.jd);
      const d = V3.norm(V3.sub(m.pos(S.jd), fp));
      setOrbit('craft', 0.6, Math.atan2(d[1], d[0]) + 150 * DEG, 20 * DEG, 50);
    }
  }
  function localBasis(site, jd) {
    const R = bodyRot('earth', jd), up = M3.apply(R, surfaceUnit(site.lat, site.lon));
    const east = V3.norm(V3.cross([R[2], R[5], R[8]], up)), north = V3.cross(up, east);
    return [east, north, up];
  }
  function applyView(id) {
    const v = VIEWS.find(x => x.id === id);
    S.view = id;
    v.go();
    refreshUI();
  }

  // ─── Input ────────────────────────────────────────────────────────────────
  const canvas = $('scene');
  const pointers = new Map();
  let pinch0 = 0, dragMoved = 0;
  canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, [e.clientX, e.clientY]); dragMoved = 0; if (pointers.size === 2) pinch0 = pinchDist(); });
  canvas.addEventListener('pointerup', e => { pointers.delete(e.pointerId); });
  canvas.addEventListener('pointercancel', e => { pointers.delete(e.pointerId); });
  const pinchDist = () => { const p = [...pointers.values()]; return Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]); };
  canvas.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId), dx = e.clientX - prev[0], dy = e.clientY - prev[1];
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (S.trans) return;
    if (pointers.size === 2) { const d = pinchDist(); if (pinch0 > 0) zoom(Math.log(pinch0 / d) * 700); pinch0 = d; return; }
    dragMoved += Math.abs(dx) + Math.abs(dy);
    if (S.mode === 'orbit') {
      S.orbit.yaw -= dx * 0.005;
      S.orbit.pitch = clamp(S.orbit.pitch + dy * 0.005, -1.56, 1.56);
    } else if (S.mode === 'cockpit') {
      const c = S.cock, k = c.fov * DEG / Scene3D.size[1];
      if ((c.track || c.look) && dragMoved > 3) { c.track = null; c.look = null; renderCockpitHud(); }
      c.yaw -= dx * k;
      c.pitch = clamp(c.pitch + dy * k, -89 * DEG, 89 * DEG);
    } else {
      const k = S.surf.fov * DEG / Scene3D.size[1];
      if (S.surf.track && dragMoved > 3) { S.surf.track = null; renderLookBtns(); }
      S.surf.az -= dx * k;
      S.surf.alt = clamp(S.surf.alt + dy * k, -89.9 * DEG, 89.9 * DEG);
    }
  });
  canvas.addEventListener('wheel', e => { e.preventDefault(); if (!S.trans) zoom(e.deltaY * (e.deltaMode === 1 ? 30 : 1)); }, { passive: false });
  function zoom(delta) {
    if (S.mode === 'orbit') {
      const md = minDist(S.orbit.target), r = targetRadius(S.orbit.target);
      const surfR = Math.min(md, r);
      let alt = Math.max(S.orbit.dist - surfR, 1e-3);
      alt *= Math.exp(delta * 0.0015);
      S.orbit.dist = clamp(surfR + alt, md, 2e11);
    } else if (S.mode === 'cockpit') {
      S.cock.fov = clamp(S.cock.fov * Math.exp(delta * 0.0012), 1, 110);
    } else {
      S.surf.fov = clamp(S.surf.fov * Math.exp(delta * 0.0012), 0.1, 100);
      syncFov();
    }
  }
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.code === 'Space') { e.preventDefault(); S.paused = !S.paused; refreshTimeUI(); }
    if (e.key === '.' || e.key === '>') stepRate(1);
    if (e.key === ',' || e.key === '<') stepRate(-1);
  });
  Scene3D.labelLayer.addEventListener('click', e => {
    const b = e.target.closest('.lbl');
    if (!b) return;
    const id = b.dataset.id;
    if (S.mode === 'surface' && id !== 'craft') { S.surf.track = id; renderLookBtns(); return; }
    if (S.mode === 'cockpit' && id !== 'craft') { S.cock.track = id; S.cock.look = null; renderCockpitHud(); return; }
    focusBody(id);
  });

  // ─── Time controls ────────────────────────────────────────────────────────
  function setRate(v) { S.rate = v; S.paused = false; S.autoPace = false; refreshTimeUI(); refreshMissionUI(); }
  function stepRate(d) {
    let i = RATES.findIndex(r => r.v >= S.rate - 1e-9);
    if (i < 0) i = RATES.length - 1;
    setRate(RATES[clamp(i + d, 0, RATES.length - 1)].v);
  }
  function jumpTo(jd, msg) {
    S.jd = clamp(jd, JD_MIN, JD_MAX);
    if (msg) toast(msg);
    refreshTimeUI();
  }
  const renderRates = () => { $('rates').innerHTML = RATES.map(r => `<button data-v="${r.v}">${tr(r.zh, r.en)}</button>`).join(''); };
  $('rates').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setRate(+b.dataset.v); });
  $('btnPlay').addEventListener('click', () => { S.paused = !S.paused; refreshTimeUI(); });
  $('btnRev').addEventListener('click', () => { S.reverse = !S.reverse; S.autoPace = false; refreshTimeUI(); refreshMissionUI(); });
  $('btnNow').addEventListener('click', () => { S.reverse = false; jumpTo(jdFromMs(Date.now())); setRate(1); toast(tr('已回到现在，时间以真实速度流逝', 'Back to now, with time running at real speed')); });
  $('btnJump').addEventListener('click', () => {
    const v = $('jumpInput').value;
    if (!v) { toast(tr('先选择一个日期和时间', 'Pick a date and time first')); return; }
    const ms = new Date(v).getTime();
    if (!isFinite(ms)) return;
    jumpTo(jdFromMs(ms), tr(`已跳转到 ${fmtDateTime(jdFromMs(ms))}`, `Jumped to ${fmtDateTime(jdFromMs(ms))}`));
  });
  $('btnSolar').addEventListener('click', () => {
    const e = findSolarEclipse(S.jd);
    if (!e) return;
    S.reverse = false;
    jumpTo(e.jd - 70 / 1440);
    S.rate = 45; S.paused = false; S.autoPace = false;
    S.view = null;
    setSurface('earth', { get name() { return tr(`${e.type}中心线`, `Centre line, ${e.type.toLowerCase()}`) + ` (${e.lat.toFixed(1)}°, ${e.lon.toFixed(1)}°)`; }, lat: e.lat, lon: e.lon }, 'sun', 5);
    S.view = null;
    toast(tr(`${e.type}：${fmtDateTime(e.jd)}（${tzName}）。你正站在阴影中心线上，70 分钟后月亮将挡住太阳`,
      `${e.type}: ${fmtDateTime(e.jd)} (${tzName}). You are standing on the centre line; in 70 minutes the Moon covers the Sun`), 7000);
    refreshTimeUI();
  });
  $('btnLunar').addEventListener('click', () => {
    const e = findLunarEclipse(S.jd);
    if (!e) return;
    S.reverse = false;
    const [lat0, lon] = toLatLon('earth', e.g.M, e.jd);
    const lat = lat0 > 20 ? lat0 - 40 : lat0 + 40;
    jumpTo(e.jd - 100 / 1440);
    S.rate = 150; S.paused = false; S.autoPace = false;
    S.view = null;
    setSurface('earth', { get name() { return tr(`可见${e.type}处`, `Where the ${e.type.toLowerCase()} is visible`) + ` (${lat.toFixed(1)}°, ${lon.toFixed(1)}°)`; }, lat, lon }, 'moon', 4);
    S.view = null;
    toast(tr(`${e.type}：${fmtDateTime(e.jd)}（${tzName}）。月亮将慢慢进入地球的影子`,
      `${e.type}: ${fmtDateTime(e.jd)} (${tzName}). Watch the Moon slide into Earth's shadow`), 7000);
    refreshTimeUI();
  });

  // ─── Left panel ───────────────────────────────────────────────────────────
  const renderViews = () => { $('views').innerHTML = VIEWS.map(v => `<button class="view" data-id="${v.id}"><b>${tr(...v.n)}</b><small>${tr(...v.h)}</small></button>`).join(''); };
  $('views').addEventListener('click', e => { const b = e.target.closest('.view'); if (b && !b.disabled) { applyView(b.dataset.id); closeSheet(); } });
  const CHIP_IDS = ['iss', 'sun', 'mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto', 'io', 'europa', 'ganymede', 'callisto', 'titan', 'phobos'];
  const renderChips = () => { $('bodies').innerHTML = CHIP_IDS.map(id => `<button class="chip" data-id="${id}"><i style="background:${id === 'iss' ? '#e8e2d0' : BODY[id].color}"></i>${id === 'iss' ? tr('空间站', 'ISS') : BODY[id].name}</button>`).join(''); };
  $('bodies').addEventListener('click', e => { const b = e.target.closest('.chip'); if (b) { focusBody(b.dataset.id); closeSheet(); } });
  $('tLabels').addEventListener('change', e => { S.toggles.labels = e.target.checked; });
  $('tOrbits').addEventListener('change', e => { S.toggles.orbits = e.target.checked; });
  $('tConst').addEventListener('change', e => { S.toggles.constellations = e.target.checked; });

  // Mobile sheets
  $('tabs').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const cur = document.body.dataset.sheet;
    document.body.dataset.sheet = cur === b.dataset.tab ? 'none' : b.dataset.tab;
    [...$('tabs').children].forEach(x => x.classList.toggle('on', x.dataset.tab === document.body.dataset.sheet));
  });
  function closeSheet() { if (window.innerWidth <= 760) { document.body.dataset.sheet = 'none'; [...$('tabs').children].forEach(x => x.classList.remove('on')); } }

  // ─── Surface HUD ──────────────────────────────────────────────────────────
  const FOV_MIN = Math.log(0.1), FOV_MAX = Math.log(100);
  function syncFov() {
    $('fovRange').value = Math.round((Math.log(S.surf.fov) - FOV_MIN) / (FOV_MAX - FOV_MIN) * 1000);
    $('fovText').textContent = `${S.surf.fov < 2 ? S.surf.fov.toFixed(2) : S.surf.fov.toFixed(0)}°`;
  }
  $('fovRange').addEventListener('input', e => { S.surf.fov = Math.exp(FOV_MIN + (FOV_MAX - FOV_MIN) * e.target.value / 1000); syncFov(); });
  $('siteSel').addEventListener('change', e => {
    const list = SITES[S.surf.body], site = list[+e.target.value];
    if (site) setSurface(S.surf.body, site, S.surf.track, S.surf.fov);
  });
  $('btnLeave').addEventListener('click', () => { S.view = null; focusBody(S.surf.body); });
  function renderLookBtns() {
    $('lookBtns').innerHTML = LOOK[S.surf.body].map(id => `<button class="chip ${S.surf.track === id ? 'on' : ''}" data-id="${id}">${tr('看', '')}${skyName(id)}</button>`).join('');
  }
  $('lookBtns').addEventListener('click', e => { const b = e.target.closest('.chip'); if (b) { S.surf.track = b.dataset.id; renderLookBtns(); } });
  function renderSurfaceHud() {
    const list = SITES[S.surf.body];
    let idx = list.indexOf(S.surf.site);
    let html = list.map((s, i) => `<option value="${i}">${s.name}</option>`).join('');
    if (idx < 0) { html = `<option value="-1">${S.surf.site.name}</option>` + html; idx = -1; }
    $('siteSel').innerHTML = html;
    $('siteSel').value = String(idx);
    renderLookBtns();
    syncFov();
    $('btnPass').hidden = S.surf.body !== 'earth';
  }
  $('btnPass').addEventListener('click', () => {
    const p = ISS.findPass((t, pos) => surfaceFrame(t, pos), S.jd, 30);
    if (!p) { toast(tr('未来 30 天内这里看不到空间站飞过（需要天黑、空间站被阳光照亮，而且飞得够高）', 'No visible ISS pass here in the next 30 days (it needs a dark sky, a sunlit station and a high enough pass)'), 6000); return; }
    S.jd = p.start - 90 / DAY; S.rate = 1; S.paused = false; S.autoPace = false; S.reverse = false;
    S.surf.track = 'iss'; S.surf.fov = 70;
    renderLookBtns(); syncFov(); refreshTimeUI();
    const far = Math.abs(S.jd - ISS.epoch) > 20 ? tr('（离轨道数据日期较远，时间可能偏差几分钟）', ' (far from the orbit data date, so timing may be minutes off)') : '';
    toast(tr(`空间站将于 ${fmtDateTime(p.peak)} 飞过，最高 ${p.maxAlt.toFixed(0)}°。它像一颗快速移动的亮星，几分钟就划过天空${far}`,
      `The ISS passes at ${fmtDateTime(p.peak)}, peaking ${p.maxAlt.toFixed(0)}° up. It looks like a bright, fast star crossing the sky in a few minutes${far}`), 8000);
  });
  const dirName = az => tr('北,东北,东,东南,南,西南,西,西北', 'N,NE,E,SE,S,SW,W,NW').split(',')[Math.round(((az / DEG % 360) + 360) % 360 / 45) % 8];

  // ─── Info panel ───────────────────────────────────────────────────────────
  function infoBodyId() {
    if (S.mode === 'surface') return S.surf.track && S.surf.track !== 'craft' ? S.surf.track : S.surf.body;
    if (S.mode === 'cockpit') return S.vehicle === 'iss' ? 'iss' : 'craft';
    return S.orbit.target;
  }
  let infoKey = '';
  const setHtml = (el, html) => { if (el && el._html !== html) { el.innerHTML = html; el._html = html; } };
  function renderInfo(pos, cam) {
    const id = infoBodyId(), el = $('info');
    const key = `${id}|${S.mode}|${S.mission ? 1 : 0}`;
    if (key !== infoKey) {
      infoKey = key;
      if (id === 'iss') {
        el.innerHTML = `<div class="info-head"><h3>${tr('国际空间站', 'International Space Station')}</h3><span class="kind">${tr('空间站', 'Space station')}</span></div>
          <dl class="rows" id="infoRows"></dl>
          <p class="fact">${tr('每天绕地球约 15.5 圈，宇航员一天能看到 16 次日出和日落。以这个速度，从北京飞到上海只要 2 分 20 秒。', 'It circles Earth about 15.5 times a day, so the crew sees 16 sunrises and sunsets daily. At this speed, Beijing to Shanghai takes 2 min 20 s.')}</p>
          <div class="btn-row"><button class="btn" data-act="cupola">${tr('舷窗视角', 'Cupola view')}</button><button class="btn" data-act="focus" data-id="iss">${tr('跟随空间站', 'Follow the ISS')}</button></div>
          <p class="note-sm">${tr(`轨道数据：${fmtDate(ISS.epoch)} 的真实两行根数（TLE）。离这个日期越远，位置越不准。`, `Orbit: a real TLE from ${fmtDate(ISS.epoch)}. The further from that date, the less exact the position.`)}</p>
          <div id="pulseBox"></div>`;
      } else if (id === 'craft') {
        el.innerHTML = `<div class="info-head"><h3>${S.mission ? S.mission.craft : tr('探测器', 'Probe')}</h3><span class="kind">${tr('航天器', 'Spacecraft')}</span></div>
          <p class="fact" style="border:0;padding:0;margin:0">${tr('真实的火箭只有约 40 米长。把镜头拉远，看看它在太空中有多渺小。', 'The real rocket is only about 40 m long. Zoom out to see how tiny it is in space.')}</p><div id="pulseBox"></div>`;
      } else {
        const b = BODY[id];
        el.innerHTML = `<div class="info-head"><h3>${b.name}</h3><span class="kind">${b.kind}</span></div>
          <dl class="rows" id="infoRows"></dl><p class="fact">${b.fact || ''}</p>
          <div class="btn-row"><button class="btn" data-act="pulse" data-id="${id}" title="${tr('观察光速：光从这里出发，要多久才能到达其他行星', 'Watch the speed of light: how long light from here takes to reach other planets')}">${tr(`从${b.name}发出一束光`, `Send light from ${b.name}`)}</button><button class="btn" data-act="focus" data-id="${id}" title="${tr(`镜头飞到${b.name}近处`, `Fly the camera to ${b.name}`)}">${tr(`飞到${b.name}近处`, `Fly to ${b.name}`)}</button></div>
          <p class="note-sm">${tr('光束：看光以每秒 30 万公里的速度要多久才能走到别的行星。', 'Light beam: see how long light, at 300,000 km per second, takes to reach the other planets.')}</p>
          <div id="pulseBox"></div>`;
      }
    }
    if (id === 'iss') {
      const f = ISS.frame(S.jd), P = V3.add(pos.earth, f.r), [lat, lon] = toLatLon('earth', f.r, S.jd);
      const lit = sunVisibleFraction(P, pos.sun, pos.earth, BODY.earth.radius * 1.02) > 0.5;
      const dCam = V3.len(V3.sub(P, cam.C));
      const ll = `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? tr('N', 'N') : tr('S', 'S')} ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`;
      setHtml($('infoRows'), [
        [tr('高度', 'Altitude'), fmtKm(V3.len(f.r) - BODY.earth.radius)],
        [tr('速度', 'Speed'), `${V3.len(ISS.velGeo(S.jd)).toFixed(2)} km/s <em>${tr('相对地心', 'Earth-centred')}</em>`],
        [tr('绕一圈', 'One orbit'), tr(`${ISS.period.toFixed(1)} 分钟`, `${ISS.period.toFixed(1)} min`) + ` <em>${tr('倾角', 'inclination')} ${ISS.inc.toFixed(1)}°</em>`],
        [tr('正下方', 'Below'), ll],
        [tr('光照', 'Light'), lit ? tr('阳光下', 'In sunlight') : tr('在地球阴影里（夜晚）', "In Earth's shadow (night)")],
        [tr('尺寸', 'Size'), tr('109 × 73 米，约 420 吨', '109 × 73 m, about 420 t')],
        [tr('离镜头', 'From camera'), fmtKm(dCam)],
      ].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join(''));
    } else if (id !== 'craft') {
      const b = BODY[id], P = pos[id];
      const dSun = V3.len(V3.sub(P, pos.sun)), dEarth = V3.len(V3.sub(P, pos.earth)), dCam = V3.len(V3.sub(P, cam.C));
      const rows = [];
      const ratio = (b.radius / BODY.earth.radius).toFixed(b.radius < 3000 ? 3 : 2);
      rows.push([tr('半径', 'Radius'), `${fmtNum(b.radius, b.radius < 100 ? 1 : 0)} km <em>${tr(`· 地球的 ${ratio} 倍`, `· ${ratio} × Earth`)}</em>`]);
      if (id !== 'sun') rows.push([tr('距太阳', 'From Sun'), `${fmtKm(dSun)} <em>${fmtAU(dSun)}</em><br><em>${tr('阳光要走', 'Sunlight takes')} ${fmtDur(dSun / C_KMS)}</em>`]);
      if (id !== 'earth') {
        rows.push([tr('距地球', 'From Earth'), `${fmtKm(dEarth)}<br><em>${tr('无线电信号单程', 'Radio signal, one way:')} ${fmtDur(dEarth / C_KMS)}</em>`]);
        rows.push([tr('地球上看', 'Seen from Earth'), `${tr('视直径', 'Apparent size')} ${fmtAngle(2 * Math.asin(Math.min(1, b.radius / dEarth)))}`]);
      }
      rows.push([tr('离镜头', 'From camera'), `${fmtKm(Math.max(0, dCam - b.radius))} <em>${tr('到表面', 'to surface')}</em>`]);
      const days = d => tr(`${d} 天`, `${d} days`), years = y => tr(`${y} 年`, `${y} years`);
      if (b.period) rows.push([tr('公转', 'Orbit'), b.period > 400 ? years((b.period / 365.25).toFixed(b.period > 3650 ? 1 : 2)) : days(b.period.toFixed(1))]);
      else if (b.orbit) rows.push([tr('公转', 'Orbit'), days(b.orbit[1].toFixed(2))]);
      if (b.day) rows.push([tr('一天', 'Day'), b.day]);
      setHtml($('infoRows'), rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join(''));
    }
    const box = $('pulseBox');
    if (!S.pulses.length) setHtml(box, '');
    else {
      if (!box.querySelector('.pulse')) { box.innerHTML = `<div class="pulse"><div class="ptext"></div><div class="btn-row"><button class="btn" data-act="clearPulse">${tr('清除光束', 'Clear light beam')}</button></div></div>`; box._html = null; }
      const t = box.querySelector('.ptext'), h = pulseHtml(pos);
      if (t._html !== h) { t.innerHTML = h; t._html = h; }
    }
  }
  // Light pulse: an expanding sphere at the speed of light, so you can watch how long
  // sunlight or a radio signal really takes to cross the solar system
  function emitPulse(id) {
    const pos = allPositions(S.jd);
    S.pulses.push({ origin: pos[id].slice(), t0: S.jd, from: id });
    if (S.pulses.length > 2) S.pulses.shift();
    S.paused = false; S.reverse = false; S.autoPace = false; S.rate = 60;
    const dEarth = V3.len(V3.sub(pos.earth, pos[id]));
    S.view = null;
    setOrbit(id, 3.2 * AU, S.orbit.yaw || -1.2, 55 * DEG, 50);
    refreshTimeUI();
    refreshMissionUI();
    const hint = id === 'earth' ? tr('光飞到月球只要 1.3 秒，到火星要好几分钟', 'Light reaches the Moon in 1.3 s but needs several minutes to reach Mars')
      : tr(`按这个速度，光到地球大约要 ${fmtDur(dEarth / C_KMS / 60)}（真实时间 ${fmtDur(dEarth / C_KMS)}）`, `at this speed light reaches Earth in about ${fmtDur(dEarth / C_KMS / 60)} (really ${fmtDur(dEarth / C_KMS)})`);
    toast(tr(`一束光从${BODY[id].name}出发了（那个不断变大的球面）。时间已调成 1分/秒：${hint}`, `Light has left ${BODY[id].name} (the growing sphere). Time now runs at 1 min/s: ${hint}`), 7000);
  }
  $('info').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.act === 'pulse') emitPulse(b.dataset.id);
    if (b.dataset.act === 'focus') focusBody(b.dataset.id);
    if (b.dataset.act === 'cupola') setCockpit(null, 'iss');
    if (b.dataset.act === 'clearPulse') S.pulses = [];
  });
  function pulseHtml(pos) {
    const p = S.pulses[S.pulses.length - 1], r = (S.jd - p.t0) * DAY * C_KMS;
    if (r <= 0) return tr('光还没有发出（当前时间早于发出时刻）', 'The light has not left yet (the clock is before the moment it was sent)');
    const cands = PLANET_IDS.concat('moon', 'sun').filter(id => id !== p.from).map(id => ({ id, d: V3.len(V3.sub(pos[id], p.origin)) })).sort((a, b) => a.d - b.d);
    const reached = cands.filter(c => c.d <= r), next = cands.find(c => c.d > r);
    if (I18N.lang === 'en') return `Light left ${BODY[p.from].name} <b>${fmtDur(r / C_KMS)}</b> ago and has covered ${fmtKm(r)}<br>
      ${reached.length ? `Reached: ${reached.map(c => BODY[c.id].name).join(', ')}` : 'Not at any body yet'}<br>
      ${next ? `Next stop ${BODY[next.id].name}, in <b>${fmtDur((next.d - r) / C_KMS)}</b>` : 'Beyond the planets now'}`;
    return `光从${BODY[p.from].name}出发已 <b>${fmtDur(r / C_KMS)}</b>，走了 ${fmtKm(r)}<br>
      ${reached.length ? `已到达：${reached.map(c => BODY[c.id].name).join('、')}` : '还没有到达任何天体'}<br>
      ${next ? `下一站 ${BODY[next.id].name}，还要 <b>${fmtDur((next.d - r) / C_KMS)}</b>` : '已飞出行星轨道'}`;
  }

  // ─── Missions ─────────────────────────────────────────────────────────────
  const TARGETS = ['moon', 'mars', 'venus', 'jupiter'];
  function planFor() {
    const p = S.plan;
    p.result = null; p.pork = null; p.pick = null;
    if (p.target === 'moon') p.result = planMoonMission(p.site, S.jd);
    else {
      p.pork = porkchop(p.target, S.jd + 0.1);
      p.pick = p.pork.best;
      p.now = bestTofFor(p.target, S.jd + 0.1);
    }
    refreshMissionUI();
    if (p.pork) drawPorkchop();
  }
  function launch(m) {
    if (!m) { toast(tr('这个方案算不出可行轨道，换个日期试试', 'No workable trajectory for this plan. Try another date.')); return; }
    S.mission = m;
    Scene3D.setMission(m);
    S.reverse = false;
    jumpTo(m.tLaunch - 12 / DAY);
    S.paused = false; S.autoPace = true; S.rate = 1;
    followCraft();
    toast(tr(`${m.name}：倒计时开始。“自动调速”会在关键时刻放慢时间`, `${m.name}: countdown started. "Auto pace" slows time down at key moments`));
    refreshMissionUI();
  }
  function launchPlanet(td, tof) {
    const p = S.plan;
    const m = planPlanetMission(p.target, p.site, td, tof);
    launch(m);
  }
  function drawPorkchop() {
    const cv = document.querySelector('#pork canvas');
    if (!cv || !S.plan.pork) return;
    const pk = S.plan.pork, dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = cv.clientWidth, h = cv.clientHeight;
    cv.width = w * dpr; cv.height = h * dpr;
    const x = cv.getContext('2d');
    x.scale(dpr, dpr);
    const nT = pk.tofs.length, best = pk.best.dv, worst = best * 2.3;
    const cw = w / pk.nDep, ch = h / nT;
    for (let i = 0; i < pk.nDep; i++) for (let j = 0; j < nT; j++) {
      const v = pk.grid[i * nT + j];
      if (!(v === v) || v > worst) continue;
      const t = 1 - (v - best) / (worst - best); // 1 = cheapest
      const l = 8 + 62 * Math.pow(t, 1.6);
      x.fillStyle = `hsl(${205 - 170 * t}, ${45 + 45 * t}%, ${l}%)`;
      x.fillRect(i * cw, h - (j + 1) * ch, cw + 0.6, ch + 0.6);
    }
    const mark = (pick, col) => {
      if (!pick) return;
      const cx = (pick.i + 0.5) * cw, cy = h - (pick.j + 0.5) * ch;
      x.strokeStyle = col; x.lineWidth = 1.5;
      x.beginPath(); x.arc(cx, cy, 5, 0, Math.PI * 2); x.stroke();
    };
    mark(pk.best, 'rgba(255,255,255,0.6)');
    mark(S.plan.pick, '#fff');
  }
  function refreshMissionUI() {
    const el = $('mission');
    if (S.mission) { renderMissionHud(); return; }
    const p = S.plan;
    let body = '';
    const zh = I18N.lang === 'zh';
    if (p.target === 'moon') {
      const m = p.result;
      const fly = ((m ? m.tPeri - m.tBurn : 0)).toFixed(1), dv = m ? (m.dv - 9.4).toFixed(2) : '';
      body = m ? `<div class="plan">${zh ? `${p.site.name}下一个发射窗口` : `Next launch window from ${p.site.name}`}：<strong class="num">${fmtDateTime(m.tLaunch)}</strong><br>
        <span class="note">${tr('发射场随地球自转，转到月球轨道平面附近时发射最省燃料。', "The pad rides Earth's rotation; launching as it passes the plane of the Moon's orbit saves fuel.")}</span><br>
        ${zh ? `飞行 <span class="num">${fly}</span> 天 · 入轨后 Δv <span class="num">${dv}</span> km/s` : `Flight <span class="num">${fly}</span> days · Δv after orbit <span class="num">${dv}</span> km/s`}</div>
        <div class="btn-row"><button class="btn primary" data-act="launchMoon">${tr('发射', 'Launch')}</button></div>`
        : `<div class="plan">${tr('暂时算不出可行的转移轨道。', 'No workable transfer orbit found right now.')}</div>`;
    } else if (p.pork) {
      const pk = p.pork, b = pk.best, pick = p.pick, tb = BODY[p.target];
      const tof0 = pk.tofs[0], tof1 = pk.tofs[pk.tofs.length - 1];
      body = `<div class="plan">${zh ? `最佳窗口 <strong class="num">${fmtDate(b.td)}</strong> · 飞行 <span class="num">${b.tof}</span> 天 · 入轨后 Δv <strong class="num">${(b.dv).toFixed(2)}</strong> km/s`
          : `Best window <strong class="num">${fmtDate(b.td)}</strong> · <span class="num">${b.tof}</span>-day flight · Δv after orbit <strong class="num">${(b.dv).toFixed(2)}</strong> km/s`}<br>
        <span class="note">${tr(`地球和${tb.name}的相对位置合适时才能“省力”地飞过去。`, `The trip is only cheap when Earth and ${tb.name} are placed just right.`)}</span></div>
        <div class="pork" id="pork"><canvas aria-label="${tr('发射窗口 Δv 图', 'Launch window Δv chart')}"></canvas>
          <div class="axes"><span>${fmtDate(pk.jd0)}</span><span>${tr(`出发日期 → · 纵轴 飞行 ${tof0}–${tof1} 天`, `Departure date → · up: ${tof0}–${tof1}-day flight`)}</span><span>${fmtDate(pk.jd0 + pk.nDep * pk.step)}</span></div></div>
        <div class="plan">${pick && pick !== b
          ? (zh ? `已选：<span class="num">${fmtDate(pick.td)}</span> 出发 · <span class="num">${pick.tof}</span> 天 · Δv <strong class="num">${pick.dv.toFixed(2)}</strong> km/s<br>`
            : `Selected: depart <span class="num">${fmtDate(pick.td)}</span> · <span class="num">${pick.tof}</span> days · Δv <strong class="num">${pick.dv.toFixed(2)}</strong> km/s<br>`)
          : `<span class="note">${tr('点击图中任意位置，比较不同出发日期的燃料代价（越亮越省）。', 'Click anywhere on the chart to compare the fuel cost of other dates (brighter = cheaper).')}</span><br>`}
          ${zh ? `立即出发：Δv <span class="num">${p.now ? p.now.dv.toFixed(2) : '—'}</span> km/s · 飞行 <span class="num">${p.now ? p.now.tof : '—'}</span> 天`
            : `Leave now: Δv <span class="num">${p.now ? p.now.dv.toFixed(2) : '—'}</span> km/s · <span class="num">${p.now ? p.now.tof : '—'}</span>-day flight`}</div>
        <div class="btn-row"><button class="btn primary" data-act="launchPick">${pick === b ? tr('跳到最佳窗口发射', 'Launch at the best window') : tr('按所选方案发射', 'Launch the selected plan')}</button><button class="btn" data-act="launchNow">${tr('立即发射', 'Launch now')}</button></div>`;
    } else body = `<div class="plan note">${tr('正在计算发射窗口…', 'Working out launch windows…')}</div>`;
    el.innerHTML = `<h2>${tr('发射任务', 'Launch')}</h2>
      <div class="seg" role="group" aria-label="${tr('目的地', 'Destination')}">${TARGETS.map(id => `<button data-target="${id}" class="${p.target === id ? 'on' : ''}">${BODY[id].name}</button>`).join('')}</div>
      <label class="field" for="siteLaunch">${tr('发射场', 'Launch site')} <select id="siteLaunch">${LAUNCH_SITES.map((s, i) => `<option value="${i}" ${s === p.site ? 'selected' : ''}>${s.name}</option>`).join('')}</select></label>
      ${body}`;
    if (p.pork) requestAnimationFrame(drawPorkchop);
  }
  $('mission').addEventListener('change', e => {
    if (e.target.id === 'siteLaunch') { S.plan.site = LAUNCH_SITES[+e.target.value]; if (S.plan.target === 'moon') planFor(); else refreshMissionUI(); }
  });
  $('mission').addEventListener('click', e => {
    const b = e.target.closest('button');
    const cv = e.target.closest('canvas');
    if (cv && S.plan.pork) {
      const r = cv.getBoundingClientRect(), pk = S.plan.pork;
      const i = clamp(Math.floor((e.clientX - r.left) / r.width * pk.nDep), 0, pk.nDep - 1);
      const j = clamp(Math.floor((r.bottom - e.clientY) / r.height * pk.tofs.length), 0, pk.tofs.length - 1);
      const v = pk.grid[i * pk.tofs.length + j];
      if (v === v) { S.plan.pick = { dv: v, td: pk.jd0 + i * pk.step, tof: pk.tofs[j], i, j }; refreshMissionUI(); }
      return;
    }
    if (!b) return;
    if (b.dataset.target) { S.plan.target = b.dataset.target; S.plan.pork = null; S.plan.result = null; refreshMissionUI(); setTimeout(planFor, 30); return; }
    const act = b.dataset.act;
    if (act === 'launchMoon') { planFor(); launch(S.plan.result); }
    if (act === 'launchPick') { const pk = S.plan.pick; if (pk.td < S.jd + 0.1) { launchPlanet(S.jd + 0.1, pk.tof); } else launchPlanet(pk.td, pk.tof); }
    if (act === 'launchNow') { const n = bestTofFor(S.plan.target, S.jd + 0.1); if (n) launchPlanet(n.td, n.tof); }
    if (act === 'follow') followCraft();
    if (act === 'cockpit') setCockpit(null, 'rocket');
    if (act === 'overview') overviewMission();
    if (act === 'end') { S.mission = null; missionHudBuilt = null; Scene3D.setMission(null); if ((S.mode === 'cockpit' && S.vehicle === 'rocket') || (S.mode === 'orbit' && S.orbit.target === 'craft')) focusBody('earth'); refreshMissionUI(); refreshUI(); }
    if (act === 'event') { const ev = S.mission.events[+b.dataset.i]; S.jd = ev.t - 20 / DAY; S.autoPace = true; S.paused = false; refreshMissionUI(); }
  });
  $('mission').addEventListener('change', e => { if (e.target.id === 'autoPace') { S.autoPace = e.target.checked; } });
  function overviewMission() {
    const m = S.mission;
    S.view = null;
    if (m.kind === 'moon') {
      const d = V3.norm(V3.sub(bodyPos('moon', m.tArr), bodyPos('earth', m.tArr)));
      setOrbit('earth', 1.0e6, Math.atan2(d[1], d[0]) - 90 * DEG, 70 * DEG, 50);
    } else setOrbit('sun', Math.max(V3.len(bodyPos(m.target, m.tArr)), AU) * 2.6, S.orbit.yaw, 70 * DEG, 50);
  }
  function craftFrame(jd) {
    const m = S.mission;
    if (!m) return 'earth';
    if (m.kind === 'moon') return jd < m.tArr ? 'earth' : 'moon';
    const tsE = m.paths[0].t1, aA = m.paths[2].t0;
    return jd < tsE ? 'earth' : jd < aA ? 'sun' : m.target;
  }
  let missionHudBuilt = null;
  function renderMissionHud() {
    const m = S.mission, el = $('mission');
    if (missionHudBuilt !== m) {
      missionHudBuilt = m;
      el.innerHTML = `<h2>${m.name} · ${tr(`${m.site.name}发射`, `from ${m.site.name}`)}</h2>
        <div class="met" id="met"></div>
        <div class="phase" id="phase"></div>
        <dl class="rows" id="mstats"></dl>
        <ol class="timeline" id="timeline">${m.events.map((ev, i) => `<li><button data-act="event" data-i="${i}"><span>${ev.label}</span><small>${fmtDateTime(ev.t)}</small></button></li>`).join('')}</ol>
        <div class="btn-row"><button class="btn" data-act="follow">${tr('跟随探测器', 'Follow probe')}</button><button class="btn" data-act="cockpit">${tr('驾驶视图', 'Onboard camera')}</button><button class="btn" data-act="overview">${tr('俯瞰轨道', 'Trajectory overview')}</button><button class="btn" data-act="end">${tr('结束任务', 'End mission')}</button></div>
        <div class="btn-row"><label class="check"><input type="checkbox" id="autoPace" ${S.autoPace ? 'checked' : ''}>${tr('自动调速（关键时刻放慢）', 'Auto pace (slows down at key moments)')}</label></div>`;
    }
    const ap = $('autoPace');
    if (ap) ap.checked = S.autoPace;
  }
  function updateMissionHud(pos) {
    const m = S.mission;
    if (!m || !$('met')) return;
    const t = S.jd - m.tLaunch, s = Math.abs(t) * DAY;
    $('met').textContent = `T${t < 0 ? '−' : '+'} ${s >= 86400 ? Math.floor(s / 86400) + tr(' 天 ', ' d ') : ''}${pad((s % 86400) / 3600)}:${pad((s % 3600) / 60)}:${pad(s % 60)}`;
    const ph = m.phaseAt(S.jd);
    $('phase').innerHTML = ph ? `<b>${ph.label}</b><span>${ph.detail}</span>` : `<b>${tr('发射准备', 'Pre-launch')}</b><span>${tr(`火箭矗立在${m.site.name}发射台上`, `The rocket stands on the pad at ${m.site.name}`)}</span>`;
    const cp = m.pos(S.jd), frame = craftFrame(S.jd), fp = pos[frame] || bodyPos(frame, S.jd);
    const v = V3.len(V3.sub(m.vel(S.jd), bodyVel(frame, S.jd)));
    const dE = V3.len(V3.sub(cp, pos.earth)), dT = V3.len(V3.sub(cp, pos[m.target]));
    const frameName = tr(`相对${BODY[frame].name}`, `rel. to ${BODY[frame].name}`);
    const rows = [
      [tr('距地面', 'Altitude'), `${fmtKm(Math.max(0, dE - BODY.earth.radius))}`],
      [tr(`距${BODY[m.target].name}`, `To ${BODY[m.target].name}`), `${fmtKm(Math.max(0, dT - BODY[m.target].radius))}`],
      [tr('速度', 'Speed'), `${v.toFixed(2)} km/s <em>${frameName}</em>`],
      [tr('信号延迟', 'Signal delay'), `${fmtDur(dE / C_KMS)} <em>${tr('单程', 'one way')}</em>`],
    ];
    $('mstats').innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
    [...$('timeline').children].forEach((li, i) => {
      const ev = m.events[i], nx = m.events[i + 1];
      li.className = S.jd >= ev.t ? (!nx || S.jd < nx.t ? 'now' : 'done') : '';
    });
  }

  // ─── Cockpit HUD ──────────────────────────────────────────────────────────
  function renderCockpitHud() {
    const m = S.mission;
    if (!m && S.vehicle !== 'iss') return;
    const looks = COCK_LOOKS[S.vehicle].map(([id, zh, en]) => [id, id === 'target' ? tr(`看${BODY[m.target].name}`, BODY[m.target].name) : tr(zh, en)]);
    $('cockLooks').innerHTML = looks.map(([id, n]) => `<button class="chip ${S.cock.look === id ? 'on' : ''}" data-look="${id}">${n}</button>`).join('');
  }
  $('cockLooks').addEventListener('click', e => { const b = e.target.closest('[data-look]'); if (b) setCockLook(b.dataset.look); });
  $('btnCockExit').addEventListener('click', () => S.vehicle === 'iss' ? issView() : followCraft());
  function updateCockpitHud(pos, cam) {
    if (S.mode !== 'cockpit') return;
    if (S.vehicle === 'iss') {
      const f = ISS.frame(S.jd), [lat, lon] = toLatLon('earth', f.r, S.jd), P = V3.add(pos.earth, f.r);
      const lit = sunVisibleFraction(P, pos.sun, pos.earth, BODY.earth.radius * 1.02) > 0.5;
      const ll = `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`;
      $('cockRead').innerHTML = `<b>${tr('国际空间站 · 穹顶舱', 'ISS · Cupola')}</b> · ${lit ? tr('阳光下', 'in sunlight') : tr('地球阴影中（夜晚）', "in Earth's shadow (night)")}<br>` + tr(
        `高度 ${fmtKm(V3.len(f.r) - BODY.earth.radius)} · 速度 ${V3.len(ISS.velGeo(S.jd)).toFixed(2)} km/s · 正下方 ${ll} · 视场 ${S.cock.fov.toFixed(0)}°`,
        `Altitude ${fmtKm(V3.len(f.r) - BODY.earth.radius)} · ${V3.len(ISS.velGeo(S.jd)).toFixed(2)} km/s · below: ${ll} · FOV ${S.cock.fov.toFixed(0)}°`);
      return;
    }
    if (!S.cs) return;
    const cs = S.cs, m = S.mission;
    const v = V3.len(V3.sub(m.vel(S.jd), bodyVel(cs.frame, S.jd)));
    const ph = m.phaseAt(S.jd);
    const frameName = BODY[cs.frame].name;
    const engine = cs.burning ? `<em class="hot">${tr('发动机点火', 'Engine firing')}</em>` : S.jd < m.tLaunch ? tr('待发射', 'Awaiting liftoff') : tr('发动机关机 · 惯性滑行', 'Engine off · coasting');
    $('cockRead').innerHTML = `<b>${ph ? ph.label : tr('发射准备', 'Pre-launch')}</b> · ${engine}<br>` + tr(
      `距${frameName}表面 ${fmtKm(Math.max(0, cs.alt))} · 速度 ${v.toFixed(2)} km/s（相对${frameName}）· 视场 ${S.cock.fov.toFixed(0)}°`,
      `${fmtKm(Math.max(0, cs.alt))} above ${frameName} · ${v.toFixed(2)} km/s rel. to ${frameName} · FOV ${S.cock.fov.toFixed(0)}°`);
  }
  // Prograde marker: where the nose (= direction of flight) points on screen
  function placePrograde(cam) {
    const el = $('prograde');
    if (S.mode !== 'cockpit' || !cam.cockpit) { el.hidden = true; return; }
    const sp = Scene3D.project(V3.mul(cam.cockpit.F, 1e3));
    el.hidden = !sp;
    if (sp) el.style.transform = `translate(${sp[0].toFixed(1)}px, ${sp[1].toFixed(1)}px)`;
  }

  // ─── HUD refresh ──────────────────────────────────────────────────────────
  function refreshTimeUI() {
    [...$('rates').children].forEach(b => b.classList.toggle('on', Math.abs(+b.dataset.v - S.rate) < 1e-6 && !S.autoPace));
    $('playIcon').innerHTML = S.paused ? '<path d="M4 2l10 6-10 6z"/>' : '<path d="M4 2h3v12H4zM9 2h3v12H9z"/>';
    $('btnPlay').setAttribute('aria-label', S.paused ? tr('继续', 'Resume') : tr('暂停', 'Pause'));
    $('btnRev').classList.toggle('on', S.reverse);
  }
  function refreshUI() {
    [...$('views').children].forEach(b => { b.classList.toggle('on', b.dataset.id === S.view); if (b.dataset.id === 'craft' || b.dataset.id === 'cockpit') b.disabled = !S.mission; });
    const tgt = S.mode === 'orbit' ? S.orbit.target : null;
    [...$('bodies').children].forEach(b => b.classList.toggle('on', b.dataset.id === tgt));
    $('surfaceHud').hidden = S.mode !== 'surface';
    $('cockpitHud').hidden = S.mode !== 'cockpit';
    $('prograde').hidden = S.mode !== 'cockpit';
    $('scalebar').hidden = S.mode !== 'orbit';
    if (S.mode === 'surface') renderSurfaceHud();
  }
  function updateClock() {
    const d = localDate(S.jd);
    $('clockDate').textContent = `${fmtDate(S.jd)} ${weekday(d)} · ${tzName}`;
    $('clockTime').textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    $('clockRate').textContent = S.paused ? tr('已暂停', 'Paused') : (S.autoPace && S.mission ? tr('自动 · ', 'Auto · ') : '') + rateLabel(S.rate * (S.reverse ? -1 : 1));
    $('clockBadge').hidden = S.jd >= JD_OK0 && S.jd <= JD_OK1;
  }
  function updateScale(cam) {
    if (S.mode !== 'orbit') return;
    const H = Scene3D.size[1], kmPerPx = 2 * S.orbit.dist * Math.tan(cam.fov * DEG / 2) / H;
    let L = Math.pow(10, Math.floor(Math.log10(kmPerPx * 120)));
    for (const f of [1, 2, 5, 10]) if (L * f / kmPerPx >= 70) { L *= f; break; }
    const px = L / kmPerPx;
    $('scaleBar').style.width = `${px.toFixed(0)}px`;
    const au = L >= 0.05 * AU ? ` · ${fmtNum(L / AU, 2)} AU` : '';
    $('scaleText').textContent = `${fmtKm(L)}${au} · ${tr('光走', 'light takes')} ${fmtDur(L / C_KMS)}`;
  }
  function updateSurfaceRead(pos, cam) {
    if (S.mode !== 'surface' || !cam.frame) return;
    const s = S.surf, f = cam.frame;
    const zh = I18N.lang === 'zh', az = ((s.az / DEG % 360 + 360) % 360).toFixed(0), alt = (s.alt / DEG).toFixed(1);
    let txt = zh ? `看向 <em>${dirName(s.az)}</em> ${az}° · 高度 ${alt}°` : `Looking <em>${dirName(s.az)}</em> ${az}° · altitude ${alt}°`;
    if (s.track) {
      const p = targetPos(s.track, pos, S.jd), a = altAz(p, f), d = V3.len(V3.sub(p, f.C));
      const name = skyName(s.track);
      const ang = fmtAngle(2 * Math.asin(Math.min(1, targetRadius(s.track) / d))), talt = (a.alt / DEG).toFixed(1);
      txt = zh ? `<em>${name}</em> 高度 ${talt}° · ${dirName(a.az)} · 视直径 ${ang} · 距离 ${fmtKm(d)}`
        : `<em>${name}</em> altitude ${talt}° · ${dirName(a.az)} · apparent size ${ang} · ${fmtKm(d)} away`;
      if (s.track !== 'sun' && BODY[s.track]) {
        const ph = V3.angle(V3.sub(pos.sun, p), V3.sub(f.C, p)), k = (1 + Math.cos(ph)) / 2, pct = (k * 100).toFixed(0);
        txt += zh ? ` · 被照亮 ${pct}%${k < 0.08 ? '（几乎全暗：太阳在它背后）' : ''}` : ` · ${pct}% lit${k < 0.08 ? ' (nearly dark: the Sun is behind it)' : ''}`;
      }
      if (a.alt < 0) txt += ` · <em>${tr('在地平线以下', 'below the horizon')}</em>`;
    }
    const sunAlt = altAz(pos.sun, f).alt / DEG;
    const sky = S.surf.body === 'moon' ? tr('没有大气，白天也能看到星星', 'No air: stars are visible even by day')
      : sunAlt > 0 ? tr('白天', 'day') : sunAlt > -6 ? tr('黄昏/黎明', 'dusk/dawn') : sunAlt > -18 ? tr('暮光', 'twilight') : tr('夜晚', 'night');
    $('surfRead').innerHTML = `${txt}<br>${S.surf.site.name} · ${tr('太阳高度', 'Sun altitude')} ${sunAlt.toFixed(1)}° · ${sky}`;
  }

  // ─── Main loop ────────────────────────────────────────────────────────────
  let lastT = performance.now(), hudT = 0, first = true;
  function frame(now) {
    const dt = Math.min((now - lastT) / 1000, 0.1);
    lastT = now;
    if (S.mission && S.autoPace && !S.paused) {
      const nx = S.mission.nextEvent(S.jd);
      if (nx) {
        const sec = (nx.t - S.jd) * DAY, pre = S.jd < S.mission.tLaunch;
        S.rate = clamp(sec / 4, pre ? 1 : 20, 864000);
        S.reverse = false;
      } else { S.autoPace = false; S.rate = 60; refreshTimeUI(); renderMissionHud(); }
    }
    if (!S.paused) S.jd = clamp(S.jd + (S.reverse ? -1 : 1) * S.rate * dt / DAY, JD_MIN, JD_MAX);
    const pos = allPositions(S.jd);
    S.cs = craftState(S.jd, pos);
    if (S.mode === 'cockpit' && S.vehicle === 'rocket' && !S.cs) { S.mode = 'orbit'; refreshUI(); }
    const cam = computeCamera(S.jd, pos);
    let sunVis = 1, starDim = 1;
    if (cam.surface) {
      const b = cam.surface.body;
      if (b === 'earth') sunVis = sunVisibleFraction(cam.C, pos.sun, pos.moon, BODY.moon.radius);
      if (b === 'moon') sunVis = sunVisibleFraction(cam.C, pos.sun, pos.earth, BODY.earth.radius * 1.02);
      if (b !== 'moon') {
        const sunAlt = V3.dot(V3.norm(V3.sub(pos.sun, cam.C)), cam.surface.up);
        const sky = smoothstep(-0.2, 0.1, sunAlt) * sunVis;
        starDim = clamp(1 - sky * 1.25, 0.0, 1);
      }
    } else if (cam.skyOnly) {
      const sunAlt = V3.dot(V3.norm(V3.sub(pos.sun, cam.C)), cam.skyOnly.up);
      starDim = clamp(1 - smoothstep(-0.2, 0.1, sunAlt) * cam.skyOnly.fade * 1.25, 0, 1);
    } else if (S.mode === 'orbit') starDim = 0.85;
    const m = S.mission, cs = S.cs;
    const craftPos = cs && cs.craftPos, att = cs && cs.att, burning = !!(cs && cs.burning);
    const pulses = S.pulses.map(p => ({ origin: p.origin, radius: (S.jd - p.t0) * DAY * C_KMS }));
    S.pulses = S.pulses.filter(p => (S.jd - p.t0) * DAY * C_KMS < 120 * AU);
    const issFrame = ISS.frame(S.jd), issPos = V3.add(pos.earth, issFrame.r);
    const localSunVis = sunVisibleFraction(cam.C, pos.sun, pos.earth, BODY.earth.radius * 1.02);
    const focusId = S.mode === 'orbit' ? S.orbit.target : S.mode === 'cockpit' ? S.cock.track : S.surf.track;
    Scene3D.update({ jd: S.jd, pos, C: cam.C, dir: cam.dir, up: cam.up, fov: cam.fov, surface: cam.surface, skyOnly: cam.skyOnly, cockpit: S.mode === 'cockpit' && !S.trans ? S.vehicle : null, issPos, issFrame, localSunVis, sunVis, starDim,
      toggles: S.toggles, mission: m, craftPos, camTargetDist: S.mode === 'orbit' ? S.orbit.dist : S.mode === 'cockpit' ? 1 : null, craftAttitude: att || [0, 0, 1], burning, pulses, focusId });
    if (now - hudT > 120) {
      hudT = now;
      updateClock();
      updateScale(cam);
      updateSurfaceRead(pos, cam);
      updateCockpitHud(pos, cam);
      renderInfo(pos, cam);
      updateMissionHud(pos);
    }
    placePrograde(cam);
    if (first) { first = false; $('loading').classList.add('gone'); setTimeout(() => $('loading').remove(), 800); }
    requestAnimationFrame(frame);
  }

  // ─── Language ─────────────────────────────────────────────────────────────
  function renderLists() {
    renderViews();
    renderChips();
    renderRates();
    refreshTimeUI();
    refreshUI();
  }
  const syncLangSel = () => { $('langSel').value = I18N.pref; };
  $('langSel').addEventListener('change', e => I18N.setPref(e.target.value));
  I18N.onChange(() => {
    renderLists();
    infoKey = '';
    missionHudBuilt = null;
    refreshMissionUI();
    renderCockpitHud();
    Scene3D.relabel();
    syncLangSel();
  });

  // ─── Boot ─────────────────────────────────────────────────────────────────
  renderLists();
  syncLangSel();
  const hash = location.hash.slice(1);
  applyView(VIEWS.some(v => v.id === hash) ? hash : 'earthMoon');
  S.trans = null;
  if (hash === 'cockpit-moon') { S.plan.target = 'moon'; setTimeout(() => { planFor(); launch(S.plan.result); setCockpit(null, 'rocket'); S.trans = null; }, 100); }
  if (hash === 'light') setTimeout(() => emitPulse('sun'), 100);
  if (hash === 'eclipse-solar') setTimeout(() => $('btnSolar').click(), 100);
  if (hash === 'eclipse-lunar') setTimeout(() => $('btnLunar').click(), 100);
  if (hash.startsWith('mission-')) { // deep link: #mission-moon, #mission-mars …
    S.plan.target = hash.slice(8);
    setTimeout(() => { planFor(); if (S.plan.target === 'moon') launch(S.plan.result); else launchPlanet(S.plan.pick.td, S.plan.pick.tof); }, 100);
  }
  refreshTimeUI();
  refreshUI();
  refreshMissionUI();
  if (!hash.startsWith('mission-') && hash !== 'cockpit-moon') setTimeout(planFor, 50);
  requestAnimationFrame(frame);
  setTimeout(() => toast(tr('拖动旋转视角 · 滚轮或双指缩放 · 左侧切换视角，底部控制时间', 'Drag to rotate · scroll or pinch to zoom · views on the left, time controls below')), 1200);
})();
