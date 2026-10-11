'use strict';
// Starship in 3D: Super Heavy and Ship (stainless steel, heat-shield tiles, flaps, grid fins,
// 33 + 6 Raptors), the launch tower with its chopsticks, the launch mount, the Starbase coast,
// engine plumes that balloon as the air thins, steam, the exhaust trail and re-entry plasma.
// Models are built in metres and drawn at true scale (km), camera-relative like everything else.
// Created by Scene3D; update() runs every frame before the scene is rendered.
function StarshipLayer(o) {
  const { scene, renderer, labelLayer, LOG_V, LOG_F, project } = o;
  const MM = 0.001; // metres → km
  const { add, sub, mul, dot, cross } = V3;
  const len = a => Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
  const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const ss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const rnd = i => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const tmpM = new THREE.Matrix4(), vX = new THREE.Vector3(), vY = new THREE.Vector3(), vZ = new THREE.Vector3();
  const setBasis = (obj, X, Y, Z) => { tmpM.makeBasis(vX.set(...X), vY.set(...Y), vZ.set(...Z)); obj.quaternion.setFromRotationMatrix(tmpM); };

  // ─── Materials ────────────────────────────────────────────────────────────
  // Soft sky/ground environment so the steel has something to reflect
  const envTex = (() => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 128;
    const x = c.getContext('2d'), g = x.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, '#5f86c4'); g.addColorStop(0.42, '#b9cde2'); g.addColorStop(0.5, '#e8eef2'); g.addColorStop(0.53, '#8b8572'); g.addColorStop(1, '#2b2a25');
    x.fillStyle = g; x.fillRect(0, 0, 256, 128);
    const t = new THREE.CanvasTexture(c); t.mapping = THREE.EquirectangularReflectionMapping;
    const pm = new THREE.PMREMGenerator(renderer), out = pm.fromEquirectangular(t).texture;
    pm.dispose(); t.dispose();
    return out;
  })();
  const canvas = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.anisotropy = 8; return t; };
  // Stainless hull: weld seams every 1.83 m ring, faint vertical seams, streaks, cryogenic frost
  // over the propellant tanks. Rows: top of the canvas = top of the part.
  function hullTex(hM, frost) {
    return canvas(1024, 2048, (x, w, h) => {
      const img = x.createImageData(w, h), d = img.data;
      for (let j = 0; j < h; j++) {
        const yM = (1 - j / h) * hM, f = frost(yM);
        for (let i = 0; i < w; i++) {
          const k = (j * w + i) * 4;
          const n = rnd(i * 0.37 + j * 13.1) * 0.5 + rnd(Math.floor(i / 9) + Math.floor(j / 3) * 71) * 0.5;
          let v = 196 + (n - 0.5) * 16 + Math.sin(i * 0.05 + j * 0.002) * 4;
          if (f > 0) { const fr = f * (0.55 + 0.45 * rnd(i * 3.1 + j * 7.7)); v = v * (1 - fr) + 238 * fr; }
          d[k] = v; d[k + 1] = v + 2; d[k + 2] = v + 5; d[k + 3] = 255;
        }
      }
      x.putImageData(img, 0, 0);
      x.strokeStyle = 'rgba(70,72,78,0.55)'; x.lineWidth = 2;
      for (let yM = 0; yM < hM; yM += 1.83) { const j = (1 - yM / hM) * h; x.beginPath(); x.moveTo(0, j); x.lineTo(w, j); x.stroke(); }
      x.strokeStyle = 'rgba(80,82,88,0.25)'; x.lineWidth = 1.5;
      for (let i = 0; i < 12; i++) { const u = (i + 0.5) / 12 * w; x.beginPath(); x.moveTo(u, 0); x.lineTo(u, h); x.stroke(); }
    });
  }
  // Ship heat shield: black hexagonal tiles on the windward half (u near 0 / 1 = +Z, the belly)
  function tiled(u) { const a = Math.abs(((u + 0.5) % 1) - 0.5); return a < 0.265; }
  function shipTex(hM, y0, frost, mask) {
    return canvas(1024, 1024, (x, w, h) => {
      if (!mask) {
        const img = x.createImageData(w, h), d = img.data;
        for (let j = 0; j < h; j++) {
          const yM = y0 + (1 - j / h) * hM, f = frost(yM);
          for (let i = 0; i < w; i++) {
            const k = (j * w + i) * 4, n = rnd(i * 0.37 + j * 13.1);
            let v = 196 + (n - 0.5) * 14;
            if (f > 0) { const fr = f * (0.5 + 0.5 * rnd(i * 3.1 + j * 7.7)); v = v * (1 - fr) + 236 * fr; }
            d[k] = v; d[k + 1] = v + 2; d[k + 2] = v + 5; d[k + 3] = 255;
          }
        }
        x.putImageData(img, 0, 0);
      } else { x.fillStyle = '#000'; x.fillRect(0, 0, w, h); }
      // Hex tiles about 0.9 m across
      const circ = 2 * Math.PI * 4.5, tw = 0.95 / circ * w, th = 0.82 / hM * h;
      for (let row = 0; row * th < h + th; row++) {
        for (let col = -1; col * tw < w + tw; col++) {
          const cx = (col + (row % 2) * 0.5) * tw, cy = row * th;
          if (!tiled(cx / w)) continue;
          const sh = mask ? 255 : 26 + rnd(row * 91 + col * 7) * 22;
          x.fillStyle = mask ? '#fff' : `rgb(${sh},${sh},${sh + 2})`;
          x.beginPath();
          for (let k = 0; k < 6; k++) { const a = (k + 0.5) * Math.PI / 3; x.lineTo(cx + Math.cos(a) * tw * 0.56, cy + Math.sin(a) * th * 0.66); }
          x.fill();
        }
      }
    });
  }
  // Metal (blue channel) / roughness (green): bare steel shiny, tiles matte
  const mrTex = mask => canvas(256, 64, (x, w, h) => {
    for (let i = 0; i < w; i++) { const t = mask && tiled(i / w); x.fillStyle = t ? 'rgb(0,225,10)' : 'rgb(0,95,200)'; x.fillRect(i, 0, 1, h); }
  });
  const steelMat = map => new THREE.MeshStandardMaterial({ color: 0xffffff, map, metalness: 1, roughness: 1, metalnessMap: mrTex(false), roughnessMap: mrTex(false), envMap: envTex, envMapIntensity: 1 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b2d31, metalness: 0.4, roughness: 0.6, envMap: envTex, envMapIntensity: 0.6 });
  const nozMat = new THREE.MeshStandardMaterial({ color: 0x4a4038, metalness: 0.7, roughness: 0.42, envMap: envTex, side: THREE.DoubleSide, emissive: 0x000000 });
  const tileMat = new THREE.MeshStandardMaterial({ color: 0x232427, metalness: 0, roughness: 0.85, envMap: envTex, envMapIntensity: 0.4, emissive: 0x000000 });
  const plainSteel = new THREE.MeshStandardMaterial({ color: 0xc7cbd0, metalness: 0.85, roughness: 0.32, envMap: envTex });
  const concrete = new THREE.MeshStandardMaterial({ color: 0x9c9890, metalness: 0, roughness: 0.92 });
  const towerMat = new THREE.MeshStandardMaterial({ color: 0x8d9095, metalness: 0.55, roughness: 0.55, envMap: envTex, envMapIntensity: 0.6 });

  // ─── Geometry helpers ─────────────────────────────────────────────────────
  function merge(geos) {
    const parts = geos.map(g => (g.index ? g.toNonIndexed() : g));
    let n = 0;
    for (const g of parts) n += g.attributes.position.count;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
    let o2 = 0;
    for (const g of parts) {
      pos.set(g.attributes.position.array, o2 * 3); nor.set(g.attributes.normal.array, o2 * 3);
      if (g.attributes.uv) uv.set(g.attributes.uv.array, o2 * 2);
      o2 += g.attributes.position.count;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return out;
  }
  // A square beam from a to b (THREE.Vector3), w × w
  function beam(a, b, w, d = w) {
    const dir = new THREE.Vector3().subVectors(b, a), L = dir.length();
    const g = new THREE.BoxGeometry(w, L, d);
    const m = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
    m.setPosition(a.clone().addScaledVector(dir, L / 2));
    g.applyMatrix4(m);
    return g;
  }
  const box = (sx, sy, sz, x, y, z) => { const g = new THREE.BoxGeometry(sx, sy, sz); g.translate(x, y, z); return g; };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  // Raptor nozzle bell, exit at y = 0, throat at +len
  function bell(rExit, L, seg = 20) {
    const pts = [];
    for (let i = 0; i <= 8; i++) { const s = i / 8; pts.push(new THREE.Vector2(rExit * (0.32 + 0.68 * Math.pow(1 - s, 1.6)), s * L)); }
    return new THREE.LatheGeometry(pts, seg);
  }

  // ─── Super Heavy ──────────────────────────────────────────────────────────
  // Local frame: +Y nose, +Z the side that faces east on the pad, +X north. Origin: base centre.
  const ENGINE_LAYOUT = (() => { // 3 centre, 10 inner ring, 20 outer ring
    const L = [];
    for (let k = 0; k < 3; k++) { const a = k * 2 * Math.PI / 3 + 0.5; L.push([Math.cos(a) * 0.95, Math.sin(a) * 0.95]); }
    for (let k = 0; k < 10; k++) { const a = k * 2 * Math.PI / 10; L.push([Math.cos(a) * 2.35, Math.sin(a) * 2.35]); }
    for (let k = 0; k < 20; k++) { const a = (k + 0.5) * 2 * Math.PI / 20; L.push([Math.cos(a) * 3.8, Math.sin(a) * 3.8]); }
    return L;
  })();
  function buildBooster(veh) {
    const h = veh.booster.h, g = new THREE.Group(), R = 4.5, ring = 2.2;
    // Frost over the LOX tank (lower ~60 %) and methane tank, clear around the common dome
    const frost = y => (y > 6 && y < h * 0.56 ? 0.75 : y > h * 0.6 && y < h - 7 ? 0.55 : 0) * ss(4, 9, y);
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(R, R, h - ring, 72, 1, true), steelMat(hullTex(h - ring, frost)));
    tank.position.y = (h - ring) / 2;
    g.add(tank);
    const base = new THREE.Mesh(new THREE.CircleGeometry(R, 48), dark); base.rotation.x = Math.PI / 2; base.position.y = 0.4; g.add(base);
    // Hot-stage ring: vented interstage on top (jettisoned on Block 2)
    const hsr = new THREE.Group();
    const ventTex = canvas(512, 64, (x, w, hh) => {
      x.fillStyle = '#2e3034'; x.fillRect(0, 0, w, hh);
      x.fillStyle = '#0a0a0b';
      for (let i = 0; i < 24; i++) x.fillRect(i / 24 * w + 3, 12, w / 24 - 9, hh - 22);
    });
    const ringM = new THREE.Mesh(new THREE.CylinderGeometry(R, R, ring, 72, 1, true), new THREE.MeshStandardMaterial({ map: ventTex, metalness: 0.5, roughness: 0.55, envMap: envTex, side: THREE.DoubleSide }));
    ringM.position.y = h - ring / 2; hsr.add(ringM);
    const dome = new THREE.Mesh(new THREE.CircleGeometry(R, 48), plainSteel); dome.rotation.x = -Math.PI / 2; dome.position.y = h - ring + 0.3; hsr.add(dome);
    g.add(hsr);
    // Grid fins: lattice with real holes
    const finTex = canvas(128, 128, (x, w, hh) => {
      x.fillStyle = '#000'; x.fillRect(0, 0, w, hh); x.strokeStyle = '#fff'; x.lineWidth = 5;
      for (let i = -w; i < 2 * w; i += 16) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + hh, hh); x.stroke(); x.beginPath(); x.moveTo(i, hh); x.lineTo(i + hh, 0); x.stroke(); }
      x.lineWidth = 10; x.strokeRect(0, 0, w, hh);
    });
    const finMat = new THREE.MeshStandardMaterial({ color: 0x55585e, metalness: 0.6, roughness: 0.5, alphaMap: finTex, alphaTest: 0.5, side: THREE.DoubleSide, envMap: envTex });
    const nF = veh.booster.fins, fw = nF === 3 ? 6.4 : 5.6, fh = nF === 3 ? 4.6 : 4.0;
    for (let k = 0; k < nF; k++) {
      const a = nF === 3 ? k * 2 * Math.PI / 3 + Math.PI / 2 : (k + 0.5) * Math.PI / 2;
      const fin = new THREE.Mesh(new THREE.BoxGeometry(fw, fh, 0.55), finMat);
      fin.position.set(Math.sin(a) * (R + fw / 2 + 0.2), h - ring - 4.2, Math.cos(a) * (R + fw / 2 + 0.2));
      fin.rotation.y = a - Math.PI / 2;
      g.add(fin);
    }
    // Catch pins (north / south) and the external raceway (west)
    g.add(new THREE.Mesh(merge([box(1.2, 0.9, 1.6, R + 0.5, h - ring - 7.4, 0), box(1.2, 0.9, 1.6, -R - 0.5, h - ring - 7.4, 0),
      box(0.7, h - 12, 0.6, 0, (h - 12) / 2 + 5, -R - 0.15), box(2.4, 3.2, 0.9, 0, 4, -R - 0.3)]), dark));
    // 33 Raptors under the aft skirt
    const bells = [];
    ENGINE_LAYOUT.forEach(([x, z], i) => { const b = bell(0.66, 1.35); b.translate(x, i < 13 ? -1.05 : -0.75, z); bells.push(b); });
    g.add(new THREE.Mesh(merge(bells), nozMat));
    g.add(new THREE.Mesh(merge([new THREE.CylinderGeometry(R + 0.02, R + 0.02, 0.6, 72, 1, true).translate(0, 0.3, 0)]), dark));
    g.scale.setScalar(MM);
    g.userData = { hsr, h };
    return g;
  }

  // ─── Ship ─────────────────────────────────────────────────────────────────
  const SHIP_ENGINES = (() => { // 3 sea-level (centre), 3 vacuum (outer)
    const L = [];
    for (let k = 0; k < 3; k++) { const a = k * 2 * Math.PI / 3; L.push([Math.sin(a) * 1.35, Math.cos(a) * 1.35, 0]); }
    for (let k = 0; k < 3; k++) { const a = k * 2 * Math.PI / 3 + Math.PI / 3; L.push([Math.sin(a) * 3.1, Math.cos(a) * 3.1, 1]); }
    return L;
  })();
  // Payload: Starlink satellites ride flat, stacked one above another on two rails ("Pez"
  // dispenser) above a slot door in the leeward hull. Each is pushed out horizontally through
  // the door, then the stack steps down so the next one lines up with the slot.
  const DOOR_Y = 30;                // slot centre, metres above the ship's base (the physics releases satellites here)
  const SLIDE_V = 0.45, SLIDE_OUT = 4.9; // push-out speed (m/s) and where free flight takes over (m from the axis)
  const SLIDE = SLIDE_OUT / SLIDE_V;
  const satDims = type => (type === 'v3' ? [5.6, 0.35, 3.0] : [4.1, 0.3, 2.7]); // width, thickness, depth (m)
  const satMats = (() => {
    const side = new THREE.MeshStandardMaterial({ color: 0x2f3237, metalness: 0.5, roughness: 0.5, envMap: envTex });
    const top = new THREE.MeshStandardMaterial({ color: 0xb9bec6, metalness: 0.85, roughness: 0.28, envMap: envTex });
    const bottom = new THREE.MeshStandardMaterial({ color: 0x1d1f23, metalness: 0.3, roughness: 0.7, envMap: envTex });
    return [side, side, top, bottom, side, side]; // BoxGeometry faces: +X −X +Y −Y +Z −Z
  })();
  const satGeometry = type => { const [w, t, d] = satDims(type); return new THREE.BoxGeometry(w, t, d); };

  function buildShip(veh, payload) {
    const h = veh.ship.h, body = 33, g = new THREE.Group(), R = 4.5, TAU = 2 * Math.PI;
    const frost = y => (y > 3 && y < 20 ? 0.6 : y > 21 && y < 27 ? 0.45 : 0) * ss(2, 5, y);
    const bodyMap = shipTex(body, 0, frost), bodyMask = shipTex(body, 0, frost, true);
    const mk = (map, mask, side = THREE.FrontSide) => new THREE.MeshStandardMaterial({ color: 0xffffff, map, metalness: 1, roughness: 1, metalnessMap: mrTex(true), roughnessMap: mrTex(true),
      envMap: envTex, emissive: 0x000000, emissiveMap: mask, side });
    const bodyMat = mk(bodyMap, bodyMask);
    // Hull, built in pieces so the payload slot is a real opening; UVs are remapped so the
    // weld seams and tiles run continuously across the pieces
    const [sw, st, sd] = satDims(payload.type);
    const DW = sw + 0.8, DH = 1.25, half = DW / 2 / R, y0 = DOOR_Y - DH / 2, y1 = DOOR_Y + DH / 2;
    const hull = (ya, yb, th0, thL) => {
      const geo = new THREE.CylinderGeometry(R, R, yb - ya, Math.max(6, Math.round(96 * thL / TAU)), 1, true, th0, thL);
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (th0 + uv.getX(i) * thL) / TAU, (ya + uv.getY(i) * (yb - ya)) / body);
      geo.translate(0, (ya + yb) / 2, 0);
      return geo;
    };
    g.add(new THREE.Mesh(merge([hull(0, y0, 0, TAU), hull(y0, y1, Math.PI + half, TAU - 2 * half), hull(y1, body, 0, TAU)]), bodyMat));
    // Nose: tangent ogive, full radius at its base (y = 0), closing to the tip at y = Ln
    const pts = [], Ln = h - body, rho = (R * R + Ln * Ln) / (2 * R);
    for (let i = 0; i <= 32; i++) { const y = i / 32 * Ln; pts.push(new THREE.Vector2(Math.max(0.04, Math.sqrt(Math.max(0, rho * rho - y * y)) + R - rho), body + y)); }
    const rAt = y => (y <= body ? R : Math.sqrt(Math.max(0, rho * rho - (y - body) ** 2)) + R - rho);
    const noseMat = mk(shipTex(Ln, body, () => 0), shipTex(Ln, body, () => 0, true));
    g.add(new THREE.Mesh(new THREE.LatheGeometry(pts, 96), noseMat));
    // Aft skirt and dome; leeward raceway
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.03, R + 0.03, 1.3, 96, 1, true), dark); skirt.position.y = 0.65; g.add(skirt);
    const base = new THREE.Mesh(new THREE.CircleGeometry(R, 48), dark); base.rotation.x = Math.PI / 2; base.position.y = 0.6; g.add(base);
    const rw = Math.PI - half - 0.22; // raceway runs beside the door
    g.add(new THREE.Mesh(merge([box(0.45, body - 4, 0.35, Math.sin(rw) * (R + 0.1), (body - 4) / 2 + 2, Math.cos(rw) * (R + 0.1))]), dark));

    // Flaps: swept trapezoids, heat-shield tiles on the windward (+Z) face, steel behind,
    // each on a hinge (pivot rotation.y folds it towards the leeward side)
    const flapMesh = (P, s, t) => {
      const shape = new THREE.Shape(P.map(([x, y]) => new THREE.Vector2(s * x, y)));
      const tile = new THREE.ExtrudeGeometry(shape, { depth: t / 2, bevelEnabled: false });
      const steel = new THREE.ExtrudeGeometry(shape, { depth: t / 2, bevelEnabled: false }); steel.translate(0, 0, -t / 2);
      const grp = new THREE.Group();
      grp.add(new THREE.Mesh(tile, tileMat), new THREE.Mesh(steel, plainSteel));
      return grp;
    };
    const flaps = { aft: [], fwd: [] };
    const AFT = [[0, 0], [4.5, 1.1], [4.1, 9.4], [0, 11.4]], FWD = [[0, 0], [3.0, 1.3], [2.8, 4.7], [0, 6.8]];
    for (const s of [-1, 1]) {
      const zA = 0.7, aft = new THREE.Group();
      aft.position.set(s * Math.sqrt(R * R - zA * zA), 1.4, zA);
      aft.add(flapMesh(AFT, s, 0.55));
      g.add(aft); aft.userData.s = s; flaps.aft.push(aft);
      g.add(new THREE.Mesh(merge([box(0.8, 11.6, 1.1, s * (R + 0.15), 1.4 + 5.8, zA)]), dark)); // hinge fairing
      // Forward flaps sit on the nose, a little towards the leeward side, leaning with its taper
      const fy = body + 4, fy2 = fy + 6.8, zF = -0.8, rf = rAt(fy), lean = Math.atan((rAt(fy) - rAt(fy2)) / 6.8);
      const holder = new THREE.Group(), fwd = new THREE.Group();
      holder.position.set(s * Math.sqrt(rf * rf - zF * zF), fy, zF); holder.rotation.z = s * lean;
      fwd.add(flapMesh(FWD, s, 0.45)); holder.add(fwd); g.add(holder);
      fwd.userData.s = s; flaps.fwd.push(fwd);
      const fair = new THREE.Mesh(new THREE.BoxGeometry(0.7, 7.1, 0.9), dark); fair.position.set(s * 0.1, 3.4, 0); holder.add(fair);
    }

    // Payload bay seen through the slot: dark inner wall following the hull and nose, a floor,
    // the slot's sills and jambs, the two dispenser rails, a pusher
    const bayPts = [new THREE.Vector2(0.01, DOOR_Y - 2.5), new THREE.Vector2(R - 0.12, DOOR_Y - 2.5)];
    for (let y = DOOR_Y - 2.5; y <= h - 6; y += 0.5) bayPts.push(new THREE.Vector2(Math.max(0.05, rAt(y) - 0.12), y));
    const bayMat = new THREE.MeshStandardMaterial({ color: 0x3a3d43, metalness: 0.4, roughness: 0.7, side: THREE.BackSide, envMap: envTex, envMapIntensity: 0.3 });
    g.add(new THREE.Mesh(new THREE.LatheGeometry(bayPts, 48), bayMat));
    const cz = -R * Math.cos(half), frame = [];
    frame.push(box(DW, 0.12, 0.4, 0, y0, cz + 0.15), box(DW, 0.12, 0.4, 0, y1, cz + 0.15));
    for (const s of [-1, 1]) frame.push(box(0.12, DH, 0.4, s * R * Math.sin(half), DOOR_Y, cz + 0.15));
    const railX = sw / 2 + 0.22, stackTop = DOOR_Y + Math.max(1, payload.count) * (st + 0.12) + 0.6;
    for (const s of [-1, 1]) frame.push(box(0.2, stackTop - (DOOR_Y - 1.2), 0.5, s * railX, (stackTop + DOOR_Y - 1.2) / 2, 0.2));
    g.add(new THREE.Mesh(merge(frame), new THREE.MeshStandardMaterial({ color: 0x55585f, metalness: 0.7, roughness: 0.4, envMap: envTex })));
    const pusher = new THREE.Mesh(new THREE.BoxGeometry(sw * 0.55, 0.22, 0.3), dark); g.add(pusher);
    // Floodlights in the bay, on while the door is open
    const bayLight = new THREE.PointLight(0xfff1dc, 0, 0.016, 1.6); bayLight.position.set(0, DOOR_Y + 1.6, -1.2); g.add(bayLight);
    // The satellites themselves, flat in the stack (ship frame: x across the slot, z out of it)
    const bay = [];
    const satG = satGeometry(payload.type);
    for (let i = 0; i < payload.count; i++) { const m = new THREE.Mesh(satG, satMats); g.add(m); bay.push(m); }
    // Door: a curved panel cut from the hull, hinged along the slot's top edge, swinging outwards
    const door = new THREE.Group();
    door.position.set(0, y1, cz);
    const dg = hull(y0, y1, Math.PI - half, 2 * half); dg.translate(0, -y1, -cz);
    door.add(new THREE.Mesh(dg, mk(bodyMap, bodyMask, THREE.DoubleSide)));
    g.add(door);

    const bells = [];
    for (const [x, z, vac] of SHIP_ENGINES) { const b = vac ? bell(1.15, 2.7) : bell(0.66, 1.35); b.translate(x, vac ? -1.9 : -0.9, z); bells.push(b); }
    g.add(new THREE.Mesh(merge(bells), nozMat));
    g.scale.setScalar(MM);
    g.userData = { mats: [bodyMat, noseMat], h, door, flaps, bay, pusher, bayLight, pitch: st + 0.12, sd };
    return g;
  }
  // Dispenser and flaps at time t: door angle, stack height, which satellite is sliding out
  function animateShip(shipG, t, TL, T, sats) {
    const u = shipG.userData, when = sats.map(s => s.s.t0), n = when.length;
    if (n) {
      const open = ss(when[0] - SLIDE - 70, when[0] - SLIDE - 58, t) * (1 - ss(when[n - 1] + 20, when[n - 1] + 32, t));
      u.door.rotation.x = 1.75 * open;
      u.bayLight.intensity = 2.2 * open;
      // Elevator: after each satellite leaves, the stack steps down one slot
      let k = 0;
      for (let j = 1; j < n; j++) k += ss(when[j - 1] + 3, when[j - 1] + 11, t);
      let pz = u.sd / 2 + 0.2;
      u.bay.forEach((m, j) => {
        const slide = clamp((t - (when[j] - SLIDE)) / SLIDE, 0, 1);
        m.visible = t < when[j];
        m.position.set(0, DOOR_Y + (j - k) * u.pitch, -SLIDE_OUT * slide);
        if (slide > 0 && slide < 1) pz = Math.max(-3.6, m.position.z + u.sd / 2 + 0.2);
        else if (slide >= 1 && t < when[j] + 6) pz = Math.min(u.sd / 2 + 0.2, -3.6 + (t - when[j]) * 1.0); // pusher retracts
      });
      u.pusher.position.set(0, DOOR_Y, pz);
    }
    // Flaps: neutral on the way up, small corrections through entry, working hard in the belly
    // flop, forward flaps folded away for the landing flip
    const w = (a, f, ph) => a * Math.sin(t * f + ph);
    let aft = 0.15, fwd = 0.15;
    if (t > T.entry - 300 && t < (T.shipSubsonic || T.flip)) { aft = 0.12 + w(0.05, 0.9, 0); fwd = 0.18 + w(0.05, 0.7, 1); }
    if (T.shipSubsonic && t >= T.shipSubsonic && t < T.flip) { aft = 0.3 + w(0.14, 1.4, 0); fwd = 0.25 + w(0.14, 1.1, 1.3); }
    if (t >= T.flip) { const k = ss(T.flip, T.flip + 3, t); aft = 0.3 + 0.25 * k; fwd = 0.25 + 1.1 * k; }
    for (const f of u.flaps.aft) f.rotation.y = f.userData.s * aft;
    for (const f of u.flaps.fwd) f.rotation.y = f.userData.s * fwd;
  }

  // ─── Launch tower ("Mechazilla"), launch mount, tank farm ─────────────────
  // Local frame: x east, y north, z up, metres; origin: launch mount centre at ground level.
  const TOWER = { x: -23, y: 0, half: 6.2, h: 140 };
  function buildPad() {
    const g = new THREE.Group(), T = TOWER, parts = [];
    const cx = T.x, cy = T.y, a = T.half, lv = 9.33;
    const corners = [[-a, -a], [a, -a], [a, a], [-a, a]];
    for (const [dx, dy] of corners) parts.push(beam(V(cx + dx, cy + dy, 0), V(cx + dx, cy + dy, T.h), 1.3));
    for (let z = 0; z < T.h - 1; z += lv) {
      for (let k = 0; k < 4; k++) {
        const [x0, y0] = corners[k], [x1, y1] = corners[(k + 1) % 4];
        parts.push(beam(V(cx + x0, cy + y0, z + lv), V(cx + x1, cy + y1, z + lv), 0.6));
        parts.push(beam(V(cx + x0, cy + y0, z), V(cx + x1, cy + y1, z + lv), 0.42));
        parts.push(beam(V(cx + x1, cy + y1, z), V(cx + x0, cy + y0, z + lv), 0.42));
      }
    }
    parts.push(beam(V(cx, cy, T.h), V(cx, cy, T.h + 12), 0.7)); // lightning mast
    parts.push(box(2 * a + 1.5, 2 * a + 1.5, 1.2, cx, cy, T.h)); // roof deck
    g.add(new THREE.Mesh(merge(parts), towerMat));
    // Orbital launch mount: ring table on six legs over a water-cooled steel flame deflector
    const olm = [];
    for (let k = 0; k < 6; k++) { const an = (k + 0.5) * Math.PI / 3; olm.push(box(3.2, 3.2, 16, Math.cos(an) * 10.5, Math.sin(an) * 10.5, 8)); }
    const table = new THREE.RingGeometry(4.75, 12, 48, 1); table.translate(0, 0, 20);
    const tableSide = new THREE.CylinderGeometry(12, 12, 4, 48, 1, true); tableSide.rotateX(Math.PI / 2); tableSide.translate(0, 0, 18);
    const tableIn = new THREE.CylinderGeometry(4.75, 4.75, 4, 48, 1, true); tableIn.rotateX(Math.PI / 2); tableIn.translate(0, 0, 18);
    const tableBot = new THREE.RingGeometry(4.75, 12, 48, 1); tableBot.rotateX(Math.PI); tableBot.translate(0, 0, 16);
    for (let k = 0; k < 20; k++) { const an = k * Math.PI / 10; olm.push(box(0.9, 0.9, 1.4, Math.cos(an) * 5.3, Math.sin(an) * 5.3, 20.7)); }
    olm.push(box(3, 4, 5, -9, 0, 22.5)); // booster quick disconnect
    g.add(new THREE.Mesh(merge([...olm, table, tableSide, tableIn, tableBot]), towerMat));
    const defl = new THREE.Mesh(new THREE.CylinderGeometry(11, 12.5, 1.6, 48), plainSteel); defl.rotation.x = Math.PI / 2; defl.position.z = 0.8; g.add(defl);
    // Tank farm and propellant lines to the south-west
    const tanks = [];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) { const t = new THREE.CylinderGeometry(4.6, 4.6, 32, 28); t.rotateX(Math.PI / 2); t.translate(-110 + i * 12, -95 + j * 13, 16); tanks.push(t); }
    for (let i = 0; i < 3; i++) { const t = new THREE.CylinderGeometry(3, 3, 26, 20); t.rotateZ(Math.PI / 2); t.translate(-150, -70 + i * 8, 3.2); tanks.push(t); }
    tanks.push(box(4, 120, 1.5, -60, -45, 1)); tanks.push(box(80, 2, 1.5, -100, -100, 1));
    g.add(new THREE.Mesh(merge(tanks), new THREE.MeshStandardMaterial({ color: 0xd9dbd6, metalness: 0.4, roughness: 0.5, envMap: envTex })));
    // Chopsticks: a carriage around the tower with two arms reaching over the mount
    const carriage = new THREE.Group();
    const cp = [];
    const ca = a + 1.6;
    cp.push(box(2 * ca, 1.4, 7, cx, cy - ca, 0), box(2 * ca, 1.4, 7, cx, cy + ca, 0), box(1.4, 2 * ca, 7, cx - ca, cy, 0), box(1.4, 2 * ca, 7, cx + ca, cy, 0));
    carriage.add(new THREE.Mesh(merge(cp), towerMat));
    const arms = [];
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(cx + ca, cy + s * 6.6, 0);
      const ag = [box(33, 2.2, 3.6, 16.5, 0, -0.4), box(30, 1.0, 0.8, 15.5, -s * 0.9, 1.8), box(30, 0.6, 0.6, 16, s * 0.6, -2.2)];
      for (let k = 0; k < 6; k++) ag.push(beam(V(2 + k * 5, 0, -2.2), V(4.5 + k * 5, 0, 1.4), 0.35));
      pivot.add(new THREE.Mesh(merge(ag), towerMat));
      pivot.userData.side = s;
      carriage.add(pivot);
      arms.push(pivot);
    }
    g.add(carriage);
    // Ship quick-disconnect arm
    const qd = new THREE.Group();
    qd.position.set(cx + a + 0.6, cy - 4.2, 0);
    qd.add(new THREE.Mesh(merge([box(17.5, 2.4, 3.2, 8.75, 0, 0), box(2.6, 4, 5, 16.8, 2.2, 0)]), towerMat));
    g.add(qd);
    g.scale.setScalar(MM);
    return { g, carriage, arms, qd };
  }

  // ─── Ground: curved patch of the Starbase coast (or open sea at a splashdown) ──
  const R_E = BODY.earth.radius * 1000;
  const groundGeo = (() => {
    const RING = [0];
    for (let r = 8; r < 820e3; r *= 1.075) RING.push(r);
    const SEG = 160, pos = [], loc = [], idx = [];
    for (let i = 0; i < RING.length; i++) {
      const s = RING[i], k = s > 0 ? R_E * Math.sin(s / R_E) / s : 1, z = R_E * (Math.cos(s / R_E) - 1);
      for (let j = 0; j < SEG; j++) {
        const a = j / SEG * 2 * Math.PI, e = Math.cos(a) * s, n = Math.sin(a) * s;
        pos.push(e * k, n * k, z); loc.push(e / 1000, n / 1000);
      }
    }
    for (let i = 0; i < RING.length - 1; i++) for (let j = 0; j < SEG; j++) {
      const a = i * SEG + j, b = i * SEG + (j + 1) % SEG, c = a + SEG, d = b + SEG;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('loc', new THREE.Float32BufferAttribute(loc, 2));
    g.setIndex(idx);
    return g;
  })();
  const GROUND_VS = LOG_V + `
    attribute vec2 loc; varying vec2 vLoc; varying vec3 vP; varying vec3 vN;
    void main() {
      vLoc = loc;
      vec4 wp = modelMatrix * vec4(position, 1.0); vP = wp.xyz;
      vN = normalize(mat3(modelMatrix) * (position + vec3(0.0, 0.0, ${R_E.toFixed(1)})));
      gl_Position = projectionMatrix * viewMatrix * wp;
      #include <logdepthbuf_vertex>
    }`;
  const GROUND_FS = LOG_F + `
    uniform vec3 sunDir; uniform float sunVis; uniform float mode; uniform float fade; uniform vec3 hor; uniform float day;
    uniform vec2 padB; uniform float camH; uniform vec3 eastW; uniform vec3 northW; uniform vec4 flameL; uniform float time;
    varying vec2 vLoc; varying vec3 vP; varying vec3 vN;
    float hsh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hsh(i), hsh(i + vec2(1, 0)), f.x), mix(hsh(i + vec2(0, 1)), hsh(i + vec2(1, 1)), f.x), f.y); }
    float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vn(p); p = p * 2.07 + 13.1; a *= 0.5; } return s; }
    // Boca Chica beach: the shore runs a little west of north about 750 m east of Pad 1
    float coastX(float y) { return 0.75 - 0.0626 * y + 0.05 * sin(y * 0.7) + 0.02 * sin(y * 3.1); }
    // 0 = land, 1 = water (km east / north of Pad 1)
    float water(vec2 p) {
      if (mode > 0.5) return 1.0;
      float cx = coastX(p.y), w = smoothstep(-0.004, 0.004, p.x - cx);
      if (p.y > 7.55 && p.y < 8.15 && p.x > -3.0) w = 1.0;                      // Brazos Santiago Pass
      if (p.y >= 8.15 && p.x < cx - 0.85 && p.x > -6.0 - 0.15 * (p.y - 8.0)) w = 1.0; // Laguna Madre behind South Padre Island
      vec2 q = (p - vec2(-2.9, 4.7)) / vec2(2.3, 1.9);
      if (length(q) + (fbm(p * 2.0) - 0.5) * 0.35 < 1.0) w = 1.0;               // South Bay
      float yr = -4.55 + 0.35 * sin(p.x * 1.7) + 0.18 * sin(p.x * 4.3);
      if (abs(p.y - yr) < 0.045 && p.x < cx) w = 1.0;                             // Rio Grande
      float lag = fbm(p * 1.3 + 4.0);
      if (p.x < cx - 1.2 && lag > 0.66 && p.y > -4.0) w = max(w, smoothstep(0.66, 0.7, lag)); // ephemeral tidal lagoons
      return w;
    }
    void main() {
      #include <logdepthbuf_fragment>
      vec2 p = vLoc;
      float r = length(p);
      vec3 N = normalize(vN), V = normalize(-vP), L = normalize(sunDir);
      float w = water(p);
      // Land: tidal flats, dunes, scrub; farm fields far inland
      float n1 = fbm(p * 0.9), n2 = fbm(p * 7.0), n3 = vn(p * 60.0);
      vec3 flats = mix(vec3(0.62, 0.58, 0.49), vec3(0.42, 0.40, 0.34), smoothstep(0.35, 0.7, n1));
      vec3 scrub = mix(vec3(0.36, 0.37, 0.24), vec3(0.27, 0.31, 0.19), n2);
      vec3 land = mix(flats, scrub, smoothstep(0.45, 0.75, fbm(p * 2.3 + 7.0)));
      land *= 0.85 + 0.3 * n3;
      if (p.x < -14.0 && mode < 0.5) { vec2 f = floor(p / vec2(0.8, 0.45)); land = mix(land, vec3(0.30 + 0.25 * hsh(f), 0.33 + 0.12 * hsh(f + 3.0), 0.20), 0.7 * smoothstep(-14.0, -18.0, p.x)); }
      float cx = coastX(p.y), dc = cx - p.x;
      if (mode < 0.5) {
        land = mix(land, vec3(0.80, 0.74, 0.60) * (0.92 + 0.12 * n3), smoothstep(0.16, 0.06, dc) * step(0.0, dc)); // beach and dunes
        float yh = -0.62 - 0.05 * p.x;                                                                       // Highway 4
        land = mix(land, vec3(0.27, 0.27, 0.27), (1.0 - smoothstep(0.003, 0.005, abs(p.y - yh))) * step(p.x, cx - 0.12));
        float pa = length(p), pb = length(p - padB);                                                         // pads: concrete aprons
        float ap = max(1.0 - smoothstep(0.13, 0.15, pa), 1.0 - smoothstep(0.11, 0.13, pb));
        vec3 conc = vec3(0.66, 0.65, 0.62) * (0.9 + 0.1 * n3) * (1.0 - 0.55 * exp(-pa * pa / 0.0016) - 0.55 * exp(-pb * pb / 0.0012));
        land = mix(land, conc, ap);
        float tf = 1.0 - smoothstep(0.06, 0.07, max(abs(p.x + 0.115), abs(p.y + 0.085)));                    // tank farm pad
        land = mix(land, vec3(0.6, 0.6, 0.58), tf);
      }
      float diff = max(dot(N, L), 0.0) * sunVis;
      vec3 amb = hor * (0.2 + 0.25 * day) + vec3(0.012, 0.014, 0.02);
      vec3 col = land * (diff * vec3(1.0, 0.97, 0.9) + amb);
      if (w > 0.0) {
        // Sea: waves as a bumped normal, sky reflection with Fresnel, sun glint, surf on the beach
        vec2 q = p * 1000.0;
        float t = time;
        float bx = vn(q * 0.08 + vec2(t * 0.6, 0.0)) - vn(q * 0.08 + vec2(t * 0.6 + 1.7, 0.0)) + 0.5 * (vn(q * 0.31 - vec2(0.0, t)) - 0.5);
        float by = vn(q * 0.08 + vec2(0.0, t * 0.5) + 3.1) - vn(q * 0.08 + vec2(1.3, t * 0.5) + 3.1) + 0.5 * (vn(q * 0.29 + vec2(t, 0.0)) - 0.5);
        float fadeB = 1.0 - smoothstep(2.0, 40.0, length(vP));
        vec3 Nw = normalize(N + (eastW * bx + northW * by) * 0.07 * fadeB);
        float shallow = mode < 0.5 ? exp(-max(p.x - cx, 0.0) * 1.2) : 0.0;
        vec3 deep = mode > 0.5 ? vec3(0.03, 0.11, 0.19) : mix(vec3(0.02, 0.07, 0.11), vec3(0.10, 0.19, 0.18), shallow);
        float fr = 0.02 + 0.98 * pow(1.0 - max(dot(Nw, V), 0.0), 5.0);
        vec3 sky = hor * day * (mode > 0.5 ? 1.0 : 0.75) + vec3(0.01, 0.015, 0.03);
        vec3 sea = deep * (diff * 0.8 + amb) + sky * fr;
        vec3 H = normalize(L + V);
        sea += vec3(1.0, 0.92, 0.8) * pow(max(dot(Nw, H), 0.0), 380.0) * 2.5 * sunVis * step(0.0, dot(N, L));
        if (mode < 0.5) {
          float surf = smoothstep(0.045, 0.0, p.x - cx) * (0.5 + 0.5 * sin((p.x - cx) * 900.0 - t * 1.4 + vn(p * 40.0) * 6.0));
          sea = mix(sea, vec3(0.9, 0.9, 0.86) * (diff + amb), clamp(surf, 0.0, 1.0) * 0.8);
        }
        col = mix(col, sea, w);
      }
      // Flame light on the ground around the pad at night
      float fd = length(vP - flameL.xyz);
      col += vec3(1.0, 0.62, 0.3) * flameL.w / (1.0 + fd * fd * 60.0);
      // Haze
      float d = length(vP), vis = 28.0 + camH * 8.0;
      col = mix(col, hor * day * mix(0.95, 0.45, smoothstep(2.0, 30.0, camH)) + vec3(0.01, 0.012, 0.02), 1.0 - exp(-d / vis));
      float a = fade * (1.0 - smoothstep(620.0, 810.0, r));
      gl_FragColor = vec4(col, a);
    }`;
  function makeGround(mode) {
    const u = { sunDir: { value: new THREE.Vector3() }, sunVis: { value: 1 }, mode: { value: mode }, fade: { value: 1 }, hor: { value: new THREE.Vector3() }, day: { value: 1 },
      padB: { value: new THREE.Vector2() }, camH: { value: 0 }, eastW: { value: new THREE.Vector3() }, northW: { value: new THREE.Vector3() }, flameL: { value: new THREE.Vector4() }, time: { value: 0 } };
    const m = new THREE.Mesh(groundGeo, new THREE.ShaderMaterial({ uniforms: u, vertexShader: GROUND_VS, fragmentShader: GROUND_FS, transparent: true, depthWrite: true, extensions: { fragDepth: true } }));
    m.scale.setScalar(MM); m.frustumCulled = false; m.renderOrder = -4; m.visible = false;
    scene.add(m);
    return m;
  }

  // ─── Plumes ───────────────────────────────────────────────────────────────
  // One open tube per engine (or per cluster), reshaped in the vertex shader: exit radius r0
  // growing to r1 over length L. Sea level: a tight bright core with shock diamonds and an
  // orange afterburning sheath. High up: the exhaust balloons into a wide, faint bell.
  const plumeGeo = (() => { const g = new THREE.CylinderGeometry(1, 1, 1, 24, 40, true); g.translate(0, -0.5, 0); return g; })();
  const PLUME_VS = LOG_V + `
    uniform float r0; uniform float r1; uniform float L; uniform float pw;
    varying float vT; varying float vFace;
    void main() {
      float t = -position.y; vT = t;
      float r = r0 + (r1 - r0) * pow(t, pw);
      vec3 p = vec3(position.x * r, -t * L, position.z * r);
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      vec3 n = normalize(normalMatrix * vec3(position.x, 0.0, position.z));
      vFace = abs(dot(n, normalize(-mv.xyz)));
      gl_Position = projectionMatrix * mv;
      #include <logdepthbuf_vertex>
    }`;
  const PLUME_FS = LOG_F + `
    uniform float thr; uniform float expand; uniform float time; uniform float diamonds; uniform vec3 core; uniform vec3 sheath; uniform float gain;
    varying float vT; varying float vFace;
    void main() {
      #include <logdepthbuf_fragment>
      float t = vT;
      float body = pow(vFace, 1.6) * (1.0 - smoothstep(0.35, 1.0, t)) * smoothstep(0.0, 0.03, t);
      float hot = exp(-t * mix(5.0, 2.2, expand));
      float dia = diamonds * (1.0 - expand) * pow(0.5 + 0.5 * cos(t * 44.0), 6.0) * exp(-t * 6.0);
      float flick = 0.88 + 0.12 * sin(time * 53.0 + t * 30.0) * sin(time * 31.0);
      vec3 col = mix(sheath, core, hot) * (hot * 1.6 + 0.35) + core * dia * 1.6;
      gl_FragColor = vec4(col * body * thr * flick * gain, 1.0);
    }`;
  function plumeMat(core, sheath) {
    return new THREE.ShaderMaterial({
      uniforms: { r0: { value: 1 }, r1: { value: 2 }, L: { value: 10 }, pw: { value: 0.7 }, thr: { value: 0 }, expand: { value: 0 }, time: { value: 0 }, diamonds: { value: 1 },
        core: { value: new THREE.Color(core) }, sheath: { value: new THREE.Color(sheath) }, gain: { value: 1 } },
      vertexShader: PLUME_VS, fragmentShader: PLUME_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, extensions: { fragDepth: true },
    });
  }
  function buildPlumes(layout, vac) {
    const g = new THREE.Group(), cores = [], coreM = plumeMat('#fff4dc', '#ff8a3c'), vacM = plumeMat('#ffe6c8', '#ff9a5a'), shellM = plumeMat('#ffd29a', '#ff6a2a');
    layout.forEach(([x, z, isVac], i) => {
      const m = new THREE.Mesh(plumeGeo, isVac ? vacM : coreM);
      m.position.set(x, isVac ? -1.9 : (vac ? -0.9 : (i < 13 ? -1.05 : -0.75)), z);
      m.frustumCulled = false;
      g.add(m); cores.push(m);
    });
    const shell = new THREE.Mesh(plumeGeo, shellM); shell.position.y = -1; shell.frustumCulled = false; g.add(shell);
    g.scale.setScalar(MM);
    return { g, cores, coreM, vacM, shellM, shell };
  }
  function setPlume(P, lit, thr, expand, time, kind) {
    const e = expand, sea = 1 - e;
    for (const m of [P.coreM, P.vacM, P.shellM]) { m.uniforms.time.value = time; m.uniforms.expand.value = e; }
    const cm = P.coreM.uniforms;
    cm.r0.value = 0.62; cm.r1.value = 1.1 + 1.6 * sea + 9 * e; cm.L.value = (kind === 'ship' ? 20 : 30) + 40 * e; cm.pw.value = 0.8; cm.thr.value = thr; cm.gain.value = 0.7 + 1.8 * sea; cm.diamonds.value = 1;
    const vm = P.vacM.uniforms;
    vm.r0.value = 1.1; vm.r1.value = 1.8 + 30 * e; vm.L.value = 14 + 90 * e; vm.pw.value = 0.6; vm.thr.value = thr; vm.gain.value = 0.6 + 1.0 * sea; vm.diamonds.value = 0.3;
    const sm = P.shellM.uniforms, nLit = lit.reduce((a, b) => a + (b ? 1 : 0), 0);
    const big = kind === 'ship' ? 3.4 : 4.3;
    sm.r0.value = nLit > 6 ? big : 2.2; sm.r1.value = (nLit > 6 ? 9 : 4) + (kind === 'ship' ? 60 : 110) * e; sm.L.value = (nLit > 6 ? 95 : 35) + (kind === 'ship' ? 240 : 420) * e;
    sm.pw.value = 0.55; sm.thr.value = thr * Math.min(1, nLit / 6); sm.gain.value = 0.1 + 1.1 * sea * (nLit > 6 ? 1 : 0.5) + 0.06 * e; sm.diamonds.value = 0;
    P.cores.forEach((m, i) => { m.visible = !!lit[i] && thr > 0; });
    P.shell.visible = nLit > 0 && thr > 0;
  }

  // ─── Smoke, steam, vapour: instanced soft billboards, refilled each frame ───
  const MAXP = 3000;
  const puffGeo = new THREE.InstancedBufferGeometry();
  {
    const q = new THREE.PlaneGeometry(1, 1);
    puffGeo.index = q.index; puffGeo.setAttribute('position', q.attributes.position);
    puffGeo.setAttribute('iOff', new THREE.InstancedBufferAttribute(new Float32Array(MAXP * 3), 3).setUsage(THREE.DynamicDrawUsage));
    puffGeo.setAttribute('iDat', new THREE.InstancedBufferAttribute(new Float32Array(MAXP * 4), 4).setUsage(THREE.DynamicDrawUsage));
    puffGeo.instanceCount = 0;
  }
  const puffU = { sunV: { value: new THREE.Vector3() }, lit: { value: new THREE.Color() }, shade: { value: new THREE.Color() }, flame: { value: new THREE.Color(1.0, 0.55, 0.22) } };
  const puffs = new THREE.Mesh(puffGeo, new THREE.ShaderMaterial({
    uniforms: puffU,
    vertexShader: LOG_V + `
      attribute vec3 iOff; attribute vec4 iDat; varying vec2 vUv; varying vec4 vDat;
      void main() {
        vUv = position.xy; vDat = iDat;
        vec4 mv = modelViewMatrix * vec4(iOff, 1.0);
        float a = iDat.w * 6.2831;
        mv.xy += mat2(cos(a), -sin(a), sin(a), cos(a)) * position.xy * iDat.x;
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: LOG_F + `
      uniform vec3 sunV; uniform vec3 lit; uniform vec3 shade; uniform vec3 flame; varying vec2 vUv; varying vec4 vDat;
      float hsh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hsh(i), hsh(i + vec2(1, 0)), f.x), mix(hsh(i + vec2(0, 1)), hsh(i + vec2(1, 1)), f.x), f.y); }
      void main() {
        #include <logdepthbuf_fragment>
        vec2 p = vUv * 2.0; float r = length(p);
        if (r > 1.0) discard;
        float n = vn(p * 2.6 + vDat.w * 17.0) * 0.6 + vn(p * 5.3 + vDat.w * 31.0) * 0.4;
        float dens = smoothstep(1.0, 0.2, r + (n - 0.5) * 0.6);
        vec3 N = vec3(p, sqrt(max(0.0, 1.0 - r * r)));
        float l = clamp(dot(N, sunV) * 0.55 + 0.45, 0.0, 1.0);
        vec3 col = mix(shade, lit, l) * (0.85 + 0.3 * n) + flame * vDat.z * (1.2 - r);
        gl_FragColor = vec4(col, dens * vDat.y);
      }`,
    transparent: true, depthWrite: false, extensions: { fragDepth: true },
  }));
  puffs.frustumCulled = false; puffs.renderOrder = 2;
  scene.add(puffs);

  // Re-entry plasma: a glowing sheath around the windward side and a wake behind
  const plasmaMat = new THREE.ShaderMaterial({
    uniforms: { heat: { value: 0 }, time: { value: 0 } },
    vertexShader: LOG_V + `varying vec3 vN; varying vec3 vV; varying vec3 vL;
      void main() { vL = position; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: LOG_F + `uniform float heat; uniform float time; varying vec3 vN; varying vec3 vV; varying vec3 vL;
      void main() {
        #include <logdepthbuf_fragment>
        float face = abs(dot(normalize(vN), normalize(vV)));
        float front = smoothstep(0.05, 0.9, vL.z);           // only the windward (belly) side glows
        float fl = 0.85 + 0.15 * sin(time * 40.0 + vL.y * 9.0);
        vec3 c = mix(vec3(1.0, 0.38, 0.6), vec3(1.0, 0.6, 0.28), front);
        gl_FragColor = vec4(c * front * (0.45 + 0.9 * pow(1.0 - face, 2.0)) * heat * fl, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, extensions: { fragDepth: true },
  });
  // The ionised wake: brightest right behind the ship, fading along its length and towards its edges
  const wakeMat = new THREE.ShaderMaterial({
    uniforms: plasmaMat.uniforms,
    vertexShader: LOG_V + `varying vec2 vUv; varying float vFace;
      void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vFace = abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz)));
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: LOG_F + `uniform float heat; uniform float time; varying vec2 vUv; varying float vFace;
      void main() {
        #include <logdepthbuf_fragment>
        float along = pow(vUv.y, 2.2);                        // apex (at the ship) = 1
        float fl = 0.8 + 0.2 * sin(time * 25.0 + vUv.y * 30.0);
        gl_FragColor = vec4(mix(vec3(1.0, 0.45, 0.25), vec3(0.9, 0.3, 0.7), 1.0 - vUv.y) * along * pow(vFace, 1.2) * 0.55 * heat * fl, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, extensions: { fragDepth: true },
  });
  function buildPlasma() {
    const g = new THREE.Group();
    const sheath = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 24), plasmaMat);
    sheath.scale.set(9.5, 33, 8); sheath.position.set(0, 26, 2.5); g.add(sheath);
    const wake = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 32, 8, true), wakeMat);
    g.add(wake);
    g.scale.setScalar(MM);
    g.userData.wake = wake;
    return g;
  }

  // ─── Scene objects ────────────────────────────────────────────────────────
  let F = null, L = null, pads = [], booster = null, ship = null, ring = null, sats = [], bPl = null, sPl = null, plasma = null;
  const ground = makeGround(0), sea = makeGround(1);
  const lightB = new THREE.PointLight(0xffa860, 0, 3.0, 2), lightS = new THREE.PointLight(0xffa860, 0, 3.0, 2);
  scene.add(lightB, lightS);
  const trackMat = (c, o2) => new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: o2, depthWrite: false });
  const lines = {};
  const labels = {};
  for (const [id, cls] of [['ship', 'craft'], ['booster', 'craft']]) {
    const el = document.createElement('button');
    el.className = 'lbl ' + cls; el.type = 'button'; el.dataset.id = id;
    el.innerHTML = '<i style="background:#ffb23e"></i><span></span>';
    el.style.display = 'none';
    labelLayer.appendChild(el);
    labels[id] = { el, span: el.querySelector('span'), shown: false };
  }
  function relabel() {
    if (!L) return;
    const [b, s] = L.mission.serials;
    labels.ship.span.textContent = tr(`星舰 ${s}`, `Ship ${s}`);
    labels.booster.span.textContent = tr(`超重型助推器 ${b}`, `Super Heavy ${b}`);
  }

  function clear() {
    for (const o2 of [...pads.map(p => p.g), booster, ship, ring, bPl && bPl.g, sPl && sPl.g, plasma, ...sats.map(s => s.mesh), ...Object.values(lines).flatMap(l => [l.past, l.future])]) if (o2) scene.remove(o2);
    pads = []; booster = ship = ring = bPl = sPl = plasma = null; sats = [];
    for (const k in lines) delete lines[k];
  }
  // Points along a track, sampled for the path lines (Earth-fixed km)
  function samplePath(stateAt, t0, t1, n) {
    const ts = [], pts = [];
    for (let i = 0; i <= n; i++) { const t = t0 + (t1 - t0) * i / n; ts.push(t); pts.push(stateAt(t).r); }
    return { ts, pts };
  }
  function makeLine(path, color) {
    const n = path.pts.length + 1;
    const mk = (c, op) => {
      const geo = new THREE.BufferGeometry(), arr = new Float32Array(n * 3);
      geo.setAttribute('position', new THREE.BufferAttribute(arr, 3).setUsage(THREE.DynamicDrawUsage));
      const line = new THREE.Line(geo, trackMat(c, op)); line.frustumCulled = false; scene.add(line);
      return line;
    };
    return { path, past: mk(color, 0.9), future: mk(0x72a7ff, 0.45) };
  }
  function setFlight(launched) {
    clear();
    L = launched; F = launched ? launched.F : null;
    if (!F) return;
    const veh = F.veh;
    // Both Starbase pads: the active one gets the vehicles
    for (const id of ['olp1', 'olp2']) {
      const pd = STARSHIP_PADS[id], P = Starship.ecefOf(pd.lat, pd.lon, 0);
      const pad = buildPad(); pad.P = mul(P, 1e-3); pad.id = id; pads.push(pad); scene.add(pad.g);
    }
    booster = buildBooster(veh); ship = buildShip(veh, L.mission.payload);
    scene.add(booster, ship);
    if (F.ring) { ring = booster.userData.hsr.clone(); ring.scale.setScalar(MM); scene.add(ring); }
    bPl = buildPlumes(ENGINE_LAYOUT.map(([x, z]) => [x, z, 0]), false); sPl = buildPlumes(SHIP_ENGINES.map(([x, z, v]) => [x, z, v]), true);
    booster.add(bPl.g); bPl.g.scale.setScalar(1); ship.add(sPl.g); sPl.g.scale.setScalar(1);
    plasma = buildPlasma(); ship.add(plasma); plasma.scale.setScalar(1);
    const satGeo = satGeometry(L.mission.payload.type);
    for (const s of F.sats) {
      const mesh = new THREE.Mesh(satGeo, satMats); mesh.scale.setScalar(MM); mesh.visible = false; scene.add(mesh);
      const [n, b] = F.shipFrame(s.t0);
      sats.push({ s, mesh, n, b });
    }
    lines.ship = makeLine(samplePath(t => F.shipState(t), 0, F.t.landShip, 700), 0xffb23e);
    lines.booster = makeLine(samplePath(t => F.boosterState(t), 0, L.mission.timeline.land, 260), 0xffd28a);
    relabel();
  }

  // ─── Per-frame ────────────────────────────────────────────────────────────
  const fill = { off: puffGeo.attributes.iOff.array, dat: puffGeo.attributes.iDat.array, list: [] };
  function puff(p, size, alpha, heat, seed) { if (alpha > 0.004 && size > 0) fill.list.push([p[0], p[1], p[2], size, alpha, heat, seed]); }
  let groundCovers = false, active = false;
  function update(ctx) {
    const { jd, pos, C, toggles } = ctx;
    active = !!F;
    ground.visible = sea.visible = puffs.visible = false;
    groundCovers = false;
    lightB.intensity = lightS.intensity = 0;
    for (const id in labels) if (labels[id].shown) { labels[id].el.style.display = 'none'; labels[id].shown = false; }
    if (!F) return;
    const TL = L.mission.timeline, t = (jd - L.tLaunch) * DAY, time = performance.now() / 1000;
    const R = bodyRot('earth', jd), eRel = sub(pos.earth, C);
    const rel = r => add(eRel, M3.apply(R, r));     // Earth-fixed km → camera-relative km
    const dirW = d => M3.apply(R, d);
    const sunW = norm(sub(pos.sun, C));
    const camE = M3.apply(M3.T(R), sub(C, pos.earth)), camAlt = len(camE) - BODY.earth.radius;

    // Pads, ground
    const P1 = pads[0].P, U = norm(P1), E = norm(cross([0, 0, 1], U)), Nn = cross(U, E);
    const Uw = dirW(U), Ew = dirW(E), Nw = dirW(Nn);
    const dPad = len(sub(camE, P1));
    const near = dPad < 900;
    for (const pd of pads) {
      pd.g.visible = near;
      if (!near) continue;
      const u = norm(pd.P), e = norm(cross([0, 0, 1], u)), n = cross(u, e);
      const r = rel(pd.P); pd.g.position.set(r[0], r[1], r[2]);
      setBasis(pd.g, dirW(e), dirW(n), dirW(u));
    }
    const day = ss(-0.12, 0.12, dot(sunW, Uw));
    const horC = [0.62 * day + 0.02, 0.74 * day + 0.025, 0.9 * day + 0.04];
    const fadeG = 1 - ss(16, 70, camAlt);
    const placeGround = (gm, at, mode) => {
      const u = norm(at), e = norm(cross([0, 0, 1], u)), n = cross(u, e), anchor = mul(u, BODY.earth.radius), r = rel(anchor);
      const d = len(sub(camE, anchor));
      gm.visible = fadeG > 0.01 && d < 900;
      if (!gm.visible) return false;
      gm.position.set(r[0], r[1], r[2]); setBasis(gm, dirW(e), dirW(n), dirW(u));
      const g = gm.material.uniforms;
      g.sunDir.value.set(...sunW); g.sunVis.value = ctx.localSunVis; g.fade.value = fadeG; g.hor.value.set(...horC); g.day.value = day; g.camH.value = Math.max(0, camAlt);
      g.eastW.value.set(...dirW(e)); g.northW.value.set(...dirW(n)); g.time.value = time;
      return d < 250 && camAlt < 30;
    };
    {
      const p2 = pads[1].P, d2 = sub(p2, P1);
      ground.material.uniforms.padB.value.set(dot(d2, E), dot(d2, Nn));
      if (placeGround(ground, P1, 0)) groundCovers = true;
      if (t > F.t.flip - 120 && placeGround(sea, F.shipLandR, 1)) groundCovers = true;
    }

    // Vehicles
    const veh = F.veh, bst = F.boosterState(t), sst = F.shipState(t);
    const settle = L.recovery === 'catch' ? (t > TL.land ? -1.2 * ss(TL.land, TL.land + 1.2, t) - 0.25 * Math.sin((t - TL.land) * 5) * Math.exp(-(t - TL.land) * 1.5) * (t > TL.land ? 1 : 0) : 0) : 0;
    const place = (obj, st, frame, extra = 0) => {
      const [n, b] = frame, Xe = cross(n, b), r = rel(add(st.r, mul(U, extra / 1000)));
      obj.position.set(r[0], r[1], r[2]);
      setBasis(obj, dirW(Xe), dirW(n), dirW(b));
      return r;
    };
    const bFrame = F.boosterFrame(t), sFrame = F.shipFrame(t);
    const sinking = (tl0, tt) => (tt > tl0 + 15 ? -6 * ss(tl0 + 15, tl0 + 60, tt) : 0);
    const bRel = place(booster, bst, bFrame, settle + (L.recovery !== 'catch' ? sinking(TL.land, t) : 0));
    const sRel = place(ship, sst, sFrame, sinking(F.t.landShip, t));
    animateShip(ship, t, TL, F.t, sats);
    booster.userData.hsr.visible = !(F.ring && t > TL.hsj);
    ship.visible = true;
    if (ring) {
      ring.visible = t > TL.hsj && t < F.ring.t1 + 30;
      if (ring.visible) {
        const st = F.ring.at(t), r = rel(st.r);
        ring.position.set(r[0], r[1], r[2]);
        const a = (t - TL.hsj) * 0.6;
        setBasis(ring, dirW(norm(add(mul(E, Math.cos(a)), mul(U, Math.sin(a))))), dirW(norm(add(mul(U, Math.cos(a)), mul(E, -Math.sin(a))))), dirW(Nn));
        ring.position.addScaledVector(new THREE.Vector3(...dirW(norm(add(mul(U, Math.cos(a)), mul(E, -Math.sin(a)))))), -(veh.booster.h - 1) * MM);
      }
    }
    // Engines and plumes
    const atB = Starship.atmo((len(bst.r) - BODY.earth.radius) * 1000), atS = Starship.atmo((len(sst.r) - BODY.earth.radius) * 1000);
    const expB = 1 - Math.pow(atB.p / 101325, 0.25), expS = 1 - Math.pow(atS.p / 101325, 0.25);
    const be = F.boosterEngines(t), se = F.shipEngines(t);
    setPlume(bPl, ENGINE_LAYOUT.map((_, i) => i < be.n), be.n ? 0.75 + 0.25 * be.thr : 0, expB, time, 'booster');
    setPlume(sPl, SHIP_ENGINES.map(([, , v], i) => (v ? i - 3 < se.rvac : i < se.rsl)), (se.rsl || se.rvac) ? 0.75 + 0.25 * se.thr : 0, expS, time, 'ship');
    nozMat.emissive.setRGB(0, 0, 0);
    if (be.n && (len(bst.r) - BODY.earth.radius) < 3) { lightB.intensity = 3 * be.n / 33 + 0.6; const r = bRel; lightB.position.set(r[0] - Uw[0] * 0.03, r[1] - Uw[1] * 0.03, r[2] - Uw[2] * 0.03); }
    if ((se.rsl || se.rvac) && (len(sst.r) - BODY.earth.radius) < 3) { lightS.intensity = 1.5; lightS.position.set(sRel[0], sRel[1], sRel[2]); }
    if (ground.visible) {
      const l = lightB.intensity > 0 ? bRel : lightS.intensity > 0 ? sRel : null, w = lightB.intensity + lightS.intensity;
      ground.material.uniforms.flameL.value.set(l ? l[0] : 0, l ? l[1] : 0, l ? l[2] : 0, l ? w * 0.02 * (1 - day * 0.8) : 0);
    }
    // Re-entry heating: tiles glow, plasma sheath
    {
      const h = (len(sst.r) - BODY.earth.radius) * 1000, v = len(sst.v) * 1000, rho = Starship.atmo(h).rho;
      const heat = t > F.t.seco + 60 && t < F.t.flip ? clamp(Math.sqrt(rho) * v * v * v / 2.6e9, 0, 1.4) : 0;
      plasma.visible = heat > 0.02;
      plasmaMat.uniforms.heat.value = Math.min(1, heat); plasmaMat.uniforms.time.value = time;
      if (plasma.visible) {
        // Wake streams back along the airflow; sheath sits on the belly
        const n = sFrame[0], b = sFrame[1], x = cross(n, b), vd = norm(sst.v);
        const loc = [dot(vd, x), dot(vd, n), dot(vd, b)], wake = plasma.userData.wake, Lw = 80 + 260 * Math.min(1, heat);
        wake.scale.set(14, Lw, 14);
        wake.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(loc[0], loc[1], loc[2]).normalize());
        wake.position.set(-loc[0] * Lw / 2, 24 - loc[1] * Lw / 2, -loc[2] * Lw / 2);
      }
      const glow = Math.min(1, heat) * 0.9;
      for (const m of ship.userData.mats) m.emissive.setRGB(glow, glow * 0.38, glow * 0.12);
    }
    // Pad: chopsticks and the ship quick-disconnect arm
    const pad = pads.find(p => p.id === L.mission.pad) || pads[0];
    if (pad.g.visible) {
      const catchZ = F.CATCH_H + veh.booster.h - 2.2 - 7.4 - 1.9;
      const park = 58, z = L.recovery === 'catch' ? park + (catchZ - park) * ss(60, 200, t) + (t > TL.land ? settle : 0) : park;
      pad.carriage.position.z = z;
      const close = L.recovery === 'catch' ? ss(TL.land - 3.5, TL.land - 0.4, t) : 0;
      for (const a of pad.arms) a.rotation.z = a.userData.side * ((1 - close) * 0.62 - close * 0.03 + (t < 0 ? 0.0 : 0));
      pad.qd.position.z = F.OLM_H + veh.booster.h + 9;
      pad.qd.rotation.z = -1.45 * ss(-40, -30, t);
      for (const other of pads) if (other !== pad) { other.carriage.position.z = 58; other.qd.position.z = 100; other.qd.rotation.z = -1.45; for (const a of other.arms) a.rotation.z = a.userData.side * 0.62; }
    }
    // Deployed satellites
    for (const s of sats) {
      const on = t >= s.s.t0 && t < s.s.tEnd;
      s.mesh.visible = on;
      if (!on) continue;
      const st = s.s.track.at(t), r = rel(st.r);
      s.mesh.position.set(r[0], r[1], r[2]);
      // Leaves the slot flat, as it sat in the stack, then tumbles slowly about the slot's long axis
      const X = cross(s.n, s.b), a = (t - s.s.t0) * 0.012, Y = norm(add(mul(s.n, Math.cos(a)), mul(s.b, Math.sin(a))));
      setBasis(s.mesh, dirW(X), dirW(Y), dirW(cross(X, Y)));
    }

    // Path lines (past bright, future faint), drawn while the camera is not right on top of them
    for (const k in lines) {
      const ln = lines[k], { ts, pts } = ln.path, show = toggles.orbits && !ctx.surface && !ctx.cockpit && camAlt > 3;
      ln.past.visible = ln.future.visible = show;
      if (!show) continue;
      let i = 0;
      while (i < ts.length && ts[i] <= t) i++;
      const cur = k === 'ship' ? sst.r : bst.r;
      const write = (line, a, b, first, last) => {
        const arr = line.geometry.attributes.position.array; let n = 0;
        const put = p => { const r = rel(p); arr[n * 3] = r[0]; arr[n * 3 + 1] = r[1]; arr[n * 3 + 2] = r[2]; n++; };
        if (first) put(first);
        for (let j = a; j < b; j++) put(pts[j]);
        if (last) put(last);
        line.geometry.attributes.position.needsUpdate = true; line.geometry.setDrawRange(0, n);
      };
      write(ln.past, 0, i, null, t > 0 ? cur : null);
      write(ln.future, i, pts.length, t > 0 ? cur : pts[0], null);
    }

    // Smoke, steam and vapour
    fill.list.length = 0;
    const padE = (x, y, z) => rel(add(pad.P, add(add(mul(E, x / 1000), mul(Nn, y / 1000)), mul(U, z / 1000))));
    const wind = [3.2, 1.6];
    if (dPad < 400) {
      // Liftoff: the deluge flashes to steam and the exhaust shoves it out across the pad
      const altB = (len(bst.r) - BODY.earth.radius) * 1000;
      for (let i = 0; i < 900; i++) {
        const b = -2.6 + 17 * Math.pow(rnd(i), 1.7);
        if (t < b) continue;
        const age = t - b, life = 150 + 200 * rnd(i + 0.3);
        if (age > life) continue;
        const ph = rnd(i + 0.1) * 2 * Math.PI, v0 = 12 + 60 * Math.pow(rnd(i + 0.2), 1.5), tau = 4 + 4 * rnd(i + 0.4);
        const rad = 12 + v0 * tau * (1 - Math.exp(-age / tau));
        const zz = 6 + (2.5 + 4 * rnd(i + 0.5)) * Math.pow(age, 0.8) + (rnd(i + 0.6) < 0.3 ? 14 * age * Math.exp(-age / 25) : 0);
        const size = 16 + 15 * Math.sqrt(age) * (0.7 + 0.6 * rnd(i + 0.7));
        const alpha = 0.92 * ss(0, 0.5, age) * (1 - ss(life * 0.5, life, age));
        const heat = be.n && age < 3 ? (1 - age / 3) * Math.exp(-Math.max(0, altB - 25) / 120) * 1.2 : 0;
        puff(padE(Math.cos(ph) * rad + wind[0] * age, Math.sin(ph) * rad + wind[1] * age, zz), size * MM, alpha, heat, rnd(i + 0.8));
      }
      // Pre-launch: cryogenic venting from the booster and the ship
      if (t < 2) {
        for (let i = 0; i < 90; i++) {
          const P = 5 + 3 * rnd(i + 9), age = ((t - rnd(i + 8) * P) % P + P) % P, b0 = t - age;
          if (b0 < -600) continue;
          const shipV = i % 3 === 0, zv = F.OLM_H + (shipV ? veh.booster.h + 18 + 14 * rnd(i + 7) : 8 + (veh.booster.h - 14) * rnd(i + 7));
          const ph = rnd(i + 6) * 2 * Math.PI, out = 4.6 + 1.5 * age;
          puff(padE(Math.cos(ph) * out + wind[0] * age, Math.sin(ph) * out + wind[1] * age, zv - 1.6 * age), (1.2 + 2.2 * age) * MM, 0.55 * (1 - age / P) * ss(0, 0.4, age), 0, rnd(i + 5));
        }
      }
      // Booster landing on the tower: steam and dust kicked up off the pad
      if (L.recovery === 'catch' && t > TL.land - 9) {
        for (let i = 0; i < 240; i++) {
          const b = TL.land - 7 + 7 * rnd(i + 40);
          if (t < b) continue;
          const age = t - b, life = 80 + 60 * rnd(i + 41);
          if (age > life) continue;
          const ph = rnd(i + 42) * 2 * Math.PI, rad = 10 + 40 * (1 - Math.exp(-age / 3)) * (0.6 + rnd(i + 43));
          puff(padE(Math.cos(ph) * rad + wind[0] * age, Math.sin(ph) * rad + wind[1] * age, 4 + 2.5 * Math.pow(age, 0.8)), (6 + 6 * Math.sqrt(age)) * MM,
            0.6 * ss(0, 0.5, age) * (1 - ss(life * 0.4, life, age)), age < 1.5 ? 0.6 * (1 - age / 1.5) : 0, rnd(i + 44));
        }
      }
    }
    // Exhaust trail through the lower atmosphere, drifting with the wind
    if (t > 4) {
      for (let k = 0; k < 700; k++) {
        const tk = 4 + k * 0.2;
        if (tk > t || tk > TL.meco) break;
        const age = t - tk, st = F.stack.at(tk), hk = len(st.r) - BODY.earth.radius;
        if (hk > 48) break;
        const a = 0.5 * (1 - ss(14, 46, hk)) * ss(0, 1.5, age) * (1 - ss(300, 700, age));
        if (a < 0.01) continue;
        const sz = (16 + 6 * Math.sqrt(age) * (1 + hk / 5) + hk * 3) * (0.8 + 0.4 * rnd(k));
        const p = add(st.r, add(mul(E, (wind[0] * age * (1 + hk / 10) + (rnd(k + 1) - 0.5) * sz * 0.4) / 1000), mul(Nn, (wind[1] * age * (1 + hk / 10)) / 1000)));
        puff(rel(p), sz * MM, a, 0, rnd(k + 2));
      }
    }
    // Hot staging: the ship's exhaust blasts out through the vented ring as a glowing collar
    // that keeps the stack's speed and spreads into the near-vacuum
    if (t > TL.stage - 1.2 && t < TL.stage + 12) {
      const st = F.stack.at(TL.stage - 1.2), vs = st.v, nose = norm(vs), side1 = norm(cross(nose, U)), side2 = cross(nose, side1);
      const top = add(st.r, mul(nose, (veh.booster.h - 1.5) / 1000));
      for (let i = 0; i < 70; i++) {
        const b = TL.stage - 1.2 + 2.0 * rnd(i + 70);
        if (t < b) continue;
        const age = t - b, ph = rnd(i + 71) * 2 * Math.PI, sp = 120 + 160 * rnd(i + 72);
        const out = add(mul(side1, Math.cos(ph)), mul(side2, Math.sin(ph)));
        const p = add(add(top, mul(vs, t - (TL.stage - 1.2))), add(mul(out, (6 + sp * age) / 1000), mul(nose, -40 * age / 1000)));
        puff(rel(p), (8 + 70 * age) * MM, 0.42 * Math.exp(-age / 0.9) * ss(0, 0.12, age), Math.exp(-age / 0.7) * 2.2, rnd(i + 73));
      }
    }
    // Splashdowns: spray and steam
    const splash = (at, t0, n, seed) => {
      if (t < t0 - 1 || t > t0 + 120) return;
      const u = norm(at), e = norm(cross([0, 0, 1], u)), nn = cross(u, e);
      for (let i = 0; i < n; i++) {
        const b = t0 - 1 + 3 * rnd(i + seed);
        if (t < b) continue;
        const age = t - b, ph = rnd(i + seed + 1) * 2 * Math.PI, rad = 6 + 30 * (1 - Math.exp(-age / 2)) * rnd(i + seed + 2);
        const p = add(at, add(add(mul(e, (Math.cos(ph) * rad + wind[0] * age) / 1000), mul(nn, (Math.sin(ph) * rad + wind[1] * age) / 1000)), mul(u, (2 + 3 * Math.pow(age, 0.7)) / 1000)));
        puff(rel(p), (5 + 5 * Math.sqrt(age)) * MM, 0.7 * ss(0, 0.3, age) * (1 - ss(20, 110, age)), 0, rnd(i + seed + 3));
      }
    };
    if (L.recovery !== 'catch') splash(F.boosterTarget.map(x => x / 1000), TL.land, 120, 300);
    splash(F.shipLandR.map(x => x / 1000), F.t.landShip, 140, 600);
    // Sort far to near and upload
    {
      const list = fill.list;
      if (list.length) {
        list.sort((a, b) => (b[0] * b[0] + b[1] * b[1] + b[2] * b[2]) - (a[0] * a[0] + a[1] * a[1] + a[2] * a[2]));
        const n = Math.min(MAXP, list.length);
        for (let i = 0; i < n; i++) { const q = list[list.length - n + i]; fill.off.set([q[0], q[1], q[2]], i * 3); fill.dat.set([q[3], q[4], q[5], q[6]], i * 4); }
        puffGeo.attributes.iOff.needsUpdate = true; puffGeo.attributes.iDat.needsUpdate = true;
        puffGeo.instanceCount = n;
        puffs.visible = true;
        const cam = o.camera;
        const sv = new THREE.Vector3(...sunW).transformDirection(cam.matrixWorldInverse);
        puffU.sunV.value.copy(sv);
        const sunI = ctx.localSunVis * ss(-0.08, 0.1, dot(sunW, Uw)) * 0.95;
        puffU.lit.value.setRGB(0.15 + sunI * 0.85, 0.15 + sunI * 0.8, 0.17 + sunI * 0.72);
        puffU.shade.value.setRGB(0.06 + 0.42 * day, 0.07 + 0.46 * day, 0.09 + 0.52 * day);
      }
    }
    // Steel reflects a bright sky low down, the dark of space up high
    const envI = 0.35 + 0.65 * (1 - ss(20, 90, camAlt));
    for (const m of [nozMat, dark, plainSteel, tileMat]) m.envMapIntensity = envI * 0.8;
    booster.traverse(m => { if (m.material && m.material.envMap && m.material.metalnessMap) m.material.envMapIntensity = envI; });
    ship.traverse(m => { if (m.material && m.material.envMap && m.material.metalnessMap) m.material.envMapIntensity = envI; });

    // Labels
    const lab = (id, r, hM) => {
      const Lb = labels[id], d = len(r);
      let show = toggles.labels && ctx.cockpit !== id;
      let sp = null;
      if (show) { sp = project(add(r, mul(Uw, hM / 1000))); show = !!sp && d > 0.35 && d < 1500; }
      if (show && ctx.surface && dot(norm(r), ctx.surface.up) < -0.01) show = false;
      if (show) Lb.el.style.transform = `translate(${sp[0].toFixed(1)}px, ${sp[1].toFixed(1)}px)`;
      if (show !== Lb.shown) { Lb.el.style.display = show ? '' : 'none'; Lb.shown = show; }
    };
    if (t >= TL.stage) { lab('ship', sRel, 60); lab('booster', bRel, 80); } else lab('ship', sRel, 60);
  }
  return {
    setFlight, update, relabel,
    get groundCovers() { return groundCovers; },
    get active() { return active; },
  };
}
