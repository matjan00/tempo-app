// The single source of truth. Everything lives in localStorage on the phone (no account, no server).
import { uid, todayStr, addDays, parseYmd, ymd } from './util.js';

const KEY = 'tempo.v1';

export const DEFAULT_SETTINGS = {
  theme: 'auto', // auto | light | dark
  accent: 'coral',
  focus: 25,
  short: 5,
  long: 15,
  every: 4, // focus sessions before a long break
  autoStart: false,
  sound: true,
  vibrate: true,
  notify: false,
  keepAwake: true,
  noise: 'off', // off | brown | pink | white
  goal: 4, // daily focus sessions goal
};

const fresh = () => ({
  v: 1,
  tasks: [],
  projects: [],
  pages: [],
  sessions: [],
  settings: { ...DEFAULT_SETTINGS },
  timer: { mode: 'focus', running: false, endAt: null, remaining: null, startedAt: null, taskId: null, cycle: 0 },
});

let state;
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return migrate(JSON.parse(raw));
  } catch {}
  return seed(fresh());
}

const arr = (x) => (Array.isArray(x) ? x : []);
const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);

// Make sure every saved record has the fields the screens expect (old saves and imported backups
// may miss some). Only fills gaps — never changes values that are already there.
function migrate(s) {
  if (!isObj(s)) s = {};
  const f = fresh();
  const out = { ...f, ...s, settings: { ...f.settings, ...(isObj(s.settings) ? s.settings : {}) }, timer: { ...f.timer, ...(isObj(s.timer) ? s.timer : {}) } };
  for (const k of ['tasks', 'projects', 'pages', 'sessions']) out[k] = arr(out[k]).filter(isObj);
  out.tasks = out.tasks.map((t) => {
    const n = { ...newTask(), id: t.id || uid(), ...t };
    n.title = String(n.title ?? '');
    n.notes = String(n.notes ?? '');
    n.tags = arr(n.tags).map(String);
    n.sub = arr(n.sub).filter(isObj).map((x) => ({ id: x.id || uid(), t: String(x.t ?? ''), d: !!x.d }));
    n.prio = [0, 1, 2, 3].includes(n.prio) ? n.prio : 0;
    n.est = Number(n.est) || 0;
    n.pomos = Number(n.pomos) || 0;
    n.focusMin = Number(n.focusMin) || 0;
    if (n.status !== 'doing') n.status = 'todo';
    return n;
  });
  out.pages = out.pages.map((p) => {
    const n = { title: '', icon: '📄', pinned: false, created: Date.now(), updated: Date.now(), ...p, id: p.id || uid() };
    n.title = String(n.title ?? '');
    n.blocks = arr(n.blocks).filter(isObj).map((x) => ({ ...newBlock(), ...x, id: x.id || uid(), text: String(x.text ?? '') }));
    if (!n.blocks.length) n.blocks.push(newBlock());
    return n;
  });
  out.projects = out.projects.map((p) => ({ name: '', color: '#8b8b93', ...p, id: p.id || uid() }));
  out.sessions = out.sessions.filter((x) => Number.isFinite(x.end)).map((x) => ({ ...x, min: Number(x.min) || 0 }));
  const t = out.timer;
  if (!['focus', 'short', 'long'].includes(t.mode)) t.mode = 'focus';
  if (t.running && !Number.isFinite(t.endAt)) Object.assign(t, { running: false, endAt: null, remaining: null });
  t.cycle = Number(t.cycle) || 0;
  return out;
}

let saveTimer;
let frozen = false; // set by resetAll(): stop writing so the wipe is not undone on the way out
function write() {
  if (frozen) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('Could not save', e);
  }
}
export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(write, 150);
}
const flush = () => {
  clearTimeout(saveTimer);
  write();
};
addEventListener('pagehide', flush);
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush());

export const get = () => state;
export const subscribe = (fn) => (listeners.add(fn), () => listeners.delete(fn));
export const emit = () => listeners.forEach((fn) => fn());

// silent = save without re-rendering the screen (used while typing).
export function mutate(fn, silent = false) {
  fn(state);
  save();
  if (!silent) emit();
}

export function replaceAll(data) {
  state = migrate(data);
  flush();
  emit();
}

