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

function migrate(s) {
  const f = fresh();
  const out = { ...f, ...s, settings: { ...f.settings, ...(s.settings || {}) }, timer: { ...f.timer, ...(s.timer || {}) } };
  for (const k of ['tasks', 'projects', 'pages', 'sessions']) if (!Array.isArray(out[k])) out[k] = [];
  return out;
}

let saveTimer;
function write() {
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

function nextDue(t) {
  const today = todayStr();
  const base = t.due && t.due > today ? t.due : today;
  const d = parseYmd(base);
  if (t.repeat === 'daily') d.setDate(d.getDate() + 1);
  else if (t.repeat === 'weekly') d.setDate(d.getDate() + 7);
  else if (t.repeat === 'monthly') d.setMonth(d.getMonth() + 1);
  else if (t.repeat === 'weekdays') {
    do d.setDate(d.getDate() + 1);
    while (d.getDay() === 0 || d.getDay() === 6);
  }
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
      s.tasks.unshift({
        ...t,
        id: uid(),
        done: false,
        doneAt: null,
        due: nextDue(t),
        pomos: 0,
        focusMin: 0,
        created: Date.now(),
        sub: t.sub.map((x) => ({ ...x, id: uid(), d: false })),
      });
      t.repeat = null; // the finished copy stays in history without repeating
    }
  });
}

export function deleteTask(id) {
  mutate((s) => {
    s.tasks = s.tasks.filter((t) => t.id !== id);
    if (s.timer.taskId === id) s.timer.taskId = null;
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
  mutate((s) => {
    s.projects = s.projects.filter((p) => p.id !== id);
    s.tasks.forEach((t) => t.project === id && (t.project = null));
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
  mutate((s) => (s.pages = s.pages.filter((p) => p.id !== id)));
}

// ---------- seed data for a first launch ----------
function seed(s) {
  const personal = { id: uid(), name: 'Personal', color: '#3e7bfa' };
  const work = { id: uid(), name: 'Work', color: '#ff5d47' };
  s.projects.push(personal, work);
  const t = todayStr();
  s.tasks.push(
    newTask({ title: 'Try a 25 min focus session', due: t, prio: 2, est: 1, project: personal.id }),
    newTask({ title: 'Tap me to open details, tap the circle to finish', due: t, sub: [{ id: uid(), t: 'Add a due date', d: false }, { id: uid(), t: 'Add a subtask', d: false }] }),
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
      b('quote', 'Your data stays on this phone. Back it up in Settings → Export.'),
    ],
  });
  return s;
}
state = load(); // initialised last: seed() needs the helpers above
