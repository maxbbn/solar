// Production build into dist/: minified, concatenated scripts and CSS, every asset renamed with a
// content hash so it can be cached forever, and index.html (always revalidated) pointing at them.
// The source tree stays runnable as-is (file:// or any static server); only dist/ is deployed.
//
// Scripts stay classic (non-module) scripts sharing globals, so they are concatenated rather than
// bundled; esbuild minifies each file without renaming top-level names. Planet textures are
// emitted as separate image files instead of assets/textures.js: over http(s) they are
// same-origin, so WebGL accepts them, and they skip base64's 33% overhead.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { transform } from 'esbuild';
import { minify as minifyHtml } from 'html-minifier-terser';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = join(root, 'dist');
const require = createRequire(import.meta.url);
const read = p => readFileSync(join(root, p), 'utf8');

const BUNDLES = {
  // Rarely changes: kept apart so app releases don't invalidate it.
  vendor: [require.resolve('three/build/three.min.js')],
  // Star catalog; the texture manifest is prepended at build time.
  data: ['assets/sky.js'],
  app: ['js/i18n.js', 'js/astro.js', 'js/missions.js', 'js/iss.js', 'js/tiles.js', 'js/scene.js', 'js/app.js'],
};

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'assets'), { recursive: true });

const hash = buf => createHash('sha256').update(buf).digest('hex').slice(0, 10);
const sizes = [];
// Writes dist/assets/<name>.<hash><ext> and returns its URL path relative to index.html.
function emit(name, ext, content) {
  const file = `assets/${name}.${hash(content)}${ext}`;
  writeFileSync(join(out, file), content);
  sizes.push([file, Buffer.byteLength(content)]);
  return file;
}

// ─── Textures ──────────────────────────────────────────────────────────────
// Same set assets/textures.js packs (tools/build_data.py): every .jpg/.png in assets/.
const tex = {};
for (const fn of readdirSync(join(root, 'assets')).sort()) {
  if (!/\.(jpg|png)$/.test(fn)) continue;
  const ext = extname(fn);
  tex[basename(fn, ext)] = emit(basename(fn, ext), ext, readFileSync(join(root, 'assets', fn)));
}

// ─── Scripts ───────────────────────────────────────────────────────────────
// Each file is minified on its own and the results concatenated, with an index source map
// (one section per file) so devtools still shows the original sources.
async function bundle(name, files, prelude = '') {
  let code = prelude, line = prelude.split('\n').length - 1;
  const sections = [];
  for (const f of files) {
    const rel = f.startsWith(root) ? f.slice(root.length + 1) : f;
    const src = f.startsWith('/') ? readFileSync(f, 'utf8') : read(f);
    if (rel.endsWith('.min.js')) {
      code += src.trimEnd() + '\n';
    } else {
      const r = await transform(src, { loader: 'js', minify: true, target: 'es2019', sourcemap: 'external', sourcefile: '/' + rel, legalComments: 'inline' });
      const map = JSON.parse(r.map);
      map.sourcesContent = [src];
      sections.push({ offset: { line, column: 0 }, map });
      code += r.code.trimEnd() + '\n';
    }
    line = code.split('\n').length - 1;
  }
  if (!sections.length) return emit(name, '.js', code);
  const mapFile = emit(name, '.js.map', JSON.stringify({ version: 3, sections }));
  return emit(name, '.js', code + `//# sourceMappingURL=${basename(mapFile)}\n`);
}

const scripts = [
  await bundle('vendor', BUNDLES.vendor),
  await bundle('data', BUNDLES.data, `window.TEX=${JSON.stringify(tex)};\n`),
  await bundle('app', BUNDLES.app),
];

// ─── HTML + CSS ────────────────────────────────────────────────────────────
let html = read('index.html');

const styleRe = /<style>([\s\S]*?)<\/style>/;
const css = (await transform(html.match(styleRe)[1], { loader: 'css', minify: true })).code;
html = html.replace(styleRe, () => `<link rel="stylesheet" href="${emit('app', '.css', css)}">`);

// Replace the whole run of source <script src> tags with the bundles.
const scriptRe = /<script src="[^"]+"><\/script>(?:\s*<script src="[^"]+"><\/script>)*/;
if ((html.match(new RegExp(scriptRe.source, 'g')) || []).length !== 1) throw new Error('expected one contiguous block of <script src> tags in index.html');
html = html.replace(scriptRe, () => scripts.map(s => `<script src="${s}"></script>`).join(''));

for (const icon of ['favicon.ico', 'apple-touch-icon.png', 'assets/icon.svg']) {
  const ext = extname(icon);
  const file = emit(basename(icon, ext), ext, readFileSync(join(root, icon)));
  html = html.replace(`href="${icon}"`, `href="${file}"`);
}
// Browsers also ask for /favicon.ico unprompted.
copyFileSync(join(root, 'favicon.ico'), join(out, 'favicon.ico'));

html = await minifyHtml(html, { collapseWhitespace: true, conservativeCollapse: true, removeComments: true, minifyCSS: true, minifyJS: true });
writeFileSync(join(out, 'index.html'), html);

// Cloudflare static assets: hashed files never change, so cache them for a year. index.html
// keeps the default (revalidate every time), which is what picks up a new release.
writeFileSync(join(out, '_headers'), `/assets/*
  Cache-Control: public, max-age=31536000, immutable
`);

const kb = n => (n / 1024).toFixed(1).padStart(8) + ' KB';
for (const [f, n] of sizes.filter(([f]) => !f.endsWith('.map'))) console.log(kb(n), f);
console.log(kb(Buffer.byteLength(html)), 'index.html');