// Erase everything and start fresh. Writes are frozen first: otherwise the pending save and the
// pagehide/visibilitychange flush would put the old data right back while the page reloads.
export function resetAll() {
  clearTimeout(saveTimer);
  frozen = true;
  try {
    localStorage.removeItem(KEY);
  } catch {}
}

// ---------- tasks ----------
export const newTask = (p = {}) => ({
  id: uid(),
  title: '',
  notes: '',
  done: false,
  doneAt: null,
  created: Date.now(),
  due: null,
  prio: 0, // 0 none · 1 low · 2 medium · 3 high
  project: null,
  tags: [],
  sub: [],
  repeat: null, // daily | weekdays | weekly | monthly
  est: 0, // estimated pomodoros
  pomos: 0,
  focusMin: 0,
  status: 'todo', // todo | doing (board column); done is a separate flag
  ...p,
});

export const getTask = (id) => state.tasks.find((t) => t.id === id);

export function addTask(p) {
  const t = newTask(p);
  mutate((s) => s.tasks.unshift(t));
  return t;
}

export function updateTask(id, patch, silent = false) {
  mutate((s) => {
    const t = s.tasks.find((x) => x.id === id);
    if (t) Object.assign(t, patch);
  }, silent);
}

const daysIn = (y, m) => new Date(y, m + 1, 0).getDate();

// Next date for a repeating task. Steps from the task's own due date (so a weekly Monday task stays
// on Mondays even when it is finished late) until the date is after today.
export function nextDue(t, today = todayStr()) {
  const start = t.due || today;
  const anchorDay = t.repeatDay || parseYmd(start).getDate(); // monthly: keep "the 31st" as the target day
  let d = parseYmd(start);
  const step = () => {
    if (t.repeat === 'daily') d.setDate(d.getDate() + 1);
    else if (t.repeat === 'weekly') d.setDate(d.getDate() + 7);
    else if (t.repeat === 'monthly') {
      const y = d.getFullYear(), m = d.getMonth() + 1;
      d = new Date(y, m, Math.min(anchorDay, daysIn(y, m)));
    } else if (t.repeat === 'weekdays') {
      do d.setDate(d.getDate() + 1);
      while (d.getDay() === 0 || d.getDay() === 6);
    } else d.setDate(d.getDate() + 1);
  };
  let guard = 0;
  do step();
  while (ymd(d) <= today && ++guard < 5000);
  return ymd(d);
}

export function setDone(id, done) {
  mutate((s) => {
    const t = s.tasks.find((x) => x.id === id);
    if (!t || t.done === done) return;
    t.done = done;
    t.doneAt = done ? Date.now() : null;
    t.status = 'todo';
    if (done && t.repeat) {
      const next = {
        ...t,
        id: uid(),
        done: false,
        doneAt: null,
        due: nextDue(t),
        pomos: 0,
        focusMin: 0,
        created: Date.now(),
        sub: t.sub.map((x) => ({ ...x, id: uid(), d: false })),
      };
      if (t.repeat === 'monthly') next.repeatDay = t.repeatDay || parseYmd(t.due || todayStr()).getDate();
      delete next.nextId;
      s.tasks.unshift(next);
      t.nextId = next.id; // lets "undo" take the new copy back
      t.repeat = null; // the finished copy stays in history without repeating
    }
    if (!done && t.nextId) {
      // Undo of a repeating task: remove the copy that was created (if it is still untouched) and repeat again.
      const copy = s.tasks.find((x) => x.id === t.nextId);
      if (copy && !copy.done) {
        t.repeat = copy.repeat;
        if (copy.repeatDay) t.repeatDay = copy.repeatDay;
        s.tasks = s.tasks.filter((x) => x !== copy);
        if (s.timer.taskId === copy.id) s.timer.taskId = t.id;
      }
      delete t.nextId;
    }
  });
}

export function deleteTask(id) {
  let snap = null;
  mutate((s) => {
    const i = s.tasks.findIndex((t) => t.id === id);
    if (i < 0) return;
    snap = { task: s.tasks[i], index: i, wasTimer: s.timer.taskId === id };
    s.tasks.splice(i, 1);
    if (snap.wasTimer) s.timer.taskId = null;
  });
  return snap;
}

// Put a deleted task back where it was (used by "undo").
export function restoreTask(snap) {
  if (!snap) return;
  mutate((s) => {
    if (s.tasks.some((t) => t.id === snap.task.id)) return;
    s.tasks.splice(Math.min(snap.index, s.tasks.length), 0, snap.task);
    if (snap.wasTimer && !s.timer.taskId) s.timer.taskId = snap.task.id;
  });
}

