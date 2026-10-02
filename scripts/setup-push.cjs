// One-time setup of the "ring when locked" server:  node scripts/setup-push.cjs
// Creates fresh secret keys, adds the tempo_push_timers table + 10-second cron job to the fitness-app
// Supabase project, deploys the tempo-push function, and writes docs/js/push-config.js (public values only).
// Secrets are never printed or committed.
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REF = 'txhcnqwrdazgaxjwabln';
const root = path.join(__dirname, '..');
const NODE = process.execPath;
const NPX = path.join(path.dirname(NODE), 'node_modules', 'npm', 'bin', 'npx-cli.js');
const sb = (...args) => execFileSync(NODE, [NPX, '--yes', 'supabase@2.118.0', ...args], { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] });

const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk = privateKey.export({ format: 'jwk' });
const pub = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url');
const priv = jwk.d;
const cron = crypto.randomBytes(24).toString('hex');

console.log('[1/4] Creating table + cron job…');
const sqlFile = path.join(os.tmpdir(), `tempo-push-${Date.now()}.sql`);
fs.writeFileSync(sqlFile, fs.readFileSync(path.join(root, 'supabase', 'push.sql'), 'utf8').replace('__CRON_SECRET__', cron));
try {
  sb('db', 'query', '--linked', '--project-ref', REF, '-f', sqlFile);
} finally {
  fs.rmSync(sqlFile, { force: true });
}

console.log('[2/4] Saving function secrets…');
sb('secrets', 'set', '--project-ref', REF, `VAPID_PUBLIC_KEY=${pub}`, `VAPID_PRIVATE_KEY=${priv}`, `CRON_SECRET=${cron}`);
console.log('[3/4] Deploying function…');
sb('functions', 'deploy', 'tempo-push', '--project-ref', REF, '--no-verify-jwt', '--use-api');

console.log('[4/4] Writing app config…');
fs.writeFileSync(
  path.join(root, 'docs', 'js', 'push-config.js'),
  `// Written by scripts/setup-push.cjs (public values only).\nexport const PUSH_URL = 'https://${REF}.supabase.co/functions/v1/tempo-push';\nexport const VAPID_PUBLIC_KEY = '${pub}';\n`
);
console.log('Done.');
