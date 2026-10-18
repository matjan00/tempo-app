// "Ring when the phone is locked": the server (Supabase) sends a Web Push at the exact end time,
// which wakes the phone even when Tempo is closed.
import { PUSH_URL, VAPID_PUBLIC_KEY } from './push-config.js';
import * as store from './store.js';

export const configured = () => !!(PUSH_URL && VAPID_PUBLIC_KEY);
export const supported = () => configured() && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const enabled = () => supported() && store.get().settings.notify && Notification.permission === 'granted';

const toKey = (b64) => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

async function registration() {
  const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 6000))]);
  if (!reg) throw new Error('the app is still starting up. close and reopen to-do, then try again.');
  return reg;
}

const sameKey = (buf, key) => {
  if (!buf) return false;
  const a = new Uint8Array(buf);
  return a.length === key.length && a.every((v, i) => v === key[i]);
};

// Random per-install secret. The server stores it with the timer and requires it again to cancel/overwrite.
let memToken = null;
function token() {
  try {
    let t = localStorage.getItem('tempo.pushToken');
    if (!t || t.length < 20) {
      t = Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem('tempo.pushToken', t);
    }
    return t;
  } catch {
    return (memToken ||= Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, '0')).join(''));
  }
}

async function subscription(create) {
  const reg = await registration();
  const key = toKey(VAPID_PUBLIC_KEY);
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with a different server key can never receive our pushes: replace it.
  if (sub && !sameKey(sub.options?.applicationServerKey, key)) {
    await sub.unsubscribe().catch(() => {});
    sub = null;
  }
  if (!sub && create) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  return sub;
}

async function call(payload) {
  const res = await fetch(PUSH_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, token: token() }), keepalive: true });
  if (!res.ok) throw new Error('push server answered ' + res.status);
}

// Ask permission + subscribe. Returns { ok: true } or { ok: false, why: 'plain-language reason' }.
export async function enable() {
  if (!supported()) return { ok: false, why: 'this browser cannot receive push alerts. open to-do in chrome.' };
  if (Notification.permission === 'denied') return { ok: false, why: 'notifications are blocked for to-do. allow them: chrome menu → settings → site settings → notifications.' };
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return { ok: false, why: 'notification permission was not granted.' };
    await subscription(true);
    return { ok: true };
  } catch (e) {
    return { ok: false, why: `could not subscribe: ${e?.message || e}` };
  }
}

export async function disable() {
  try {
    const sub = await subscription(false);
    if (sub) {
      await call({ action: 'cancel', sub: sub.toJSON() }).catch(() => {});
      await sub.unsubscribe();
    }
  } catch {}
}

// Return shape (never throws):
//   { ok: true }                        timer registered on the server
//   { ok: true, skipped: true }         push is off/unsupported, nothing to do
//   { ok: false, error: 'message' }     failed; `error` is plain text safe to show in a toast
// Always an object, so `if (!(await schedule(...)).ok)` and `await schedule(...)` both work.
export async function schedule(fireAt, title, body) {
  if (!enabled()) return { ok: true, skipped: true };
  try {
    const sub = await subscription(true);
    await call({ action: 'schedule', sub: sub.toJSON(), fireAt, title, body });
    return { ok: true };
  } catch (e) {
    console.warn('Could not schedule the locked-phone alarm', e);
    return { ok: false, error: String(e?.message || e) };
  }
}

// Same return shape as schedule().
export async function cancel() {
  if (!enabled()) return { ok: true, skipped: true };
  try {
    const sub = await subscription(false);
    if (sub) await call({ action: 'cancel', sub: sub.toJSON() });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

// The service worker tells us when the browser rotated the subscription. The next schedule() picks up
// the fresh one automatically; this just makes sure one exists.
try {
  navigator.serviceWorker?.addEventListener('message', (ev) => {
    if (ev.data?.type === 'push-subscription-changed' && enabled()) subscription(true).catch(() => {});
  });
} catch {}
