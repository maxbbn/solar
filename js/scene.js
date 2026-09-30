'use strict';
// Rendering. Everything is placed relative to the camera each frame ("floating origin"),
// with a logarithmic depth buffer, so a 1-metre rocket and 30 AU orbits coexist at true scale.
const Scene3D = (() => {
  const canvas = document.getElementById('scene');
  const probe = document.createElement('canvas');
  if (!window.THREE || !(probe.getContext('webgl2') || probe.getContext('webgl'))) {
    document.getElementById('loading').innerHTML = tr(
      '<div><b><span>True Scale</span> Solar System</b>这个浏览器没有可用的 WebGL，无法绘制三维场景。<br>请在电脑或手机上用最新版 Chrome、Edge、Safari 或 Firefox 打开，并确认已开启硬件加速。</div>',
      '<div><b><span>True Scale</span> Solar System</b>This browser has no WebGL available, so the 3D scene cannot be drawn.<br>Open it in a current Chrome, Edge, Safari or Firefox with hardware acceleration turned on.</div>');
    throw new Error('WebGL unavailable');
  }
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 1);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 1e-5, 1e13);
  const loader = new THREE.TextureLoader();
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const tex = key => {
    const src = window.TEX && window.TEX[key];
    if (!src) return null;
    const t = loader.load(src);
    t.anisotropy = Math.min(8, maxAniso);
    return t;
  };
  const LOG_V = '#include <common>\n#include <logdepthbuf_pars_vertex>\n';
  const LOG_F = '#include <common>\n#include <logdepthbuf_pars_fragment>\n';
  const STAR_R = 1e11;

  // ─── Shared uniforms ──────────────────────────────────────────────────────
  const SUN_U = { value: new THREE.Vector3() };

  const PLANET_VS = LOG_V + `
    varying vec2 vUv; varying vec3 vN; varying vec3 vP;
    void main() {
      vUv = uv;
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vP = wp.xyz;
      vN = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * viewMatrix * wp;
      #include <logdepthbuf_vertex>
    }`;
  const ECLIPSE_GLSL = `
    uniform vec3 sunPos; uniform float sunR;
    float sunVisF(vec3 p, vec3 op, float orad) {
      vec3 ds = sunPos - p; vec3 dO = op - p;
      float dS = length(ds); float dOl = length(dO);
      if (dot(ds, dO) <= 0.0 || dOl > dS) return 1.0;
      float rs = asin(min(sunR / dS, 1.0)); float ro = asin(min(orad / dOl, 1.0));
      vec3 a = ds / dS; vec3 b = dO / dOl;
      float d = atan(length(cross(a, b)), dot(a, b));
      if (d >= rs + ro) return 1.0;
      if (d <= ro - rs) return 0.0;
      if (d <= rs - ro) return 1.0 - (ro * ro) / (rs * rs);
      float a1 = rs * rs * acos(clamp((d * d + rs * rs - ro * ro) / (2.0 * d * rs), -1.0, 1.0));
      float a2 = ro * ro * acos(clamp((d * d + ro * ro - rs * rs) / (2.0 * d * ro), -1.0, 1.0));
      float a3 = 0.5 * sqrt(max((-d + rs + ro) * (d + rs - ro) * (d - rs + ro) * (d + rs + ro), 0.0));
      return clamp(1.0 - (a1 + a2 - a3) / (PI * rs * rs), 0.0, 1.0);
    }`;
  const PLANET_FS = LOG_F + ECLIPSE_GLSL + `
    uniform sampler2D map; uniform float hasMap; uniform vec3 baseColor;
    uniform sampler2D night; uniform float hasNight;
    uniform vec4 occ[4]; uniform float redden; uniform float ambient; uniform float cloudMode;
    varying vec2 vUv; varying vec3 vN; varying vec3 vP;
    void main() {
      #include <logdepthbuf_fragment>
      vec4 tc = hasMap > 0.5 ? texture2D(map, vUv) : vec4(baseColor, 1.0);
      vec3 N = normalize(vN);
      vec3 L = normalize(sunPos - vP);
      float ndl = dot(N, L);
      float diff = max(ndl, 0.0);
      float vis = 1.0;
      for (int i = 0; i < 4; i++) if (occ[i].w > 0.0) vis *= sunVisF(vP, occ[i].xyz, occ[i].w);
      vec3 col = tc.rgb * (diff * vis + ambient);
      col += tc.rgb * vec3(0.62, 0.2, 0.08) * redden * (1.0 - vis) * max(ndl, 0.0);
      if (hasNight > 0.5) {
        float nf = smoothstep(0.08, -0.12, ndl) + (1.0 - vis) * step(0.0, ndl) * 0.7;
        col += texture2D(night, vUv).rgb * vec3(1.0, 0.82, 0.55) * 0.85 * clamp(nf, 0.0, 1.0);
      }
      float alpha = 1.0;
      if (cloudMode > 0.5) { alpha = smoothstep(0.08, 0.9, tc.r) * 0.92; col = vec3(1.0) * (diff * vis + ambient * 0.5); }
      gl_FragColor = vec4(col, alpha);
    }`;

  function planetMaterial(o) {
    return new THREE.ShaderMaterial({
      uniforms: {
        map: { value: o.map || null }, hasMap: { value: o.map ? 1 : 0 }, baseColor: { value: new THREE.Color(o.color || '#888') },
        night: { value: o.night || null }, hasNight: { value: o.night ? 1 : 0 },
        sunPos: SUN_U, sunR: { value: BODY.sun.radius },
        occ: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) },
        redden: { value: o.redden || 0 }, ambient: { value: o.ambient ?? 0.01 }, cloudMode: { value: o.cloud ? 1 : 0 },
      },
      vertexShader: PLANET_VS, fragmentShader: PLANET_FS,
      transparent: !!o.cloud, depthWrite: !o.cloud,
      extensions: { fragDepth: true },
    });
  }

  const sphereGeo = new THREE.SphereGeometry(1, 160, 80);
  sphereGeo.rotateX(Math.PI / 2); // three's Y-up sphere → Z-up body frame (lon 0 on +X, 90°E on +Y)
  const smallSphere = new THREE.SphereGeometry(1, 48, 24);
  smallSphere.rotateX(Math.PI / 2);

  // ─── Bodies ─────────────────────────────────────────────────────────────
  const meshes = {};
  const OCCLUDERS = { earth: ['moon'], moon: ['earth'], jupiter: ['io', 'europa', 'ganymede', 'callisto'], mars: ['phobos', 'deimos'],
    io: ['jupiter'], europa: ['jupiter'], ganymede: ['jupiter'], callisto: ['jupiter'], titan: ['saturn'], phobos: ['mars'], deimos: ['mars'] };

  for (const b of BODIES) {
    const g = new THREE.Group();
    let mesh;
    if (b.id === 'sun') {
      mesh = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ map: tex('sun'), color: 0xfff2dd }));
    } else {
      const map = b.tex ? tex(b.tex) : null;
      mesh = new THREE.Mesh(b.tex ? sphereGeo : smallSphere, planetMaterial({
        map, color: b.color, night: b.id === 'earth' ? tex('earth_nightmap') : null,
        redden: b.id === 'moon' ? 1 : 0, ambient: b.id === 'moon' ? 0.018 : 0.008,
      }));
    }
    g.add(mesh);
    scene.add(g);
    meshes[b.id] = { group: g, body: mesh, b };
  }
  // Earth: clouds + atmosphere rim
  const clouds = new THREE.Mesh(sphereGeo, planetMaterial({ map: tex('earth_clouds'), cloud: true, ambient: 0.02 }));
  clouds.scale.setScalar(1 + 12 / BODY.earth.radius);
  meshes.earth.group.add(clouds);
  meshes.earth.clouds = clouds;
  const ATMO_FS = LOG_F + `
    uniform vec3 sunPos; uniform vec3 tint; uniform float power;
    varying vec3 vN; varying vec3 vP;
    void main() {
      #include <logdepthbuf_fragment>
      vec3 N = normalize(vN); vec3 V = normalize(-vP); vec3 L = normalize(sunPos - vP);
      float rim = pow(1.0 - abs(dot(N, V)), power);
      float lit = smoothstep(-0.35, 0.4, dot(N, L));
      gl_FragColor = vec4(tint * rim * lit * 1.4, 1.0);
    }`;
  const ATMO_VS = LOG_V + `
    varying vec3 vN; varying vec3 vP;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0); vP = wp.xyz; vN = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * viewMatrix * wp;
      #include <logdepthbuf_vertex>
    }`;
  function atmosphere(scale, tint, power) {
    const m = new THREE.Mesh(sphereGeo, new THREE.ShaderMaterial({
      uniforms: { sunPos: SUN_U, tint: { value: new THREE.Color(tint) }, power: { value: power } },
      vertexShader: ATMO_VS, fragmentShader: ATMO_FS, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, extensions: { fragDepth: true },
    }));
    m.scale.setScalar(scale);
    return m;
  }
  meshes.earth.atmo = atmosphere(1.022, '#4f8dff', 2.6);
  meshes.earth.group.add(meshes.earth.atmo);
  meshes.venus.atmo = atmosphere(1.03, '#ffe2a8', 3.0);
  meshes.venus.group.add(meshes.venus.atmo);
  meshes.mars.atmo = atmosphere(1.012, '#e59a6a', 4.0);
  meshes.mars.group.add(meshes.mars.atmo);

  // Saturn's rings (lit, with the planet's shadow)
  {
    const [r0, r1] = BODY.saturn.ring;
    const geo = new THREE.RingGeometry(r0, r1, 256, 1);
    const mat = new THREE.ShaderMaterial({
      uniforms: { ringTex: { value: tex('saturn_ring') }, sunPos: SUN_U, center: { value: new THREE.Vector3() }, pr: { value: BODY.saturn.radius }, r0: { value: r0 }, r1: { value: r1 }, nrm: { value: new THREE.Vector3() } },
      vertexShader: LOG_V + `varying vec3 vL; varying vec3 vP;
        void main() { vL = position; vec4 wp = modelMatrix * vec4(position, 1.0); vP = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: LOG_F + `uniform sampler2D ringTex; uniform vec3 sunPos; uniform vec3 center; uniform float pr; uniform float r0; uniform float r1; uniform vec3 nrm;
        varying vec3 vL; varying vec3 vP;
        void main() {
          #include <logdepthbuf_fragment>
          float t = (length(vL.xy) - r0) / (r1 - r0);
          vec4 c = texture2D(ringTex, vec2(t, 0.5));
          vec3 L = normalize(sunPos - vP);
          vec3 oc = vP - center; float bq = dot(oc, L); float cq = dot(oc, oc) - pr * pr;
          float shadow = (bq < 0.0 && bq * bq - cq > 0.0) ? 0.06 : 1.0;
          float lit = 0.3 + 0.7 * abs(dot(normalize(nrm), L));
          gl_FragColor = vec4(c.rgb * lit * shadow, c.a * 0.95);
        }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, extensions: { fragDepth: true },
    });
    const ring = new THREE.Mesh(geo, mat);
    scene.add(ring);
    meshes.saturn.ring = ring;
  }

  // Sun glare: sprites keep the Sun visible as a bright star from the outer system
  function glowTexture(stops) {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const x = c.getContext('2d'), g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
    for (const [o, col] of stops) g.addColorStop(o, col);
    x.fillStyle = g; x.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c);
    return t;
  }
  const glowTex = glowTexture([[0, 'rgba(255,250,235,1)'], [0.12, 'rgba(255,236,190,0.9)'], [0.3, 'rgba(255,190,110,0.28)'], [0.6, 'rgba(255,150,70,0.07)'], [1, 'rgba(255,140,60,0)']]);
  const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  scene.add(sunGlow);
  const sunHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.35 }));
  scene.add(sunHalo);

  // ─── Stars & constellations ─────────────────────────────────────────────
  const bvColor = bv => {
    const t = Math.max(-0.4, Math.min(2, bv));
    const r = t < 0.4 ? 0.62 + 0.95 * (t + 0.4) * 0.5 : 1;
    const g = t < 0 ? 0.72 + 0.28 * (t + 0.4) / 0.4 : t < 0.9 ? 1 - 0.1 * t : 0.91 - 0.3 * (t - 0.9);
    const b = t < 0.2 ? 1 : t < 1.2 ? 1 - 0.55 * (t - 0.2) : 0.45 - 0.2 * (t - 1.2);
    return [Math.min(1, r), Math.max(0.4, g), Math.max(0.25, b)];
  };
  const STAR_U = { dim: { value: 1 }, pxr: { value: renderer.getPixelRatio() } };
  let stars;
  {
    const S = (window.SKY && window.SKY.stars) || [];
    const n = S.length / 4, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const v = raDecToVec(S[i * 4] * DEG, S[i * 4 + 1] * DEG), m = S[i * 4 + 2], c = bvColor(S[i * 4 + 3]);
      pos.set([v[0] * STAR_R, v[1] * STAR_R, v[2] * STAR_R], i * 3);
      const bright = Math.pow(10, -0.4 * (m - 1.2));
      const a = Math.min(1, 0.16 + 0.9 * Math.sqrt(bright));
      col.set([c[0] * a, c[1] * a, c[2] * a], i * 3);
      size[i] = Math.max(1.6, Math.min(5.5, 2.1 + 1.6 * Math.sqrt(bright)));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
    stars = new THREE.Points(geo, new THREE.ShaderMaterial({
      uniforms: STAR_U,
      vertexShader: LOG_V + `attribute float size; attribute vec3 color; uniform float pxr; varying vec3 vC;
        void main() { vC = color; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * pxr;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: LOG_F + `uniform float dim; varying vec3 vC;
        void main() {
          #include <logdepthbuf_fragment>
          float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.05, d);
          gl_FragColor = vec4(vC * a * dim, 1.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, extensions: { fragDepth: true },
    }));
    stars.renderOrder = -10;
    stars.frustumCulled = false;
    scene.add(stars);
  }
  let constLines;
  {
    const L = (window.SKY && window.SKY.lines) || [], n = L.length / 4, pos = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) {
      const a = raDecToVec(L[i * 4] * DEG, L[i * 4 + 1] * DEG), b = raDecToVec(L[i * 4 + 2] * DEG, L[i * 4 + 3] * DEG);
      pos.set([a[0] * STAR_R, a[1] * STAR_R, a[2] * STAR_R, b[0] * STAR_R, b[1] * STAR_R, b[2] * STAR_R], i * 6);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    constLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x5b7fb8, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending }));
    constLines.renderOrder = -9;
    constLines.frustumCulled = false;
    constLines.visible = false;
    scene.add(constLines);
  }
  const constNames = ((window.SKY && window.SKY.names) || []).map(([zh, en, ra, dec]) => ({ zh, en, v: raDecToVec(ra * DEG, dec * DEG) }));

  // ─── Surface: sky dome + ground ─────────────────────────────────────────
  const SKY_STYLE = {
    earth: { zen: [0.16, 0.36, 0.78], hor: [0.62, 0.76, 0.93], set: [1.0, 0.45, 0.18], ground: [0.15, 0.19, 0.12], fog: 1 },
    mars: { zen: [0.42, 0.32, 0.24], hor: [0.72, 0.56, 0.40], set: [0.36, 0.52, 0.82], ground: [0.5, 0.28, 0.16], fog: 0.5 },
    moon: { ground: [0.4, 0.39, 0.37], fog: 0 },
  };
  const skyU = { sunDir: { value: new THREE.Vector3() }, up: { value: new THREE.Vector3() }, vis: { value: 1 }, zen: { value: new THREE.Vector3() }, hor: { value: new THREE.Vector3() }, setc: { value: new THREE.Vector3() } };
  const skyDome = new THREE.Mesh(new THREE.SphereGeometry(1e4, 64, 32), new THREE.ShaderMaterial({
    uniforms: skyU,
    vertexShader: LOG_V + `varying vec3 vD; void main() { vD = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vD, 1.0);
      #include <logdepthbuf_vertex>
    }`,
    fragmentShader: LOG_F + `uniform vec3 sunDir; uniform vec3 up; uniform float vis; uniform vec3 zen; uniform vec3 hor; uniform vec3 setc; varying vec3 vD;
      void main() {
        #include <logdepthbuf_fragment>
        vec3 v = normalize(vD);
        float h = dot(v, up), sh = dot(sunDir, up), mu = dot(v, sunDir);
        float day = smoothstep(-0.2, 0.12, sh);
        float hz = pow(1.0 - clamp(h, 0.0, 1.0), 5.0);
        vec3 base = mix(zen, hor, hz);
        float twi = smoothstep(0.3, 0.0, abs(sh + 0.03));
        base = mix(base, setc, twi * hz * (0.25 + 0.75 * pow(max(mu, 0.0), 2.0)));
        base *= day * (0.55 + 0.45 * smoothstep(-0.1, 0.4, sh));
        float glare = (pow(max(mu, 0.0), 3000.0) * 0.5 + pow(max(mu, 0.0), 60.0) * 0.16 + pow(max(mu, 0.0), 6.0) * 0.08) * smoothstep(-0.08, 0.04, sh);
        vec3 col = (base + vec3(1.0, 0.92, 0.8) * glare) * vis + hor * 0.035 * hz * (1.0 - day);
        gl_FragColor = vec4(col, 1.0);
      }`,
    side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, extensions: { fragDepth: true },
  }));
  skyDome.renderOrder = -5;
  skyDome.frustumCulled = false;
  skyDome.visible = false;
  scene.add(skyDome);

  const groundU = { color: { value: new THREE.Vector3() }, light: { value: 0 }, fogCol: { value: new THREE.Vector3() }, fogAmt: { value: 0 } };
  const ground = new THREE.Mesh(new THREE.CircleGeometry(1, 96), new THREE.ShaderMaterial({
    uniforms: groundU,
    vertexShader: LOG_V + `varying vec2 vL; varying vec3 vP; void main() { vL = position.xy * 2.0e4; vec4 wp = modelMatrix * vec4(position, 1.0); vP = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
      #include <logdepthbuf_vertex>
    }`,
    fragmentShader: LOG_F + `uniform vec3 color; uniform float light; uniform vec3 fogCol; uniform float fogAmt; varying vec2 vL; varying vec3 vP;
      float hsh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hsh(i), hsh(i + vec2(1, 0)), f.x), mix(hsh(i + vec2(0, 1)), hsh(i + vec2(1, 1)), f.x), f.y); }
      void main() {
        #include <logdepthbuf_fragment>
        vec2 m = vL * 1000.0; // metres
        float n = vnoise(m * 0.8) * 0.3 + vnoise(m * 0.07) * 0.4 + vnoise(m * 0.004) * 0.3;
        vec3 c = color * (0.65 + 0.6 * n) * light;
        float d = length(vP);
        c = mix(c, fogCol, fogAmt * (1.0 - exp(-d / 25.0)));
        gl_FragColor = vec4(c, 1.0);
      }`,
    extensions: { fragDepth: true },
  }));
  ground.scale.setScalar(2e4);
  ground.visible = false;
  scene.add(ground);

  // ─── Orbit lines ────────────────────────────────────────────────────────
  class Track {
    constructor(n, color, opacity) {
      this.n = n;
      this.geo = new THREE.BufferGeometry();
      this.arr = new Float32Array(n * 3);
      this.geo.setAttribute('position', new THREE.BufferAttribute(this.arr, 3).setUsage(THREE.DynamicDrawUsage));
      this.mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
      this.line = new THREE.Line(this.geo, this.mat);
      this.line.frustumCulled = false;
      this.base = opacity;
      scene.add(this.line);
    }
    set(points) {
      for (let i = 0; i < this.n; i++) { const p = points[Math.min(i, points.length - 1)]; this.arr[i * 3] = p[0]; this.arr[i * 3 + 1] = p[1]; this.arr[i * 3 + 2] = p[2]; }
      this.geo.attributes.position.needsUpdate = true;
      this.geo.setDrawRange(0, Math.min(this.n, points.length));
    }
  }
  const orbitTracks = {};
  for (const b of BODIES) {
    if (b.id === 'sun') continue;
    const parent = b.parent || 'sun';
    const period = b.orbit ? b.orbit[1] : b.period;
    orbitTracks[b.id] = { track: new Track(b.parent ? 256 : 512, new THREE.Color(b.color).lerp(new THREE.Color('#9fb3d6'), 0.45), b.parent ? 0.4 : 0.5), parent, period, built: -1e9 };
  }
  function rebuildOrbit(id, jd) {
    const o = orbitTracks[id], n = o.track.n, pts = [];
    for (let i = 0; i < n; i++) {
      const u = -1 + 2 * i / (n - 1), t = jd + o.period / 2 * u * u * u;
      pts.push(V3.sub(bodyPos(id, t), bodyPos(o.parent, t)));
    }
    o.track.set(pts);
    o.built = jd;
  }

  // ─── Spacecraft ─────────────────────────────────────────────────────────
  const craft = new THREE.Group();
  {
    const white = new THREE.MeshLambertMaterial({ color: 0xf2efe8 }), dark = new THREE.MeshLambertMaterial({ color: 0x2a2f38 }), gold = new THREE.MeshLambertMaterial({ color: 0xd8a24a });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.0021, 0.0021, 0.032, 24), white); body.position.y = 0.016;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.00215, 0.00215, 0.004, 24), dark); band.position.y = 0.022;
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.0021, 0.009, 24), white); nose.position.y = 0.0365;
    const pay = new THREE.Mesh(new THREE.CylinderGeometry(0.0019, 0.0021, 0.003, 24), gold); pay.position.y = 0.0305;
    const noz = new THREE.Mesh(new THREE.ConeGeometry(0.0015, 0.003, 16, 1, true), dark); noz.position.y = -0.001; noz.rotation.x = Math.PI;
    craft.add(body, band, nose, pay, noz);
    for (let k = 0; k < 4; k++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.0003, 0.006, 0.003), dark);
      fin.position.set(Math.cos(k * Math.PI / 2) * 0.0026, 0.003, Math.sin(k * Math.PI / 2) * 0.0026);
      fin.rotation.y = -k * Math.PI / 2;
      craft.add(fin);
    }
  }
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.0017, 0.02, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0xffb35c, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
  flame.position.y = -0.012; flame.rotation.x = Math.PI;
  craft.add(flame);
  const plume = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffc27a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  scene.add(plume);
  craft.visible = false; plume.visible = false;
  scene.add(craft);
  const sunLight = new THREE.DirectionalLight(0xffffff, 1.1);
  const ambient = new THREE.AmbientLight(0x303848, 0.6);
  scene.add(sunLight, sunLight.target, ambient);

  // International Space Station + its orbit (rewritten camera-relative every frame, like mission paths)
  const iss = buildISSModel();
  scene.add(iss);
  const issTrack = new Track(400, 0xd9d2bf, 0.55);
  const tmpBasis = new THREE.Matrix4();

  // Mission path pieces: past (bright) + future (faint)
  let missionPieces = [];
  function setMission(m) {
    for (const p of missionPieces) { scene.remove(p.past.line, p.future.line); }
    missionPieces = [];
    if (!m) return;
    for (const piece of m.paths) {
      const times = sampleTimes(m, piece);
      const pts = times.map(t => V3.sub(m.pos(t), bodyPos(piece.frame, t)));
      const past = new Track(pts.length + 1, 0xffb23e, 0.95), future = new Track(pts.length + 1, 0x72a7ff, 0.55);
      missionPieces.push({ piece, times, pts, past, future });
    }
  }
  // Writes pts[a..b) (relative to a frame body at camera-relative offset `fr`) into a track.
  // The craft's exact position, when given, closes the past line / opens the future line.
  function fillPath(track, pts, a, b, fr, craftRel, craftFirst) {
    const arr = track.arr;
    let n = 0;
    const put = (x, y, z) => { arr[n * 3] = x; arr[n * 3 + 1] = y; arr[n * 3 + 2] = z; n++; };
    if (craftRel && craftFirst) put(fr[0] + craftRel[0], fr[1] + craftRel[1], fr[2] + craftRel[2]);
    for (let i = a; i < b; i++) { const p = pts[i]; put(fr[0] + p[0], fr[1] + p[1], fr[2] + p[2]); }
    if (craftRel && !craftFirst) put(fr[0] + craftRel[0], fr[1] + craftRel[1], fr[2] + craftRel[2]);
    track.line.position.set(0, 0, 0);
    track.geo.attributes.position.needsUpdate = true;
    track.geo.setDrawRange(0, n);
  }
  function sampleTimes(m, piece) {
    const rel = t => V3.sub(m.pos(t), bodyPos(piece.frame, t));
    const out = [];
    const bounds = [piece.t0];
    for (const s of m.segs) if (s.t0 > piece.t0 && s.t0 < piece.t1) bounds.push(s.t0);
    bounds.push(piece.t1);
    const refine = (t0, p0, t1, p1, depth) => {
      const tm = (t0 + t1) / 2, pm = rel(tm), mid = V3.lerp(p0, p1, 0.5);
      const chord = V3.len(V3.sub(p1, p0)), dev = V3.len(V3.sub(pm, mid));
      if (depth < 11 && dev > 0.0025 * chord + 1e-3) { refine(t0, p0, tm, pm, depth + 1); out.push(tm); refine(tm, pm, t1, p1, depth + 1); }
      else if (depth < 3) { refine(t0, p0, tm, pm, depth + 1); out.push(tm); refine(tm, pm, t1, p1, depth + 1); }
    };
    for (let k = 0; k < bounds.length - 1; k++) {
      const a = bounds[k], b = bounds[k + 1], N = 40;
      let tp = a, pp = rel(a);
      out.push(a);
      for (let i = 1; i <= N; i++) {
        const t = a + (b - a) * i / N, p = rel(t);
        refine(tp, pp, t, p, 0);
        out.push(t);
        tp = t; pp = p;
      }
    }
    return out;
  }

  // Light pulses (expanding spheres at c)
  const pulseMat = new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader: ATMO_VS,
    fragmentShader: LOG_F + `varying vec3 vN; varying vec3 vP;
      void main() {
        #include <logdepthbuf_fragment>
        float f = 1.0 - abs(dot(normalize(vN), normalize(-vP)));
        gl_FragColor = vec4(vec3(1.0, 0.85, 0.45) * (0.03 + pow(f, 6.0) * 0.9), 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, extensions: { fragDepth: true },
  });
  const pulseMeshes = [];
  const pulseGeo = new THREE.SphereGeometry(1, 96, 48);

  // ─── Labels (HTML overlay) ──────────────────────────────────────────────
  const labelLayer = document.getElementById('labels');
  const labels = {};
  const mkLabel = (id, name, color, cls = '') => {
    const el = document.createElement('button');
    el.className = 'lbl ' + cls;
    el.type = 'button';
    el.innerHTML = `<i style="background:${color}"></i><span></span>`;
    el.dataset.id = id;
    labelLayer.appendChild(el);
    el.style.display = 'none';
    labels[id] = { el, span: el.querySelector('span'), shown: false };
    return labels[id];
  };
  for (const b of BODIES) mkLabel(b.id, b.name, b.color, b.parent && b.parent !== 'earth' ? 'minor' : b.id === 'sun' ? 'sun' : '');
  mkLabel('craft', '探测器', '#ffb23e', 'craft');
  mkLabel('iss', '国际空间站', '#e8e2d0', 'craft iss');
  const compass = [0, 1, 2, 3, 4, 5, 6, 7].map(i => {
    const el = document.createElement('div');
    el.className = 'compass' + (i % 2 ? ' minor' : '');
    labelLayer.appendChild(el);
    return { el, az: i * 45 * DEG };
  });
  const constEls = constNames.map(() => { const el = document.createElement('div'); el.className = 'cname'; labelLayer.appendChild(el); return el; });
  // (Re)write every label in the current language
  function relabel() {
    for (const b of BODIES) labels[b.id].span.textContent = b.name;
    labels.craft.span.textContent = tr('探测器', 'Probe');
    labels.iss.span.textContent = tr('国际空间站', 'ISS');
    const dirs = tr('北,东北,东,东南,南,西南,西,西北', 'N,NE,E,SE,S,SW,W,NW').split(',');
    compass.forEach((c, i) => { c.el.textContent = dirs[i]; });
    constNames.forEach((c, i) => { constEls[i].textContent = tr(c.zh, c.en); });
  }
  relabel();

  const tmpV = new THREE.Vector3(), tmpM = new THREE.Matrix4();
  let W = 1, H = 1;
  function resize() {
    W = window.innerWidth; H = window.innerHeight;
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    STAR_U.pxr.value = renderer.getPixelRatio();
  }
  window.addEventListener('resize', resize);
  resize();

  function project(rel) { // camera-relative km → screen px, or null if behind
    tmpV.set(rel[0], rel[1], rel[2]).project(camera);
    if (tmpV.z > 1 || tmpV.z < -1) return null;
    return [(tmpV.x + 1) / 2 * W, (1 - tmpV.y) / 2 * H];
  }
  const setQuat = (obj, M) => { tmpM.set(M[0], M[1], M[2], 0, M[3], M[4], M[5], 0, M[6], M[7], M[8], 0, 0, 0, 0, 1); obj.quaternion.setFromRotationMatrix(tmpM); };

  // ─── Per-frame update ───────────────────────────────────────────────────
  function update(ctx) {
    const { jd, pos, C, dir, up, fov, surface, toggles, mission, craftPos, pulses, focusId, starDim } = ctx;
    const rel = p => [p[0] - C[0], p[1] - C[1], p[2] - C[2]];
    camera.position.set(0, 0, 0);
    camera.up.set(up[0], up[1], up[2]);
    camera.lookAt(dir[0], dir[1], dir[2]);
    if (Math.abs(camera.fov - fov) > 1e-6) { camera.fov = fov; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld();
    const pxPerRad = H / 2 / Math.tan(fov * DEG / 2);

    const sunRel = rel(pos.sun);
    SUN_U.value.set(sunRel[0], sunRel[1], sunRel[2]);
    sunLight.position.set(sunRel[0], sunRel[1], sunRel[2]).normalize();

    for (const id in meshes) {
      const m = meshes[id], b = m.b, r = rel(pos[id]);
      const hide = surface && surface.body === id;
      m.group.visible = !hide;
      if (hide) continue;
      m.group.position.set(r[0], r[1], r[2]);
      const R = bodyRot(id, jd);
      if (R) setQuat(m.group, R);
      m.body.scale.set(b.radius, b.radius, b.radius * (1 - (b.flat || 0)));
      if (m.atmo) m.atmo.scale.setScalar(b.radius * (id === 'earth' ? 1.022 : id === 'venus' ? 1.03 : 1.012));
      if (m.clouds) {
        m.clouds.scale.setScalar(b.radius + 12);
        m.clouds.rotation.z = (jd % 3650) * 0.35 * DEG;
      }
      const occ = OCCLUDERS[id];
      if (occ) {
        const arr = m.body.material.uniforms.occ.value;
        for (let i = 0; i < 4; i++) {
          if (!occ[i]) { arr[i].set(0, 0, 0, 0); continue; }
          const o = rel(pos[occ[i]]);
          arr[i].set(o[0], o[1], o[2], BODY[occ[i]].radius * (occ[i] === 'earth' ? 1.02 : 1));
        }
        if (m.clouds) m.clouds.material.uniforms.occ.value[0].copy(arr[0]);
      }
    }
    // Saturn's ring follows the planet's equator
    {
      const ring = meshes.saturn.ring, r = rel(pos.saturn), pf = poleFrame(BODY.saturn);
      ring.position.set(r[0], r[1], r[2]);
      setQuat(ring, pf);
      ring.material.uniforms.center.value.set(r[0], r[1], r[2]);
      ring.material.uniforms.nrm.value.set(pf[2], pf[5], pf[8]);
    }
    // Sun glare sizes
    {
      const d = V3.len(sunRel), minWorld = d * 70 / pxPerRad;
      sunGlow.position.set(sunRel[0], sunRel[1], sunRel[2]);
      sunGlow.scale.setScalar(Math.max(BODY.sun.radius * 5, minWorld));
      sunHalo.position.copy(sunGlow.position);
      sunHalo.scale.setScalar(Math.max(BODY.sun.radius * 16, d * 260 / pxPerRad));
      const dimGlow = surface ? ctx.sunVis : 1;
      sunGlow.material.opacity = 0.35 + 0.65 * dimGlow;
      sunHalo.material.opacity = 0.35 * dimGlow;
    }

    // Stars
    STAR_U.dim.value = starDim;
    constLines.visible = !!toggles.constellations;

    // Surface environment
    // skyOnly: flying low through Earth's atmosphere (nose camera), sky without ground
    const skyEnv = surface || ctx.skyOnly;
    skyDome.visible = !!(skyEnv && SKY_STYLE[skyEnv.body].zen);
    ground.visible = !!surface;
    if (ctx.skyOnly && !surface) {
      const st = SKY_STYLE[ctx.skyOnly.body], sd = V3.norm(sunRel), up = ctx.skyOnly.up;
      skyU.sunDir.value.set(sd[0], sd[1], sd[2]);
      skyU.up.value.set(up[0], up[1], up[2]);
      skyU.vis.value = ctx.sunVis * ctx.skyOnly.fade;
      skyU.zen.value.set(...st.zen); skyU.hor.value.set(...st.hor); skyU.setc.value.set(...st.set);
    }
    if (surface) {
      const st = SKY_STYLE[surface.body];
      const sd = V3.norm(sunRel);
      const sunAlt = V3.dot(sd, surface.up);
      if (st.zen) {
        skyU.sunDir.value.set(sd[0], sd[1], sd[2]);
        skyU.up.value.set(surface.up[0], surface.up[1], surface.up[2]);
        skyU.vis.value = ctx.sunVis;
        skyU.zen.value.set(...st.zen); skyU.hor.value.set(...st.hor); skyU.setc.value.set(...st.set);
      }
      const footRel = V3.mul(surface.up, -surface.h);
      ground.position.set(footRel[0], footRel[1], footRel[2]);
      ground.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(surface.up[0], surface.up[1], surface.up[2]));
      const light = Math.max(0, Math.sin(Math.asin(Math.max(-1, Math.min(1, sunAlt))))) * ctx.sunVis * 0.95 + smoothstep(-0.2, 0.05, sunAlt) * 0.05 * ctx.sunVis + 0.012;
      groundU.light.value = light;
      groundU.color.value.set(...st.ground);
      const day = smoothstep(-0.2, 0.12, sunAlt) * ctx.sunVis;
      groundU.fogCol.value.set(...(st.hor || [0, 0, 0]).map(x => x * day * 0.8));
      groundU.fogAmt.value = st.fog;
    }

    // Orbits
    for (const id in orbitTracks) {
      const o = orbitTracks[id], b = BODY[id];
      let show = toggles.orbits && !surface;
      if (show && b.parent && b.parent !== 'earth') show = V3.len(rel(pos[b.parent])) < b.orbit[0] * 400;
      o.track.line.visible = show;
      if (!show) continue;
      if (Math.abs(jd - o.built) > o.period * 0.0004) rebuildOrbit(id, jd);
      const pr = rel(pos[o.parent]);
      o.track.line.position.set(pr[0], pr[1], pr[2]);
      const dBody = V3.len(rel(pos[id])), orbitSize = V3.len(V3.sub(pos[id], pos[o.parent]));
      const near = smoothstep(Math.log(b.radius * 25), Math.log(b.radius * 600), Math.log(dBody));
      const px = orbitSize / Math.max(V3.len(pr), 1) * pxPerRad;
      let others = 1;
      if (!b.parent && ctx.camTargetDist != null && id !== focusId) others = smoothstep(Math.log(3e6), Math.log(4e7), Math.log(ctx.camTargetDist));
      o.track.mat.opacity = o.track.base * near * others * smoothstep(4, 18, px);
    }

    // Space station
    {
      const f = ctx.issFrame, r = rel(ctx.issPos);
      iss.position.set(r[0], r[1], r[2]);
      tmpBasis.makeBasis(new THREE.Vector3(...f.F), new THREE.Vector3(...f.port), new THREE.Vector3(...f.up));
      iss.quaternion.setFromRotationMatrix(tmpBasis);
      const sd = V3.norm(V3.sub(sunRel, r)), sx = V3.dot(sd, f.F), sz = V3.dot(sd, f.up);
      for (const a of iss.userData.arrays) a.rotation.y = Math.atan2(-sz, sx); // arrays track the Sun
      const d = V3.len(r);
      let op = 0;
      if (toggles.orbits && !surface) op = 0.55 * smoothstep(Math.log(15), Math.log(80), Math.log(d)) * (1 - smoothstep(Math.log(3e6), Math.log(3e7), Math.log(d)));
      issTrack.line.visible = op > 0.01;
      if (issTrack.line.visible) {
        issTrack.mat.opacity = op;
        const er = rel(pos.earth), n = issTrack.n, P = ISS.period / 1440, pts = issTrack.arr;
        for (let i = 0; i < n; i++) {
          const u = -1 + 2 * i / (n - 1), g = ISS.geo(jd + P / 2 * u * u * u);
          pts[i * 3] = er[0] + g[0]; pts[i * 3 + 1] = er[1] + g[1]; pts[i * 3 + 2] = er[2] + g[2];
        }
        issTrack.line.position.set(0, 0, 0);
        issTrack.geo.attributes.position.needsUpdate = true;
        issTrack.geo.setDrawRange(0, n);
      }
    }
    // Light on the station/rocket dims in Earth's shadow
    sunLight.intensity = 1.1 * ctx.localSunVis;
    ambient.intensity = 0.25 + 0.35 * ctx.localSunVis;

    // Mission
    craft.visible = plume.visible = !!mission;
    for (const p of missionPieces) {
      const fr = rel(pos[p.piece.frame] || bodyPos(p.piece.frame, jd));
      let k = 0, lo = 0, hi = p.times.length - 1;
      if (jd <= p.times[0]) k = 0; else if (jd >= p.times[hi]) k = p.times.length; else {
        while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (p.times[mid] <= jd) lo = mid; else hi = mid; }
        k = lo + 1;
      }
      // Each piece is drawn relative to its body's *current* position. The departure leg only
      // makes sense while the craft is still near Earth, and the arrival leg only once the craft
      // has reached the target; otherwise the leg floats off the body pointing nowhere.
      const f = p.piece.frame, first = p === missionPieces[0];
      const relevant = f === 'sun' || (first ? jd <= p.piece.t1 : jd >= p.piece.t0);
      const vis = relevant && toggles.orbits;
      p.past.line.visible = p.future.line.visible = vis;
      if (!vis) continue;
      // Vertices are rewritten camera-relative in float64 every frame: stored relative to the
      // Sun or Earth they would be rounded to metres–kilometres in float32 and visibly shake
      // when the camera follows the craft from a few hundred metres away.
      const inside = craftPos && jd > p.piece.t0 && jd < p.piece.t1 && k > 0 && k < p.times.length;
      const craftRel = inside ? V3.sub(craftPos, V3.add(fr, C)) : null;
      fillPath(p.past, p.pts, 0, k, fr, craftRel, false);
      fillPath(p.future, p.pts, Math.max(0, k - (inside ? 0 : 1)), p.pts.length, fr, craftRel, true);
    }
    if (mission && craftPos) {
      const r = rel(craftPos);
      craft.position.set(r[0], r[1], r[2]);
      const att = ctx.craftAttitude;
      craft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(att[0], att[1], att[2]));
      const d = V3.len(r);
      const scale = Math.max(1, d * 2.5 / pxPerRad / 0.04);
      craft.scale.setScalar(scale);
      flame.visible = ctx.burning;
      flame.scale.set(1, 0.7 + 0.3 * Math.random(), 1);
      plume.visible = ctx.burning;
      plume.position.set(r[0] - att[0] * 0.01 * scale, r[1] - att[1] * 0.01 * scale, r[2] - att[2] * 0.01 * scale);
      plume.scale.setScalar(Math.max(0.05 * scale, d * 26 / pxPerRad));
    }

    // Light pulses
    while (pulseMeshes.length < pulses.length) { const m = new THREE.Mesh(pulseGeo, pulseMat); m.frustumCulled = false; scene.add(m); pulseMeshes.push(m); }
    pulseMeshes.forEach((m, i) => {
      const p = pulses[i];
      m.visible = !!p && p.radius > 0;
      if (!m.visible) return;
      const r = rel(p.origin);
      m.position.set(r[0], r[1], r[2]);
      m.scale.setScalar(p.radius);
    });

    renderer.render(scene, camera);
    updateLabels(ctx, rel, pxPerRad);
  }

  // ─── Labels ─────────────────────────────────────────────────────────────
  const PRIORITY = ['craft', 'iss', 'sun', 'earth', 'moon', 'mars', 'venus', 'jupiter', 'saturn', 'mercury', 'uranus', 'neptune', 'pluto', 'titan', 'ganymede', 'callisto', 'io', 'europa', 'phobos', 'deimos'];
  function updateLabels(ctx, rel, pxPerRad) {
    const { pos, surface, toggles, focusId, mission, craftPos } = ctx;
    const placed = [];
    const big = BODIES.filter(b => b.radius > 1000 && !(surface && surface.body === b.id));
    for (const id of PRIORITY) {
      const L = labels[id];
      let show = toggles.labels;
      let r, radius = 0;
      if (id === 'craft') { show = !!(mission && craftPos) && ctx.cockpit !== 'rocket'; if (show) r = rel(craftPos); }
      else if (id === 'iss') { show = toggles.labels && ctx.cockpit !== 'iss'; r = rel(ctx.issPos); radius = 0.055; }
      else { radius = BODY[id].radius; r = rel(pos[id]); if (surface && surface.body === id) show = false; }
      let sp = null, d = 0;
      if (show) {
        d = V3.len(r);
        sp = project(r);
        if (!sp) show = false;
      }
      if (show) {
        const u = V3.mul(r, 1 / d);
        if (surface && V3.dot(u, surface.up) < -0.002) show = false;
        for (const o of big) {
          if (!show) break;
          if (o.id === id) continue;
          const ro = rel(pos[o.id]), t = V3.dot(ro, u);
          if (t > 0 && t < d && V3.dot(ro, ro) - t * t < o.radius * o.radius * 0.98) show = false;
        }
      }
      if (show && BODY[id] && BODY[id].parent && BODY[id].parent !== 'earth' && focusId !== id) {
        const pp = rel(pos[BODY[id].parent]);
        if (V3.len(pp) > BODY[id].orbit[0] * 250) show = false;
      }
      const pr = radius / Math.max(d, 1e-9) * pxPerRad;
      if (show) {
        const yOff = pr > 6 ? -pr : 0;
        const x = sp[0], y = sp[1] + yOff;
        if (x < -40 || y < -40 || x > W + 40 || y > H + 40) show = false;
        else if (id !== 'craft' && id !== focusId && placed.some(q => Math.abs(q[0] - x) < 44 && Math.abs(q[1] - y) < 16)) show = false;
        else {
          placed.push([x, y]);
          L.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
          L.el.classList.toggle('resolved', pr > 6);
          L.el.classList.toggle('focus', id === focusId);
        }
      }
      if (show !== L.shown) { L.el.style.display = show ? '' : 'none'; L.shown = show; }
    }
    // Compass + constellation names (surface only)
    for (const c of compass) {
      let sp = null;
      if (surface && !surface.noCompass) {
        const d = V3.add(V3.mul(surface.north, Math.cos(c.az)), V3.mul(surface.east, Math.sin(c.az)));
        sp = project(V3.add(V3.mul(d, 1e3), V3.mul(surface.up, 8)));
      }
      c.el.style.display = sp ? '' : 'none';
      if (sp) c.el.style.transform = `translate(${sp[0].toFixed(1)}px, ${sp[1].toFixed(1)}px)`;
    }
    constNames.forEach((c, i) => {
      let sp = null;
      if (toggles.constellations && (!surface || V3.dot(c.v, surface.up) > 0.02)) sp = project(V3.mul(c.v, 1e9));
      constEls[i].style.display = sp ? '' : 'none';
      if (sp) constEls[i].style.transform = `translate(${sp[0].toFixed(1)}px, ${sp[1].toFixed(1)}px)`;
    });
  }

  return { update, setMission, labelLayer, project, relabel, get size() { return [W, H]; }, camera, renderer };
})();
