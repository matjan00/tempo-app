// Read and write the synced to-do data from a script (used by Claude's day planner).
// Needs SYNC_KEY (and optionally SYNC_URL) in the environment or in .env at the repo root.
//
//   node scripts/sync.cjs pull [kind]          live records as JSON: [{ kind, id, data, mt, seq }]
//                                               kind: task | habit | page | session | settings | plan
//   node scripts/sync.cjs put <kind> <id> <file|->   write one record (the file holds its data as JSON)
//   node scripts/sync.cjs put-many <file|->    write many: [{ kind, id, data } | { kind, id, deleted: true }]
//   node scripts/sync.cjs delete <kind> <id>   delete one record
//
// Writes are stamped with the current time, so they win over older edits on the phone and lose to newer ones.
const fs = require('fs');
const path = require('path');

const REF = 'txhcnqwrdazgaxjwabln';
const envFile = path.join(__dirname, '..', '.env');
const fileEnv = {};
if (fs.existsSync(envFile))
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) fileEnv[m[1]] = m[2];
  }
const KEY = process.env.SYNC_KEY || fileEnv.SYNC_KEY;
const URL_ = process.env.SYNC_URL || fileEnv.SYNC_URL || `https://${REF}.supabase.co/functions/v1/tempo-sync`;
const KINDS = ['task', 'habit', 'page', 'session', 'settings', 'plan'];

class Stop extends Error {}
function die(msg) {
  throw new Stop(msg); // no process.exit() mid-fetch: it crashes Node on Windows
}

async function call(body) {
  const res = await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-sync-key': KEY }, body: JSON.stringify(body) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) die(`server answered ${res.status}: ${out.error || 'unknown error'}`);
  return out;
}

async function pullAll() {
  const latest = new Map();
  let since = 0;
  for (;;) {
    const r = await call({ action: 'pull', since });
    for (const x of r.records) latest.set(`${x.kind}:${x.id}`, x);
    if (r.records.length) since = r.records[r.records.length - 1].seq;
    if (!r.more) break;
  }
  return [...latest.values()].filter((x) => !x.deleted);
}

const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f === '-' ? 0 : f, 'utf8'));
  } catch (e) {
    die(`could not read JSON from ${f}: ${e.message}`);
  }
};

async function push(records) {
  const now = Date.now();
  const all = { accepted: [], rejected: [] };
  for (let i = 0; i < records.length; i += 200) {
    const r = await call({ action: 'push', records: records.slice(i, i + 200).map((x) => ({ ...x, mt: now, base: 0 })) });
    all.accepted.push(...r.accepted);
    all.rejected.push(...r.rejected);
  }
  console.log(JSON.stringify({ accepted: all.accepted.length, rejected: all.rejected.map((x) => `${x.kind}:${x.id}`) }));
}

const checkKind = (k) => KINDS.includes(k) || die(`kind must be one of ${KINDS.join(', ')}`);

(async () => {
  if (!KEY) die('no SYNC_KEY. Run node scripts/setup-sync.cjs, or set SYNC_KEY in the environment.');
  const [cmd, a, b, c] = process.argv.slice(2);
  if (cmd === 'pull') {
    if (a) checkKind(a);
    const recs = (await pullAll()).filter((x) => !a || x.kind === a);
    console.log(JSON.stringify(recs.map(({ kind, id, data, mt, seq }) => ({ kind, id, data, mt, seq })), null, 2));
  } else if (cmd === 'put') {
    checkKind(a);
    if (!b || !c) die('usage: put <kind> <id> <file|->');
    await push([{ kind: a, id: b, data: readJson(c) }]);
  } else if (cmd === 'put-many') {
    const list = readJson(a || '-');
    if (!Array.isArray(list)) die('put-many expects a JSON array');
    list.forEach((x) => checkKind(x.kind));
    await push(list.map((x) => (x.deleted ? { kind: x.kind, id: x.id, deleted: true } : { kind: x.kind, id: x.id, data: x.data })));
  } else if (cmd === 'delete') {
    checkKind(a);
    if (!b) die('usage: delete <kind> <id>');
    await push([{ kind: a, id: b, deleted: true }]);
  } else die('usage: pull [kind] | put <kind> <id> <file|-> | put-many <file|-> | delete <kind> <id>');
})().catch((e) => {
  console.error('sync: ' + e.message);
  process.exitCode = 1;
});
