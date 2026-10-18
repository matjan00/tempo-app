// to-do push service: the app schedules "ring at this time", a cron job calls us every 10 s with send-due.
// Deployed with --no-verify-jwt (the app is a public static page); abuse is limited by the checks below:
// browser calls must come from an allowed Origin, carry a per-install token, and use valid push keys/endpoints.
//
// Environment (supabase secrets set ...):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY   required
//   CRON_SECRET                           required for send-due
//   VAPID_SUBJECT                         recommended: mailto:you@example.com or an https:// URL.
//                                         Falls back to mailto:admin@example.invalid (some push services may reject it).
//   ALLOW_LOCAL=1                         optional: also accept http://localhost:5195 (development only)
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const subject = Deno.env.get('VAPID_SUBJECT');
if (!subject) console.warn('VAPID_SUBJECT is not set; using a placeholder contact address');
webpush.setVapidDetails(subject || 'mailto:admin@example.invalid', Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!);

const ALLOWED_ORIGINS = ['https://matjan00.github.io', ...(Deno.env.get('ALLOW_LOCAL') === '1' ? ['http://localhost:5195'] : [])];
const PUSH_HOSTS = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'push.services.mozilla.com', 'web.push.apple.com', 'notify.windows.com'];
const MAX_ROWS = 5000;
const MAX_ATTEMPTS = 3;
const TABLE = 'tempo_push_timers';

const cors = (origin: string | null) => ({
  'Access-Control-Allow-Origin': origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
});

const json = (o: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors(origin), 'Content-Type': 'application/json' } });

const validEndpoint = (e: unknown) => {
  try {
    const s = String(e);
    const u = new URL(s);
    return u.protocol === 'https:' && s.length < 1000 && PUSH_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith('.' + h));
  } catch {
    return false;
  }
};
const clip = (s: unknown, n: number) => String(s ?? '').slice(0, n);

// base64url -> bytes, or null when it is not valid base64url
const b64urlBytes = (s: unknown): Uint8Array | null => {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]+={0,2}$/.test(s)) return null;
  try {
    const t = s.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
};

const sha256Hex = async (s: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, '0')).join('');

// Constant-time string compare (hashes first so lengths do not leak).
async function safeEqual(a: string, b: string) {
  const [x, y] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return d === 0;
}

async function sendDue() {
  const nowIso = new Date().toISOString();
  const { data, error } = await sb.from(TABLE).select('*').lte('fire_at', nowIso).order('fire_at', { ascending: true }).limit(50);
  if (error) {
    console.error('select failed', error.message);
    return { sent: 0, error: 'db' };
  }
  const results = await Promise.allSettled(
    (data ?? []).map(async (r) => {
      // claim the row first so two overlapping runs never ring twice
      const { data: claimed, error: delErr } = await sb.from(TABLE).delete().eq('endpoint', r.endpoint).eq('fire_at', r.fire_at).select();
      if (delErr || !claimed?.length) return false;
      try {
        await webpush.sendNotification(
          { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } },
          JSON.stringify({ title: r.title, body: r.body, tag: 'tempo-timer' }),
          { TTL: 300, urgency: 'high' },
        );
        return true;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode ?? 0;
        console.log('push failed', code);
        // 404/410 = subscription is gone: drop it. 429/5xx/network = try again shortly, a few times.
        const retryable = code === 429 || code >= 500 || code === 0;
        const attempts = Number(r.attempts ?? 0) + 1;
        if (retryable && attempts < MAX_ATTEMPTS) {
          // ignoreDuplicates: never overwrite a newer timer the app scheduled in the meantime
          await sb.from(TABLE).upsert(
            { ...r, attempts, fire_at: new Date(Date.now() + 5000 * 2 ** (attempts - 1)).toISOString() },
            { onConflict: 'endpoint', ignoreDuplicates: true },
          );
        }
        return false;
      }
    }),
  );
  // housekeeping: forget timers that were never delivered
  await sb.from(TABLE).delete().lt('fire_at', new Date(Date.now() - 3600_000).toISOString());
  return { sent: results.filter((x) => x.status === 'fulfilled' && x.value === true).length };
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405, origin);
  if (Number(req.headers.get('content-length') ?? 0) > 8192) return json({ error: 'too big' }, 413, origin);
  let b: Record<string, any>;
  try {
    b = await req.json();
  } catch {
    return json({ error: 'bad json' }, 400, origin);
  }
  if (!b || typeof b !== 'object') return json({ error: 'bad json' }, 400, origin);

  // cron call: secret header, no Origin involved
  if (b.action === 'send-due') {
    const secret = Deno.env.get('CRON_SECRET');
    if (!secret || !(await safeEqual(req.headers.get('x-cron-secret') ?? '', secret))) return json({ error: 'no' }, 401, origin);
    return json(await sendDue(), 200, origin);
  }

  // browser calls: must come from the app's own origin
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) return json({ error: 'origin not allowed' }, 403, origin);

  const sub = b.sub;
  if (!sub || !validEndpoint(sub.endpoint)) return json({ error: 'bad subscription' }, 400, origin);
  if (typeof b.token !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(b.token)) return json({ error: 'bad token' }, 400, origin);
  const tokenHash = await sha256Hex(b.token);

  const { data: existing, error: selErr } = await sb.from(TABLE).select('token').eq('endpoint', sub.endpoint).maybeSingle();
  if (selErr) return json({ error: 'db' }, 500, origin);
  // a row with a different owner token cannot be cancelled or overwritten (legacy rows without a token are open)
  if (existing && existing.token && existing.token !== tokenHash) return json({ error: 'not yours' }, 403, origin);

  if (b.action === 'cancel') {
    const { error } = await sb.from(TABLE).delete().eq('endpoint', sub.endpoint);
    if (error) return json({ error: 'db' }, 500, origin);
    return json({ ok: true }, 200, origin);
  }

  if (b.action === 'schedule') {
    const fireAt = Number(b.fireAt);
    const now = Date.now();
    const p256 = b64urlBytes(sub.keys?.p256dh);
    const auth = b64urlBytes(sub.keys?.auth);
    if (!p256 || p256.length !== 65 || !auth || auth.length !== 16) return json({ error: 'bad keys' }, 400, origin);
    if (!(fireAt > now - 5000 && fireAt < now + 3 * 3600_000)) return json({ error: 'bad time' }, 400, origin);
    if (!existing) {
      const { count, error: cErr } = await sb.from(TABLE).select('endpoint', { count: 'exact', head: true });
      if (cErr) return json({ error: 'db' }, 500, origin);
      if ((count ?? 0) >= MAX_ROWS) return json({ error: 'busy' }, 503, origin);
    }
    const { error } = await sb.from(TABLE).upsert(
      {
        endpoint: sub.endpoint,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        fire_at: new Date(fireAt).toISOString(),
        title: clip(b.title, 80) || 'to-do',
        body: clip(b.body, 160),
        token: tokenHash,
        attempts: 0,
      },
      { onConflict: 'endpoint' },
    );
    if (error) return json({ error: 'db' }, 500, origin);
    return json({ ok: true }, 200, origin);
  }
  return json({ error: 'unknown action' }, 400, origin);
});
