// to-do sync service: the app (and Claude's planner, through scripts/sync.cjs) pulls and pushes records.
// Deployed with --no-verify-jwt (the app is a public static page). Every call must carry the sync key in
// the x-sync-key header; only its SHA-256 is stored (SYNC_KEY_HASH). Browser calls must also come from an
// allowed Origin. Calls without an Origin (scripts) only need the key.
//
// Environment (supabase secrets set ...):
//   SYNC_KEY_HASH     required: sha-256 hex of the normalised sync key (written by scripts/setup-sync.cjs)
//   ALLOW_LOCAL=1     optional: also accept http://localhost:5195 (development only)
import { createClient } from 'npm:@supabase/supabase-js@2';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const ALLOWED_ORIGINS = ['https://matjan00.github.io', ...(Deno.env.get('ALLOW_LOCAL') === '1' ? ['http://localhost:5195'] : [])];
const TABLE = 'tempo_records';
const KINDS = ['task', 'habit', 'page', 'session', 'settings', 'plan'];
const ID = /^[\w-]{1,64}$/;
const MAX_BODY = 4 * 1024 * 1024;
const MAX_RECORD = 256 * 1024;
const MAX_BATCH = 500;
const PAGE = 1000;

const cors = (origin: string | null) => ({
  'Access-Control-Allow-Origin': origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
  'Access-Control-Allow-Headers': 'content-type, x-sync-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
});
const json = (o: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors(origin), 'Content-Type': 'application/json' } });

const sha256Hex = async (s: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, '0')).join('');

// Constant-time compare of two hex strings of equal length.
function sameHex(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
// Same normalisation as the app and the scripts: lowercase, no spaces or dashes.
const normKey = (k: string) => k.toLowerCase().replace(/[\s-]/g, '');

async function pull(since: number) {
  const { data, error } = await sb
    .from(TABLE)
    .select('kind,id,data,deleted,mt,seq')
    .gt('seq', since)
    .order('seq', { ascending: true })
    .limit(PAGE);
  if (error) throw new Error('db: ' + error.message);
  return { records: data ?? [], more: (data ?? []).length === PAGE };
}

function cleanRecords(x: unknown) {
  if (!Array.isArray(x) || x.length > MAX_BATCH) return null;
  const out = [];
  for (const r of x) {
    if (!r || typeof r !== 'object') return null;
    const { kind, id, data, deleted, mt, base } = r as Record<string, unknown>;
    if (!KINDS.includes(String(kind)) || !ID.test(String(id))) return null;
    const del = deleted === true;
    if (!del && (!data || typeof data !== 'object' || Array.isArray(data))) return null;
    if (!del && JSON.stringify(data).length > MAX_RECORD) return null;
    out.push({
      kind: String(kind),
      id: String(id),
      deleted: del,
      data: del ? null : data,
      mt: Number.isFinite(Number(mt)) ? Math.round(Number(mt)) : Date.now(),
      base: Number.isFinite(Number(base)) ? Math.max(0, Math.round(Number(base))) : 0,
    });
  }
  return out;
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405, origin);
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return json({ error: 'origin not allowed' }, 403, origin);
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY) return json({ error: 'too big' }, 413, origin);

  const want = (Deno.env.get('SYNC_KEY_HASH') ?? '').toLowerCase();
  const key = normKey(req.headers.get('x-sync-key') ?? '');
  if (!want || key.length < 20 || !sameHex(await sha256Hex(key), want)) return json({ error: 'wrong sync key' }, 401, origin);

  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return json({ error: 'bad json' }, 400, origin);
  }
  if (!b || typeof b !== 'object') return json({ error: 'bad json' }, 400, origin);

  try {
    if (b.action === 'pull') {
      const since = Math.max(0, Math.round(Number(b.since) || 0));
      return json(await pull(since), 200, origin);
    }
    if (b.action === 'push') {
      const recs = cleanRecords(b.records);
      if (!recs) return json({ error: 'bad records' }, 400, origin);
      if (!recs.length) return json({ accepted: [], rejected: [] }, 200, origin);
      const { data, error } = await sb.rpc('tempo_sync_write', { recs });
      if (error) throw new Error('db: ' + error.message);
      return json(data, 200, origin);
    }
    return json({ error: 'unknown action' }, 400, origin);
  } catch (e) {
    console.error(e);
    return json({ error: 'server error' }, 500, origin);
  }
});
