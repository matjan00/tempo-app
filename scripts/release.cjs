// Run before every publish: node scripts/release.cjs
// Rebuilds the offline file list in docs/sw.js and bumps the cache version so phones pick up changes.
//   node scripts/release.cjs           bump only if the file list or any file's content changed since the last release
//   node scripts/release.cjs --force   bump even if nothing changed
//   node scripts/release.cjs --check   change nothing; exit 1 if sw.js is stale (use in CI / before publishing)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const docs = path.join(__dirname, '..', 'docs');
const swPath = path.join(docs, 'sw.js');
const verPath = path.join(docs, 'js', 'version.js');
const EXT = new Set(['.html', '.css', '.js', '.webmanifest', '.png', '.svg', '.ico', '.json']);
const SKIP = new Set(['sw.js', 'Thumbs.db', 'desktop.ini']);
const args = process.argv.slice(2);
const check = args.includes('--check');
const force = args.includes('--force');
const fail = (msg) => { console.error('release: ' + msg); process.exit(1); };

const list = [];
(function walk(dir) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    if (f.name.startsWith('.') || SKIP.has(f.name) || f.name.endsWith('.map')) continue;
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p);
    else if (EXT.has(path.extname(f.name).toLowerCase())) list.push(path.relative(docs, p).split(path.sep).join('/'));
  }
})(docs);
list.sort();
const files = ['./', ...list];

// Hash of every cached file's content. sw.js itself and version.js (which this script rewrites) are left out.
const h = crypto.createHash('sha256');
for (const f of list) {
  if (f === 'js/version.js') continue;
  h.update(f + '\0');
  h.update(fs.readFileSync(path.join(docs, f)));
  h.update('\0');
}
const hash = h.digest('hex').slice(0, 12);

const sw = fs.readFileSync(swPath, 'utf8');
const vm = sw.match(/const VERSION = 'tempo-v(\d+)'/);
if (!vm) fail("could not find \"const VERSION = 'tempo-vN'\" in docs/sw.js");
if (!/\/\/ FILES-START[\s\S]*\/\/ FILES-END/.test(sw)) fail('could not find the FILES-START / FILES-END markers in docs/sw.js');
const cur = sw.match(/\/\/ FILES-START\n(?:\/\/ HASH: (\w+)\n)?const FILES = (\[.*\]);/);
const stale = !cur || cur[1] !== hash || cur[2] !== JSON.stringify(files);

if (check) {
  if (stale) fail('docs/sw.js is stale (files changed since the last release). Run: node scripts/release.cjs');
  console.log(`release: sw.js is up to date (tempo-v${vm[1]}, ${files.length} files, ${hash})`);
  process.exit(0);
}
if (!stale && !force) {
  console.log(`release: nothing changed since tempo-v${vm[1]}; not bumping (use --force to bump anyway)`);
  process.exit(0);
}

const verSrc = fs.readFileSync(verPath, 'utf8');
if (!/'(\d+)\.(\d+)\.(\d+)'/.test(verSrc)) fail("could not find a 'x.y.z' version in docs/js/version.js");

// compute everything first, then write
const next = Number(vm[1]) + 1;
const newSw = sw
  .replace(/const VERSION = 'tempo-v\d+'/, `const VERSION = 'tempo-v${next}'`)
  .replace(/\/\/ FILES-START[\s\S]*\/\/ FILES-END/, () => `// FILES-START\n// HASH: ${hash}\nconst FILES = ${JSON.stringify(files)};\n// FILES-END`);
const newVer = verSrc.replace(/'(\d+)\.(\d+)\.(\d+)'/, (_, a, b, c) => `'${a}.${b}.${Number(c) + 1}'`);

const writeAtomic = (p, data) => { const t = p + '.tmp'; fs.writeFileSync(t, data); fs.renameSync(t, p); };
writeAtomic(verPath, newVer);
writeAtomic(swPath, newSw);
console.log(`sw.js → tempo-v${next}, ${files.length} files cached (${hash})`);
