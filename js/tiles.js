'use strict';
// Streams real satellite imagery around the point under the camera when it is close to Earth.
// Tiles come from NASA GIBS (EPSG:4326 grid, CORS-enabled). Each zoom level keeps a 4×4-tile
// window in one 2048² texture addressed as a ring (tile x lives in slot x mod 4), so moving the
// window only uploads the new tiles. The shader blends each window over the built-in 2k maps and
// falls back to them wherever a tile is missing, so offline (or blocked) it simply looks as before.
const EarthTiles = (renderer) => {
  const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/';
  const URL = {
    bmng: (z, y, x) => `${GIBS}BlueMarble_NextGeneration/default/2004-08-01/500m/${z}/${y}/${x}.jpeg`,
    lights: (z, y, x) => `${GIBS}VIIRS_Black_Marble/default/2016-01-01/500m/${z}/${y}/${x}.png`,
    water: (z, y, x) => `${GIBS}OSM_Land_Water_Map/default/default/250m/${z}/${y}/${x}.png`,
  };
  const TILE = 512, N = 4, SIZE = TILE * N, PX = TILE * TILE;
  const KM_PER_DEG = 111.32;
  // Pixels: day = premultiplied RGBA; aux = R city lights, G water, A coverage
  const pack = {
    bmng: ([c], out) => { for (let i = 0; i < PX * 4; i += 4) { out[i] = c[i]; out[i + 1] = c[i + 1]; out[i + 2] = c[i + 2]; out[i + 3] = 255; } },
    aux: ([l, w], out) => {
      // Black Marble paints a bluish moonlit backdrop under the lights (ice ~(42,49,81), desert
      // ~(36,33,62)); lights are warm, so keep only what is redder than that backdrop
      for (let i = 0; i < PX * 4; i += 4) {
        const lum = 0.3 * l[i] + 0.59 * l[i + 1] + 0.11 * l[i + 2];
        out[i] = Math.max(0, Math.min(255, (lum - 0.6 * l[i + 2] - 4) * 2.5)); out[i + 1] = w[i] > 100 ? 255 : 0; out[i + 2] = 0; out[i + 3] = 255;
      }
    },
  };
  // Blue Marble tops out at z7 (~490 m/px). GIBS's finer global Landsat composites (WELD) are
  // striped and off-colour, so below that the shader's procedural detail takes over.
  const DEFS = [
    { kind: 'day', z: 5, src: ['bmng'], pack: pack.bmng },
    { kind: 'day', z: 7, src: ['bmng'], pack: pack.bmng },
    { kind: 'aux', z: 5, src: ['lights', 'water'], pack: pack.aux },
    { kind: 'aux', z: 7, src: ['lights', 'water'], pack: pack.aux },
  ];
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const zero = { isDataTexture: true, image: { width: TILE, height: TILE, data: new Uint8Array(PX * 4) } };
  const work = document.createElement('canvas');
  work.width = work.height = TILE;
  const wctx = work.getContext('2d', { willReadFrequently: true });

  const clips = DEFS.map(d => {
    const tex = new THREE.DataTexture(null, SIZE, SIZE, THREE.RGBAFormat);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = Math.min(8, maxAniso);
    const span = 288 / 2 ** d.z; // degrees per tile (GIBS grid: 2×1 tiles of 288° at z0)
    return {
      ...d, tex, span, nX: Math.round(360 / span), nY: Math.round(180 / span),
      texelKm: span * KM_PER_DEG / TILE,
      win: new THREE.Vector4(0, 0, Math.round(360 / span), 0), // x0, y0, tiles around, opacity
      x0: null, y0: null, slots: new Array(N * N).fill(null), on: 0,
    };
  });

  // ─── Fetching ────────────────────────────────────────────────────────────
  const MAX_INFLIGHT = 6;
  let inflight = 0, fails = 0, okCount = 0, offUntil = 0;
  const queue = [];       // slot jobs waiting for a network slot
  const uploads = [];     // [clip, slotIndex, pixels]
  const cache = new Map(); // key → packed pixels (small LRU, for windows moving back)
  const CACHE_MAX = 24;

  async function fetchPixels(url, signal) {
    const res = await fetch(url, { mode: 'cors', signal });
    if (!res.ok) throw new Error(res.status);
    const bmp = await createImageBitmap(await res.blob());
    wctx.clearRect(0, 0, TILE, TILE);
    wctx.drawImage(bmp, 0, 0, TILE, TILE);
    bmp.close && bmp.close();
    return wctx.getImageData(0, 0, TILE, TILE).data;
  }
  function pump() {
    queue.sort((a, b) => a.prio - b.prio);
    while (inflight < MAX_INFLIGHT && queue.length && performance.now() > offUntil) {
      const job = queue.shift();
      if (job.clip.slots[job.slot] !== job.entry) continue; // window moved on
      inflight++;
      const ctrl = new AbortController();
      job.entry.abort = ctrl;
      (async () => {
        const srcs = [];
        for (const s of job.clip.src) srcs.push(await fetchPixels(URL[s](job.clip.z, job.ty, job.tx), ctrl.signal));
        const px = new Uint8Array(PX * 4);
        job.clip.pack(srcs, px);
        return px;
      })().then(px => {
        okCount++; fails = 0;
        cache.set(job.entry.key, px);
        if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
        if (job.clip.slots[job.slot] === job.entry) uploads.push([job.clip, job.slot, px]);
      }).catch(e => {
        if (e && e.name === 'AbortError') return;
        // Offline, blocked by a content policy, or the service is down: back off, and give up
        // for a while if nothing ever worked
        if (++fails >= 6) offUntil = performance.now() + (okCount ? 15e3 : 120e3);
        if (job.clip.slots[job.slot] === job.entry) job.clip.slots[job.slot] = null;
      }).finally(() => { inflight--; job.entry.abort = null; pump(); });
    }
  }

  function placeWindow(c, cx, cy, ci) {
    const x0 = Math.round(cx) - N / 2, y0 = Math.max(0, Math.min(c.nY - N, Math.round(cy) - N / 2));
    if (x0 === c.x0 && y0 === c.y0) return;
    c.x0 = x0; c.y0 = y0;
    c.win.x = ((x0 % c.nX) + c.nX) % c.nX; c.win.y = y0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const tx = (((x0 + i) % c.nX) + c.nX) % c.nX, ty = y0 + j;
      const slot = (ty % N) * N + (tx % N), key = `${c.kind}${c.z}/${ty}/${tx}`;
      const old = c.slots[slot];
      if (old && old.key === key) continue;
      if (old && old.abort) old.abort.abort();
      const entry = { key };
      c.slots[slot] = entry;
      uploads.push([c, slot, null]); // blank the slot until its tile arrives
      const hit = cache.get(key);
      if (hit) { uploads.push([c, slot, hit]); continue; }
      const d = Math.hypot(tx + 0.5 - cx, ty + 0.5 - cy);
      queue.push({ clip: c, slot, entry, tx, ty, prio: ci * 0.5 + d });
    }
    pump();
  }

  // ─── Per frame ───────────────────────────────────────────────────────────
  let last = null;
  const vel = [0, 0]; // smoothed ground speed of the sub-camera point, degrees per real second
  // local: camera position in Earth's body frame (km); pxRad: radians per device pixel
  function update(local, pxRad, earthR) {
    const now = performance.now();
    const r = Math.hypot(local[0], local[1], local[2]), alt = r - earthR;
    const lon = Math.atan2(local[1], local[0]) / DEG, lat = Math.asin(local[2] / r) / DEG;
    const dt = last ? Math.min((now - last.t) / 1000, 0.25) : 0;
    if (dt > 0) {
      let dl = lon - last.lon; dl -= 360 * Math.round(dl / 360);
      const k = Math.min(1, dt * 4);
      vel[0] += (dl / dt - vel[0]) * k; vel[1] += ((lat - last.lat) / dt - vel[1]) * k;
    }
    last = { t: now, lon, lat };
    const cosLat = Math.max(0.05, Math.cos(lat * DEG));
    const speedKm = Math.hypot(vel[0] * cosLat, vel[1]) * KM_PER_DEG;
    const footKm = Math.max(alt, 1) * pxRad; // size of a pixel straight down

    clips.forEach((c, ci) => {
      const tileKm = c.span * KM_PER_DEG;
      // Worth it once a pixel below is finer than ~2.5 of this level's texels, and only if the
      // window (±2 tiles) is not outrun before its tiles can arrive
      const want = alt < 30000 && footKm < c.texelKm * 2.5 && speedKm * 1.5 < tileKm * 1.6;
      c.on += ((want ? 1 : 0) - c.on) * Math.min(1, dt * 3);
      if (c.on < 0.01) c.on = 0;
      c.win.w = c.on;
      if (!want) return;
      // Centre a little ahead along the ground track
      const ahead = Math.min(1, 1.0 * Math.hypot(vel[0], vel[1]) / c.span);
      const vn = Math.hypot(vel[0], vel[1]) || 1;
      const cx = (lon + 180) / c.span + (vel[0] / vn) * ahead, cy = (90 - lat) / c.span - (vel[1] / vn) * ahead;
      placeWindow(c, cx, cy, ci);
    });

    // A few uploads per frame keeps frame time flat while a window fills
    for (let n = 0; n < 6 && uploads.length; n++) {
      const [c, slot, px] = uploads.shift();
      const src = px ? { isDataTexture: true, image: { width: TILE, height: TILE, data: px } } : zero;
      renderer.copyTextureToTexture(new THREE.Vector2((slot % N) * TILE, Math.floor(slot / N) * TILE), src, c.tex);
    }
  }

  const day = clips.filter(c => c.kind === 'day'), aux = clips.filter(c => c.kind === 'aux');
  return { update, day, aux };
};
