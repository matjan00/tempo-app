// Run before every publish: node scripts/release.cjs
// Rebuilds the offline file list in sw.js and bumps the cache version so phones pick up changes.
const fs = require('fs');
const path = require('path');
const docs = path.join(__dirname, '..', 'docs');
const list = [];
(function walk(dir) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p);
    else if (f.name !== 'sw.js') list.push(path.relative(docs, p).split(path.sep).join('/'));
  }
})(docs);
const files = ['./', ...list];
let sw = fs.readFileSync(path.join(docs, 'sw.js'), 'utf8');
const m = sw.match(/const VERSION = 'tempo-v(\d+)'/);
const next = Number(m[1]) + 1;
sw = sw.replace(/const VERSION = 'tempo-v\d+'/, `const VERSION = 'tempo-v${next}'`);
sw = sw.replace(/\/\/ FILES-START[\s\S]*\/\/ FILES-END/, `// FILES-START\nconst FILES = ${JSON.stringify(files)};\n// FILES-END`);
fs.writeFileSync(path.join(docs, 'sw.js'), sw);
const v = fs.readFileSync(path.join(docs, 'js', 'version.js'), 'utf8').replace(/'(\d+)\.(\d+)\.(\d+)'/, (_, a, b, c) => `'${a}.${b}.${Number(c) + 1}'`);
fs.writeFileSync(path.join(docs, 'js', 'version.js'), v);
console.log(`sw.js → tempo-v${next}, ${files.length} files cached`);
