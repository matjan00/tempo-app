// Setup of the "ring when locked" server:  node scripts/setup-push.cjs [--rotate] [--subject=mailto:you@example.com]
// Adds the tempo_push_timers table + 10-second cron job to the Supabase project, stores secrets,
// deploys the tempo-push function, and writes docs/js/push-config.js (public values only).
//
// Safe to re-run: if VAPID keys already exist on the project they are kept (rotating them would
// silently break every phone's existing subscription). Pass --rotate to generate new keys on purpose.
// The cron secret is refreshed on every run. Secrets are never printed or committed.
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REF = 'txhcnqwrdazgaxjwabln';
const root = path.join(__dirname, '..');
const configFile = path.join(root, 'docs', 'js', 'push-config.js');
const args = process.argv.slice(2);
const rotate = args.includes('--rotate');
const subject = (args.find((a) => a.startsWith('--subject=')) || '').slice(10) || process.env.VAPID_SUBJECT || '';
if (subject && !/^(mailto:[^\s"'`$&|;<>]+|https:\/\/[^\s"'`$&|;<>]+)$/.test(subject)) die('--subject must look like mailto:you@example.com or https://example.com');

function die(msg) {
  console.error('setup-push: ' + msg);
  process.exit(1);
}

// Run the Supabase CLI through npx. Prefer the npx that ships next to this node; else whatever `npx` is on PATH.
function npxCommand() {
  const nodeDir = path.dirname(process.execPath);
  for (const p of [
    path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npx-cli.js'), // Windows installer layout
    path.join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js'), // macOS / Linux layout
  ]) {
    if (fs.existsSync(p)) return { cmd: process.execPath, pre: [p], shell: false };
  }
  return { cmd: 'npx', pre: [], shell: process.platform === 'win32' }; // npx.cmd needs a shell on Windows
}
const NPX = npxCommand();
function sb(args, capture) {
  try {
    return execFileSync(NPX.cmd, [...NPX.pre, '--yes', 'supabase@2.118.0', ...args], {
      cwd: root,
      shell: NPX.shell,
      encoding: 'utf8',
      stdio: capture ? ['ignore', 'pipe', 'inherit'] : ['ignore', 'inherit', 'inherit'],
    });
  } catch (e) {
    if (e.code === 'ENOENT') die('could not run npx. Install Node.js (with npm) and make sure `npx` works in a terminal.');
    die(`"supabase ${args[0]} ${args[1] || ''}" failed. Are you logged in (npx supabase login) and linked to project ${REF}? Details are printed above.`);
  }
}

// Do the project's VAPID keys already exist?
let haveKeys = false;
console.log('[0/4] Checking existing secrets…');
{
  const out = sb(['secrets', 'list', '--project-ref', REF], true);
  haveKeys = /\bVAPID_PUBLIC_KEY\b/.test(out) && /\bVAPID_PRIVATE_KEY\b/.test(out);
}

let pub;
let priv = null;
if (haveKeys && !rotate) {
  const m = fs.existsSync(configFile) && fs.readFileSync(configFile, 'utf8').match(/VAPID_PUBLIC_KEY = '([\w-]{80,100})'/);
  if (!m) die('VAPID keys already exist on the project, but docs/js/push-config.js has no public key to match them. Restore that file from git, or run with --rotate to create new keys (every phone must then re-enable alerts).');
  pub = m[1];
  console.log('      keeping the existing VAPID keys (use --rotate to replace them)');
} else {
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = privateKey.export({ format: 'jwk' });
  pub = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url');
  priv = jwk.d;
  if (haveKeys) console.log('      --rotate: generating new VAPID keys; existing phone subscriptions will stop working until alerts are re-enabled');
}
const cron = crypto.randomBytes(24).toString('hex');

console.log('[1/4] Creating table + cron job…');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tempo-push-'));
const sqlFile = path.join(dir, 'push.sql');
try {
  const sql = fs.readFileSync(path.join(root, 'supabase', 'push.sql'), 'utf8').split('__CRON_SECRET__').join(cron);
  fs.writeFileSync(sqlFile, sql, { mode: 0o600 });
  sb(['db', 'query', '--linked', '--project-ref', REF, '-f', sqlFile]);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('[2/4] Saving function secrets…');
const secrets = [`CRON_SECRET=${cron}`];
if (priv) secrets.push(`VAPID_PUBLIC_KEY=${pub}`, `VAPID_PRIVATE_KEY=${priv}`);
if (subject) secrets.push(`VAPID_SUBJECT=${subject}`);
else console.log('      note: no --subject given; set one later with: npx supabase secrets set VAPID_SUBJECT=mailto:you@example.com');
sb(['secrets', 'set', '--project-ref', REF, ...secrets]);

console.log('[3/4] Deploying function…');
sb(['functions', 'deploy', 'tempo-push', '--project-ref', REF, '--no-verify-jwt', '--use-api']);

console.log('[4/4] Writing app config…');
fs.writeFileSync(
  configFile,
  `// Written by scripts/setup-push.cjs (public values only).\nexport const PUSH_URL = 'https://${REF}.supabase.co/functions/v1/tempo-push';\nexport const VAPID_PUBLIC_KEY = '${pub}';\n`
);
console.log('Done.');
