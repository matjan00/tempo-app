// Pomodoro engine. Time is computed from an end timestamp, so it stays correct even when the
// phone throttles the page in the background. No DOM here except audio / notifications.
import * as store from './store.js';
import { uid, fmtMin } from './util.js';
import { toast } from './ui.js';
import * as push from './push.js';

const MODES = ['focus', 'short', 'long'];
export const MODE_LABEL = { focus: 'Focus', short: 'Short break', long: 'Long break' };
export const durationOf = (mode, s = store.get().settings) => s[mode] * 60000;

export function view() {
  const st = store.get();
  const t = st.timer;
  const total = durationOf(t.mode, st.settings);
  const rem = t.running ? Math.max(0, t.endAt - Date.now()) : t.remaining ?? total;
  return { mode: t.mode, running: t.running, rem, total, taskId: t.taskId, cycle: t.cycle, every: st.settings.every };
}

// ---------- audio (chime + background noise) ----------
let ctx, noiseSrc, noiseGain, noiseKind;
function audio() {
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch {}
  return ctx;
}
export const unlockAudio = audio;

export function chime() {
  const c = audio();
  if (!c) return;
  const now = c.currentTime;
  [659.25, 783.99, 1046.5].forEach((f, i) => {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.value = f;
    const t0 = now + i * 0.22;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.28, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.4);
    o.connect(g).connect(c.destination);
    o.start(t0);
    o.stop(t0 + 1.5);
  });
}

function noiseBuffer(c, kind) {
  const len = c.sampleRate * 4;
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0, b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === 'brown') {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    } else if (kind === 'pink') {
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    } else d[i] = w * 0.5;
  }
  // loop seam: fade the ends together
  const f = 2000;
  for (let i = 0; i < f; i++) d[len - 1 - i] = d[len - 1 - i] * (i / f) + d[f - 1 - i] * (1 - i / f) * 0;
  return buf;
}

function stopNoise() {
  if (!noiseSrc) return;
  const src = noiseSrc, g = noiseGain, c = ctx;
  noiseSrc = noiseGain = noiseKind = null;
  try {
    g.gain.setTargetAtTime(0, c.currentTime, 0.15);
    setTimeout(() => src.stop(), 600);
  } catch {}
}

function syncNoise() {
  const { settings } = store.get();
  const want = view().running && view().mode === 'focus' && settings.noise !== 'off' ? settings.noise : null;
  if (!want) return stopNoise();
  if (noiseKind === want) return;
  stopNoise();
  const c = audio();
  if (!c) return;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, want);
  src.loop = true;
  const g = c.createGain();
  g.gain.value = 0;
  src.connect(g).connect(c.destination);
  src.start();
  g.gain.setTargetAtTime(want === 'white' ? 0.12 : 0.3, c.currentTime, 0.4);
  noiseSrc = src; noiseGain = g; noiseKind = want;
}

// ---------- keep the screen awake while running ----------
let lock = null;
async function syncWake() {
  try {
    const want = view().running && store.get().settings.keepAwake && document.visibilityState === 'visible';
    if (want && !lock && navigator.wakeLock) {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => (lock = null));
    } else if (!want && lock) {
      await lock.release();
      lock = null;
    }
  } catch {
    lock = null;
  }
}
document.addEventListener('visibilitychange', syncWake);

export function sync() {
  syncNoise();
  syncWake();
  syncPush();
}

// ---------- locked-phone alarm (server push) ----------
function nextLabel() {
  const st = store.get();
  const t = st.timer;
  if (t.mode === 'focus') {
    const long = t.cycle + 1 >= st.settings.every;
    return ['Focus session done', `${st.settings.focus} min logged. Time for a ${long ? 'long' : 'short'} break.`];
  }
  return ['Break over', 'Ready for the next focus session?'];
}
export function syncPush() {
  const t = store.get().timer;
  if (t.running) {
    const [title, body] = nextLabel();
    push.schedule(t.endAt, title, body);
  } else push.cancel();
}

// ---------- controls ----------
export function start() {
  audio();
  const v = view();
  store.mutate((s) => {
    const t = s.timer;
    t.running = true;
    t.endAt = Date.now() + v.rem;
    t.remaining = null;
    t.startedAt ||= Date.now();
  });
  sync();
}

export function pause() {
  const v = view();
  store.mutate((s) => {
    s.timer.running = false;
    s.timer.endAt = null;
    s.timer.remaining = v.rem;
  });
  sync();
}

export const toggle = () => (view().running ? pause() : start());

export function reset() {
  store.mutate((s) => {
    Object.assign(s.timer, { running: false, endAt: null, remaining: null, startedAt: null });
  });
  sync();
}

export function setMode(mode) {
  store.mutate((s) => {
    Object.assign(s.timer, { mode, running: false, endAt: null, remaining: null, startedAt: null });
  });
  sync();
}

export function setTask(id) {
  store.mutate((s) => (s.timer.taskId = id || null));
}

export function setNoise(kind) {
  store.mutate((s) => (s.settings.noise = kind));
  audio();
  sync();
}

function advance(completed, endedAt) {
  let next = 'focus';
  let logged = 0;
  store.mutate((s) => {
    const t = s.timer;
    if (t.mode === 'focus') {
      if (completed) {
        const task = s.tasks.find((x) => x.id === t.taskId);
        const min = s.settings.focus;
        s.sessions.push({ id: uid(), end: endedAt, min, task: t.taskId || null, project: task?.project || null });
        if (task) {
          task.pomos += 1;
          task.focusMin += min;
        }
        t.cycle += 1;
        logged = min;
      }
      next = t.cycle >= s.settings.every ? 'long' : 'short';
    } else {
      if (t.mode === 'long') t.cycle = 0;
      next = 'focus';
    }
    Object.assign(t, { mode: next, running: false, endAt: null, remaining: null, startedAt: null });
  });
  if (completed && store.get().settings.autoStart) start();
  else sync();
  return { next, logged };
}

export const skip = () => advance(false, Date.now());

function alertUser(wasFocus, next, logged) {
  const s = store.get().settings;
  const title = wasFocus ? 'Focus session done' : 'Break over';
  const body = wasFocus
    ? `${fmtMin(logged)} logged. Time for a ${next === 'long' ? 'long' : 'short'} break.`
    : 'Ready for the next focus session?';
  if (s.sound) chime();
  if (s.vibrate) navigator.vibrate?.([220, 120, 220, 120, 420]);
  toast(`${title} — ${body}`, { ms: 6000 });
  if (s.notify && 'Notification' in window && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
    const opts = { body, icon: 'icons/icon-192.png', tag: 'tempo-timer', renotify: true };
    navigator.serviceWorker?.ready.then((r) => r.showNotification(title, opts)).catch(() => {});
  }
}

// Called ~4×/second from app.js.
export function tick() {
  const t = store.get().timer;
  if (t.running && Date.now() >= t.endAt) {
    const wasFocus = t.mode === 'focus';
    const { next, logged } = advance(true, t.endAt);
    alertUser(wasFocus, next, logged);
  }
}

export { MODES };
