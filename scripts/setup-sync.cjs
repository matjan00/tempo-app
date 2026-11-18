// Setup of task sync:  node scripts/setup-sync.cjs [--rotate]
// Adds the tempo_records table to the Supabase project, stores the sync key's hash as a function secret,
// deploys the tempo-sync function and saves the key to .env (gitignored) for scripts/sync.cjs.
// Prints the key once so you can paste it into the app (Settings → Sync).
//
// Safe to re-run: the key in .env is kept unless you pass --rotate (then every device must reconnect).
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const REF = 'txhcnqwrdazgaxjwabln';
const root = path.join(__dirname, '..');
const envFile = path.join(root, '.env');
const rotate = process.argv.includes('--rotate');

function die(msg) {
  console.error('setup-sync: ' + msg);
  process.exit(1);
}

function npxCommand() {
  const nodeDir = path.dirname(process.execPath);
  for (const p of [
    path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npx-cli.js'),
    path.join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js'),
  ]) {
    if (fs.existsSync(p)) return { cmd: process.execPath, pre: [p], shell: false };
  }
  return { cmd: 'npx', pre: [], shell: process.platform === 'win32' };
}
const NPX = npxCommand();
function sb(args) {
  try {
    execFileSync(NPX.cmd, [...NPX.pre, '--yes', 'supabase@2.118.0', ...args], { cwd: root, shell: NPX.shell, stdio: ['ignore', 'inherit', 'inherit'] });
  } catch (e) {
    if (e.code === 'ENOENT') die('could not run npx. Install Node.js (with npm).');
    die(`"supabase ${args[0]} ${args[1] || ''}" failed. Are you logged in (npx supabase login)? Details are printed above.`);
  }
}

// .env as a map, keeping other lines
const readEnv = () => {
  const out = {};
  if (fs.existsSync(envFile))
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m) out[m[1]] = m[2];
    }
  return out;
};
const env = readEnv();

// 24 characters from an alphabet without look-alikes (no 0/o, 1/l/i): about 119 bits.
const ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789';
const norm = (k) => String(k).toLowerCase().replace(/[\s-]/g, '');
let key = env.SYNC_KEY && norm(env.SYNC_KEY);
if (!key || key.length < 20 || rotate) {
  key = Array.from({ length: 24 }, () => ALPHA[crypto.randomInt(ALPHA.length)]).join('');
  console.log(rotate ? '--rotate: new sync key (every device must reconnect)' : 'Generated a new sync key');
} else console.log('Keeping the sync key from .env (use --rotate to replace it)');
const hash = crypto.createHash('sha256').update(key).digest('hex');

console.log('[1/3] Creating table…');
sb(['db', 'query', '--linked', '--project-ref', REF, '-f', path.join(root, 'supabase', 'sync.sql')]);

console.log('[2/3] Saving function secret…');
sb(['secrets', 'set', '--project-ref', REF, `SYNC_KEY_HASH=${hash}`]);

console.log('[3/3] Deploying function…');
sb(['functions', 'deploy', 'tempo-sync', '--project-ref', REF, '--no-verify-jwt', '--use-api']);

env.SYNC_KEY = key;
env.SYNC_URL = `https://${REF}.supabase.co/functions/v1/tempo-sync`;
fs.writeFileSync(envFile, Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 });

const shown = key.match(/.{1,4}/g).join('-');
console.log(`\nDone. Sync key (also saved in .env, never commit it):\n\n    ${shown}\n\nOn your phone: to-do → Settings → Sync → paste the key → Connect.`);
