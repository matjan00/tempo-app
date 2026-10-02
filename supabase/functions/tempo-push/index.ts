// Tempo push service: the app schedules "ring at this time", a cron job calls us every 10 s with send-due.
// Deployed with --no-verify-jwt (the app is a public static page); abuse is limited by strict validation below.
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
webpush.setVapidDetails('mailto:mateusz.janczak2000@gmail.com', Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!);

const ALLOWED_ORIGINS = ['https://matjan00.github.io', 'http://localhost:5195'];
const PUSH_HOSTS = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com', 'push.services.mozilla.com'];

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
    const u = new URL(String(e));
    return u.protocol === 'https:' && PUSH_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith('.' + h)) && String(e).length < 1000;
  } catch {
    return false;
  }
};
const clip = (s: unknown, n: number) => String(s ?? '').slice(0, n);

async function sendDue() {
  const { data } = await sb.from('tempo_push_timers').select('*').lte('fire_at', new Date().toISOString()).limit(50);
  let sent = 0;
  for (const r of data ?? []) {
    // claim the row first so two overlapping runs never ring twice
    const { data: claimed } = await sb.from('tempo_push_timers').delete().eq('endpoint', r.endpoint).eq('fire_at', r.fire_at).select();
    if (!claimed?.length) continue;
    try {
      await webpush.sendNotification(
        { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } },
        JSON.stringify({ title: r.title, body: r.body, tag: 'tempo-timer' }),
        { TTL: 300, urgency: 'high' },
      );
      sent++;
    } catch (e) {
      console.log('push failed', (e as { statusCode?: number }).statusCode);
    }
  }
  // housekeeping: forget timers that were never delivered
  await sb.from('tempo_push_timers').delete().lt('fire_at', new Date(Date.now() - 3600_000).toISOString());
  return sent;
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405, origin);
  let b: Record<string, any>;
  try {
    b = await req.json();
  } catch {
    return json({ error: 'bad json' }, 400, origin);
  }

  if (b.action === 'send-due') {
    if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) return json({ error: 'no' }, 401, origin);
    return json({ sent: await sendDue() }, 200, origin);
  }

  const sub = b.sub;
  if (!sub || !validEndpoint(sub.endpoint)) return json({ error: 'bad subscription' }, 400, origin);

  if (b.action === 'cancel') {
    await sb.from('tempo_push_timers').delete().eq('endpoint', sub.endpoint);
    return json({ ok: true }, 200, origin);
  }

  if (b.action === 'schedule') {
    const fireAt = Number(b.fireAt);
    const now = Date.now();
    if (!sub.keys?.p256dh || !sub.keys?.auth) return json({ error: 'bad keys' }, 400, origin);
    if (!(fireAt > now - 5000 && fireAt < now + 3 * 3600_000)) return json({ error: 'bad time' }, 400, origin);
    const { error } = await sb.from('tempo_push_timers').upsert({
      endpoint: sub.endpoint,
      p256dh: clip(sub.keys.p256dh, 200),
      auth: clip(sub.keys.auth, 100),
      fire_at: new Date(fireAt).toISOString(),
      title: clip(b.title, 80) || 'Tempo',
      body: clip(b.body, 160),
    });
    if (error) return json({ error: 'db' }, 500, origin);
    return json({ ok: true }, 200, origin);
  }
  return json({ error: 'unknown action' }, 400, origin);
});
