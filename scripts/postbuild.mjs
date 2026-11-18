import fs from 'node:fs';

const dist = 'dist';
const html = fs.readFileSync(`${dist}/index.html`, 'utf8');
const urls = new Set(['./', './index.html', './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png']);
for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const raw = m[1];
  if (!raw || raw.startsWith('data:') || raw.startsWith('http')) continue;
  if (raw.startsWith('#')) continue;
  urls.add(raw.startsWith('./') ? raw : `./${raw.replace(/^\//, '')}`);
}
// Los chunks dinámicos (modo 3D) no aparecen en index.html: se añaden todos.
const assets = `${dist}/assets`;
if (fs.existsSync(assets)) {
  for (const f of fs.readdirSync(assets)) {
    if (/\.(js|css|wasm|woff2?)$/.test(f)) urls.add(`./assets/${f}`);
  }
}
const body = `/* Generado en build por scripts/postbuild.mjs */\nself.__MARBLELOUS_PRECACHE = ${JSON.stringify([...urls], null, 2)};\n`;
fs.writeFileSync(`${dist}/precache-manifest.js`, body);
console.log(`precache-manifest.js: ${urls.size} recursos`);
