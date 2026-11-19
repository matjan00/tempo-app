// to-do calendar mirror: keeps the "Plan" Google calendar in step with the synced day plans.
// A trigger on tempo_records queues a date in tempo_cal_jobs whenever a plan is saved (app replan / missed /
// add to plan, or the planner routine). A 10-second cron job calls this function while a job is due; it rewrites
// that day's own events (never meetings or anything else) to match the plan.
//
// Environment (supabase secrets set ..., written by scripts/setup-calendar.cjs):
//   GOOGLE_SA_JSON     base64 of the Google service account key JSON (the Plan calendar is shared with it)
//   PLAN_CALENDAR_ID   id of the user's "Plan" calendar
//   CRON_SECRET        same secret the cron job sends (shared with tempo-push)
//   PLAN_TZ            optional, default Europe/Warsaw
import { createClient } from 'npm:@supabase/supabase-js@2';
import { wanted, diff, zonedToUtc, eventBody, type Existing, type Plan } from './lib.ts';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const TZ = Deno.env.get('PLAN_TZ') || 'Europe/Warsaw';
const CAL = Deno.env.get('PLAN_CALENDAR_ID') || '';
const API = 'https://www.googleapis.com/calendar/v3';
const MAX_ATTEMPTS = 5;

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });

const sha256 = async (s: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
async function safeEqual(a: string, b: string) {
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

// ---------- Google access token from the service account (JWT bearer grant) ----------
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlStr = (s: string) => b64url(new TextEncoder().encode(s));
let cached: { token: string; until: number } | null = null;
async function accessToken() {
  if (cached && cached.until > Date.now() + 60_000) return cached.token;
  const sa = JSON.parse(atob(Deno.env.get('GOOGLE_SA_JSON') || ''));
  const pem = String(sa.private_key).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64urlStr(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64urlStr(
    JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/calendar.events', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }),
  )}`;
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned)));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${b64url(sig)}` }),
  });
  const out = await res.json();
  if (!res.ok || !out.access_token) throw new Error('google token: ' + (out.error_description || out.error || res.status));
  cached = { token: out.access_token, until: Date.now() + (out.expires_in || 3600) * 1000 };
  return cached.token;
}

async function gcal(method: string, path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204 || (method === 'DELETE' && res.status === 410)) return null; // 410: already gone
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`calendar ${method} ${res.status}: ${out?.error?.message || ''}`);
  return out;
}

// ---------- one day ----------
async function syncDay(date: string) {
  const { data: rec } = await sb.from('tempo_records').select('data,deleted').eq('kind', 'plan').eq('id', 'd' + date.replace(/-/g, '')).maybeSingle();
  const plan: Plan = !rec || rec.deleted || !rec.data ? { date, blocks: [] } : { date, blocks: Array.isArray(rec.data.blocks) ? rec.data.blocks : [] };
  const cal = encodeURIComponent(CAL);
  const qs = new URLSearchParams({
    timeMin: zonedToUtc(date, '00:00', TZ).toISOString(),
    timeMax: zonedToUtc(date, '23:59', TZ).toISOString(),
    singleEvents: 'true',
    maxResults: '250',
    timeZone: TZ,
  });
  const list = await gcal('GET', `/calendars/${cal}/events?${qs}`);
  const have: Existing[] = (list?.items || [])
    .filter((e: any) => e.status !== 'cancelled' && e.start?.dateTime && String(e.start.dateTime).slice(0, 10) === date)
    .map((e: any) => ({
      id: e.id,
      key: e.extendedProperties?.private?.key ?? null,
      // ours: made by this mirror, or by the planner before it existed (description "to-do plan …");
      // recurring events (the 21:00 review reminder) are never ours
      ours: !e.recurringEventId && (e.extendedProperties?.private?.todo === '1' || String(e.description || '').startsWith('to-do plan')),
      summary: e.summary || '',
      start: String(e.start.dateTime).slice(11, 16),
      end: String(e.end?.dateTime || '').slice(11, 16),
      colorId: e.colorId,
    }));
  const { insert, update, remove } = diff(wanted(plan), have);
  for (const id of remove) await gcal('DELETE', `/calendars/${cal}/events/${encodeURIComponent(id)}?sendUpdates=none`);
  for (const { id, w } of update) await gcal('PUT', `/calendars/${cal}/events/${encodeURIComponent(id)}?sendUpdates=none`, eventBody(date, w, TZ));
  for (const w of insert) await gcal('POST', `/calendars/${cal}/events?sendUpdates=none`, eventBody(date, w, TZ));
  return { date, inserted: insert.length, updated: update.length, removed: remove.length };
}

const localToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || !(await safeEqual(req.headers.get('x-cron-secret') ?? '', secret))) return json({ error: 'no' }, 401);
  if (!CAL || !Deno.env.get('GOOGLE_SA_JSON')) return json({ error: 'not set up' }, 503);

  // claim the due jobs (delete first, so an overlapping run never does the same day twice)
  const { data: jobs, error } = await sb.from('tempo_cal_jobs').delete().lte('due_at', new Date().toISOString()).select();
  if (error) return json({ error: 'db' }, 500);
  const yesterday = new Date(Date.parse(localToday() + 'T12:00:00Z') - 864e5).toISOString().slice(0, 10);
  const done = [];
  for (const j of jobs ?? []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(j.date) || j.date < yesterday) continue; // old days stay as they were
    try {
      done.push(await syncDay(j.date));
    } catch (e) {
      console.error('calendar sync failed', j.date, String(e));
      const attempts = Number(j.attempts ?? 0) + 1;
      // try again in a minute, a few times; a newer plan change would re-queue it anyway
      if (attempts < MAX_ATTEMPTS)
        await sb.from('tempo_cal_jobs').upsert({ date: j.date, due_at: new Date(Date.now() + 60_000).toISOString(), attempts }, { onConflict: 'date', ignoreDuplicates: true });
      done.push({ date: j.date, error: String(e).slice(0, 200) });
    }
  }
  return json({ done });
});
