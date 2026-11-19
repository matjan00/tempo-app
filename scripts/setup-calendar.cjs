// Setup of the Plan-calendar mirror:
//   node scripts/setup-calendar.cjs --key <service-account.json> --calendar <Plan calendar id>
// Stores the service account key and calendar id as function secrets (never printed or committed), adds the
// job queue + trigger + cron job (supabase/calendar.sql), turns off the push server's own start alerts
// (CAL_SYNC=1, the calendar announces every start now) and deploys tempo-cal and tempo-push.
// Before running: share the Plan calendar with the service account's email ("Make changes to events").
// Safe to re-run. Undo: npx supabase secrets unset CAL_SYNC (start alerts come back from the push server).
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REF = 'txhcnqwrdazgaxjwabln';
const root = path.join(__dirname, '..');
const arg = (k) => {
  const i = process.argv.indexOf('--' + k);
  return i >= 0 ? process.argv[i + 1] : '';
};
function die(msg) {
  console.error('setup-calendar: ' + msg);
  process.exit(1);
}

const keyFile = arg('key');
const calendar = arg('calendar');
if (!keyFile || !calendar) die('usage: node scripts/setup-calendar.cjs --key <service-account.json> --calendar <Plan calendar id>');
let sa;
try {
  sa = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
} catch (e) {
  die(`could not read ${keyFile}: ${e.message}`);
}
if (sa.type !== 'service_account' || !sa.client_email || !sa.private_key) die('that file is not a Google service account key (JSON)');
if (!/^[\w.@-]+$/.test(calendar)) die('the calendar id looks wrong (expected something like abc123@group.calendar.google.com)');

function npxCommand() {
  const nodeDir = path.dirname(process.execPath);
  for (const p of [path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npx-cli.js'), path.join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js')])
    if (fs.existsSync(p)) return { cmd: process.execPath, pre: [p], shell: false };
  return { cmd: 'npx', pre: [], shell: process.platform === 'win32' };
}
const NPX = npxCommand();
function sb(args) {
  try {
    execFileSync(NPX.cmd, [...NPX.pre, '--yes', 'supabase@2.118.0', ...args], { cwd: root, shell: NPX.shell, stdio: ['ignore', 'inherit', 'inherit'] });
  } catch (e) {
    die(`"supabase ${args[0]} ${args[1] || ''}" failed. Are you logged in (npx supabase login)? Details are printed above.`);
  }
}

console.log(`Service account: ${sa.client_email}`);
console.log('[1/4] Saving secrets…');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tempo-cal-'));
const envFile = path.join(dir, 'secrets.env');
try {
  fs.writeFileSync(envFile, `GOOGLE_SA_JSON=${Buffer.from(JSON.stringify(sa)).toString('base64')}\nPLAN_CALENDAR_ID=${calendar}\nCAL_SYNC=1\n`, { mode: 0o600 });
  sb(['secrets', 'set', '--project-ref', REF, '--env-file', envFile]);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log('[2/4] Creating job queue, trigger and cron job…');
sb(['db', 'query', '--linked', '--project-ref', REF, '-f', path.join(root, 'supabase', 'calendar.sql')]);
console.log('[3/4] Deploying tempo-cal…');
sb(['functions', 'deploy', 'tempo-cal', '--project-ref', REF, '--no-verify-jwt', '--use-api']);
console.log('[4/4] Deploying tempo-push (start alerts now come from the calendar)…');
sb(['functions', 'deploy', 'tempo-push', '--project-ref', REF, '--no-verify-jwt', '--use-api']);
console.log(`Done. Make sure the Plan calendar is shared with ${sa.client_email} ("Make changes to events").`);