// ---------- projects ----------
export function addProject(name, color) {
  const p = { id: uid(), name, color };
  mutate((s) => s.projects.push(p));
  return p;
}
export function updateProject(id, patch) {
  mutate((s) => Object.assign(s.projects.find((p) => p.id === id) || {}, patch));
}
export function deleteProject(id) {
  let snap = null;
  mutate((s) => {
    const i = s.projects.findIndex((p) => p.id === id);
    if (i < 0) return;
    snap = { project: s.projects[i], index: i, tasks: s.tasks.filter((t) => t.project === id).map((t) => t.id) };
    s.projects.splice(i, 1);
    s.tasks.forEach((t) => t.project === id && (t.project = null));
  });
  return snap;
}
export function restoreProject(snap) {
  if (!snap) return;
  mutate((s) => {
    if (s.projects.some((p) => p.id === snap.project.id)) return;
    s.projects.splice(Math.min(snap.index, s.projects.length), 0, snap.project);
    const ids = new Set(snap.tasks);
    s.tasks.forEach((t) => ids.has(t.id) && !t.project && (t.project = snap.project.id));
  });
}

// ---------- pages ----------
export const newBlock = (type = 'p', text = '') => ({ id: uid(), type, text, done: false });

export function addPage(p = {}) {
  const page = { id: uid(), title: '', icon: '📄', blocks: [newBlock()], pinned: false, created: Date.now(), updated: Date.now(), ...p };
  mutate((s) => s.pages.unshift(page));
  return page;
}
export const getPage = (id) => state.pages.find((p) => p.id === id);
export function deletePage(id) {
  let snap = null;
  mutate((s) => {
    const i = s.pages.findIndex((p) => p.id === id);
    if (i < 0) return;
    snap = { page: s.pages[i], index: i };
    s.pages.splice(i, 1);
  });
  return snap;
}
export function restorePage(snap) {
  if (!snap) return;
  mutate((s) => {
    if (s.pages.some((p) => p.id === snap.page.id)) return;
    s.pages.splice(Math.min(snap.index, s.pages.length), 0, snap.page);
  });
}

// ---------- seed data for a first launch ----------
function seed(s) {
  const personal = { id: uid(), name: 'Personal', color: '#3e7bfa' };
  const work = { id: uid(), name: 'Work', color: '#ff5d47' };
  s.projects.push(personal, work);
  const t = todayStr();
  s.tasks.push(
    newTask({ title: 'Try a 25 min focus session', due: t, prio: 2, est: 1, project: personal.id }),
    newTask({ title: 'Tap me to open details, tap the square to finish', due: t, sub: [{ id: uid(), t: 'Add a due date', d: false }, { id: uid(), t: 'Add a subtask', d: false }] }),
    newTask({ title: 'Press and hold a task to reschedule or delete it', due: addDays(t, 1) }),
    newTask({ title: 'Plan the week', due: addDays(t, 1), project: work.id, repeat: 'weekly' }),
    newTask({ title: 'Anything without a date lives in your Inbox' })
  );
  const b = newBlock;
  s.pages.push({
    id: uid(),
    title: 'welcome to to-do',
    icon: '👋',
    pinned: true,
    created: Date.now(),
    updated: Date.now(),
    blocks: [
      b('p', 'Pages work like Notion. Press Enter for a new line, or type / to pick a block.'),
      b('h2', 'Shortcuts'),
      b('bullet', 'Type "# " at the start of a line for a big heading'),
      b('bullet', 'Type "- " for a bullet, "1. " for a numbered list'),
      b('bullet', 'Type "[] " for a checkbox, "> " for a quote, "---" for a line'),
      b('h2', 'Quick add for tasks'),
      b('todo', 'Write: call mom tomorrow !1 #family  — date, priority and tag are picked up automatically'),
      b('todo', 'Write: gym every weekday *1  — repeats and plans one pomodoro'),
      b('todo', 'Picked up a word by mistake (like "sat" in a title)? Tap its chip above the bar to keep it as text'),
      b('quote', 'Your data stays on this phone. Back it up in Settings → Export.'),
    ],
  });
  return s;
}
state = load(); // initialised last: seed() needs the helpers above
