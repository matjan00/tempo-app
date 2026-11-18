// Sync with your own Supabase (tempo-sync function), so the day planner can read and write your tasks.
// Off until a sync key is entered in Settings. The phone stays the working copy: everything still works
// offline, and changes go up / come down whenever there is a connection.
//
// How it works: every task, habit, note page, focus session, settings and day plan is one record.
// For each record we remember the server's version number (seq) and a hash of what we last synced.
// A record whose hash differs is a local change; it gets stamped with the time it was noticed (mt).
// Sync = pull everything newer than our cursor, then push local changes. When both sides changed
// the same record, the newer edit (by mt) wins.
import * as store from './store.js';
import { PUSH_URL } from './push-config.js';

export const SYNC_URL = PUSH_URL ? PUSH_URL.replace(/tempo-push$/, 'tempo-sync') : '';
const META = 'tempo.sync';
// collection in the saved state -> record kind on the server
const COLS = [
  ['task', 'tasks'],
  ['habit', 'habits'],
  ['page', 'pages'],
  ['session', 'sessions'],
  ['plan', 'plans'],
];
const LOCAL_SETTINGS = ['notify', 'blockAlarms']; // tied to this device's push subscription, never synced

const normKey = (k) => String(k || '').toLowerCase().replace(/[\s-]/g, '');

// ---------- meta (kept apart from the main data) ----------
const blank = () => ({ key: '', cursor: 0, base: {}, pend: {}, last: 0, err: null });
let M = loadMeta();
function loadMeta() {
  try {
    const m = JSON.parse(localStorage.getItem(META));
    if (m && typeof m === 'object') return { ...blank(), ...m };
  } catch {}
  return blank();
}
function saveMeta() {
  try {
    localStorage.setItem(META, JSON.stringify(M));
  } catch {}
}
addEventListener('storage', (e) => e.key === META && (M = loadMeta()));

// ---------- records ----------
// JSON with sorted keys, so the same data always hashes the same (the server reorders keys).
function stable(x) {
  if (Array.isArray(x)) return '[' + x.map(stable).join(',') + ']';
  if (x && typeof x === 'object')
    return '{' + Object.keys(x).sort().filter((k) => x[k] !== undefined).map((k) => JSON.stringify(k) + ':' + stable(x[k])).join(',') + '}';
  return JSON.stringify(x ?? null);
}
// cyrb53: small fast string hash, good enough to spot a change
function hash(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
const settingsData = (s) => {
  const d = { ...s.settings };
  for (const k of LOCAL_SETTINGS) delete d[k];
  return d;
};
// Map "kind:id" -> { kind, id, data, h }
function records(s = store.get()) {
  const m = new Map();
  for (const [kind, col] of COLS)
    for (const x of s[col] || []) if (x && typeof x.id === 'string') m.set(`${kind}:${x.id}`, { kind, id: x.id, data: x });
  m.set('settings:main', { kind: 'settings', id: 'main', data: settingsData(s) });
  for (const r of m.values()) r.h = hash(stable(r.data));
  return m;
}

// ---------- spotting local changes ----------
let applying = false;
function detect() {
  if (!M.key || applying) return;
  const now = Date.now();
  const recs = records();
  let changed = false;
  for (const [k, r] of recs) {
    const clean = M.base[k] && M.base[k][1] === r.h;
    if (!clean && !M.pend[k]) (M.pend[k] = now), (changed = true);
    else if (clean && M.pend[k]) delete M.pend[k], (changed = true);
  }
  for (const k in M.base) if (!recs.has(k) && !M.pend[k]) (M.pend[k] = now), (changed = true); // deleted here
  for (const k in M.pend) if (!recs.has(k) && !M.base[k]) delete M.pend[k], (changed = true); // made and deleted before syncing
  if (changed) saveMeta();
}

// ---------- applying server records ----------
function applyIncoming(list, force = false) {
  const latest = new Map();
  for (const r of list) {
    const k = `${r.kind}:${r.id}`;
    if (!latest.has(k) || latest.get(k).seq < r.seq) latest.set(k, r);
  }
  const take = [];
  for (const [k, r] of latest) {
    const b = M.base[k];
    if (!force && b && b[0] >= r.seq) continue; // already have this version (e.g. the echo of our own push)
    if (!force && M.pend[k] && M.pend[k] > r.mt) {
      // both changed, ours is newer: keep ours, but push it on top of this server version
      M.base[k] = [r.seq, b ? b[1] : ''];
      continue;
    }
    take.push([k, r]);
  }
  if (!take.length) return;
  applying = true;
  try {
    store.applyRemote((s) => {
      for (const [, r] of take) {
        if (r.kind === 'settings') {
          if (!r.deleted && r.data) for (const [key, v] of Object.entries(r.data)) if (!LOCAL_SETTINGS.includes(key)) s.settings[key] = v;
          continue;
        }
        const col = COLS.find((c) => c[0] === r.kind)?.[1];
        if (!col) continue;
        const arr = (s[col] ||= []);
        const i = arr.findIndex((x) => x && x.id === r.id);
        if (r.deleted || !r.data) {
          if (i >= 0) arr.splice(i, 1);
        } else if (i >= 0) arr[i] = { ...r.data, id: r.id };
        else if (col === 'tasks' || col === 'pages') arr.unshift({ ...r.data, id: r.id });
        else arr.push({ ...r.data, id: r.id });
      }
    });
  } finally {
    applying = false;
  }
  const now = records();
  for (const [k, r] of take) {
    delete M.pend[k];
    if (now.has(k)) M.base[k] = [r.seq, now.get(k).h];
    else delete M.base[k];
  }
}

// ---------- talking to the server ----------
class SyncError extends Error {
  constructor(msg, code) {
    super(msg);
    this.code = code;
  }
}
async function call(key, body) {
  let res;
  try {
    res = await fetch(SYNC_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-sync-key': key }, body: JSON.stringify(body) });
  } catch {
    throw new SyncError('no connection', 'offline');
  }
  if (res.status === 401) throw new SyncError('the sync key is wrong', 'key');
  if (!res.ok) throw new SyncError(`the sync server answered ${res.status}`, 'server');
  return res.json();
}

async function pullSince(key, since) {
  const out = [];
  for (;;) {
    const r = await call(key, { action: 'pull', since });
    out.push(...r.records);
    if (r.records.length) since = r.records[r.records.length - 1].seq;
    if (!r.more) return { records: out, cursor: since };
  }
}

async function once() {
  if (!M.key || !SYNC_URL) return;
  detect();
  const pulled = await pullSince(M.key, M.cursor);
  applyIncoming(pulled.records);
  M.cursor = pulled.cursor;
  saveMeta();

  const recs = records();
  const out = [];
  for (const k of Object.keys(M.pend)) {
    const [kind, ...rest] = k.split(':');
    const id = rest.join(':');
    const b = M.base[k];
    const local = recs.get(k);
    if (local) out.push({ kind, id, data: local.data, mt: M.pend[k], base: b ? b[0] : 0, h: local.h });
    else if (b) out.push({ kind, id, deleted: true, mt: M.pend[k], base: b[0] });
    else delete M.pend[k];
  }
  for (let i = 0; i < out.length; i += 200) {
    const chunk = out.slice(i, i + 200);
    const r = await call(M.key, { action: 'push', records: chunk.map(({ h, ...x }) => x) });
    const sent = new Map(chunk.map((x) => [`${x.kind}:${x.id}`, x]));
    const nowRecs = records();
    for (const a of r.accepted || []) {
      const k = `${a.kind}:${a.id}`;
      const x = sent.get(k);
      if (!x) continue;
      if (x.deleted) delete M.base[k];
      else M.base[k] = [a.seq, x.h];
      // edited again while we were sending? then it stays pending for the next round
      const cur = nowRecs.get(k);
      if ((x.deleted && !cur) || (cur && cur.h === x.h)) delete M.pend[k];
    }
    applyIncoming(r.rejected || [], true); // the server had a newer edit: take it
    saveMeta();
  }
  M.last = Date.now();
  M.err = null;
  saveMeta();
}

let running = null;
let again = false;
function setErr(e) {
  M.err = e instanceof SyncError ? e.code : 'server';
  if (!(e instanceof SyncError)) console.warn('sync failed', e);
  saveMeta();
}
// Run a sync now (or once more right after the one in progress). Never throws.
export function syncNow() {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        again = false;
        await once();
      } while (again);
    } catch (e) {
      setErr(e);
    } finally {
      running = null;
      window.dispatchEvent(new Event('sync-status'));
    }
  })();
  return running;
}

