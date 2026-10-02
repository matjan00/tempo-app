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

async function subscription(create) {
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub && create) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(VAPID_PUBLIC_KEY) });
  return sub;
}

async function call(payload) {
  const res = await fetch(PUSH_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), keepalive: true });
  if (!res.ok) throw new Error('push ' + res.status);
}

// Ask permission + subscribe. Returns true when the phone is ready to be woken.
export async function enable() {
  if (!supported()) return false;
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return false;
    return !!(await subscription(true));
  } catch {
    return false;
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

export async function schedule(fireAt, title, body) {
  if (!enabled()) return;
  try {
    const sub = await subscription(true);
    await call({ action: 'schedule', sub: sub.toJSON(), fireAt, title, body });
  } catch (e) {
    console.warn('Could not schedule the locked-phone alarm', e);
  }
}

export async function cancel() {
  if (!enabled()) return;
  try {
    const sub = await subscription(false);
    if (sub) await call({ action: 'cancel', sub: sub.toJSON() });
  } catch {}
}