// ---------- public API for Settings ----------
export const configured = () => !!SYNC_URL;
export const connected = () => !!M.key;
export const status = () => ({ connected: !!M.key, last: M.last, err: M.err, pending: Object.keys(M.pend).length, busy: !!running });

// Check the key and find out whether the server already holds data. Returns
// { ok: true, serverHasData } or { ok: false, why }.
export async function check(rawKey) {
  const key = normKey(rawKey);
  if (key.length < 20) return { ok: false, why: 'that key is too short. copy the whole key printed by setup-sync.' };
  try {
    const r = await call(key, { action: 'pull', since: 0 });
    return { ok: true, serverHasData: r.records.some((x) => !x.deleted) };
  } catch (e) {
    return { ok: false, why: e instanceof SyncError ? e.message : 'could not reach the sync server' };
  }
}

// Start syncing with this key. mode 'merge' keeps this device's data and adds the server's;
// 'replace' drops this device's tasks, habits, notes, sessions and plans first and takes the server's.
export async function connect(rawKey, mode = 'merge') {
  M = { ...blank(), key: normKey(rawKey) };
  if (mode === 'replace') {
    applying = true;
    try {
      store.applyRemote((s) => {
        for (const [, col] of COLS) s[col] = [];
      });
    } finally {
      applying = false;
    }
  }
  saveMeta();
  // merge: everything here counts as new and is pushed on the first sync (the newer edit wins where both
  // sides have the same record). replace: nothing is pending, so the server's copy of everything comes down.
  if (mode !== 'replace') detect();
  await syncNow();
  return status();
}

// Stop syncing on this device. Data on the phone and on the server stays as it is.
export function disconnect() {
  M = blank();
  try {
    localStorage.removeItem(META);
  } catch {}
  window.dispatchEvent(new Event('sync-status'));
}

// ---------- when to sync ----------
let soon;
const later = (ms) => {
  clearTimeout(soon);
  soon = setTimeout(syncNow, ms);
};
export function start() {
  if (!configured()) return;
  addEventListener('store-saved', () => {
    if (!M.key || applying) return;
    detect();
    later(3000);
  });
  addEventListener('online', () => M.key && syncNow());
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && M.key && syncNow());
  setInterval(() => document.visibilityState === 'visible' && M.key && syncNow(), 60000);
  if (M.key) syncNow();
}
