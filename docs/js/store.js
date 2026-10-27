// The single source of truth. Everything lives in localStorage on the phone (no account, no server).
import { uid, todayStr, addDays, parseYmd, ymd } from './util.js';

const KEY = 'tempo.v1';
const REV_KEY = KEY + '.rev'; // tiny companion key: lets a window cheaply notice that another window saved newer data
const SCHEMA = 1; // bump when the saved shape changes, and add a step to MIGRATIONS
// from-version -> fn(saved) returning the saved data in the next version's shape
const MIGRATIONS = {};

export let loadedCorrupt = false; // true when the saved data could not be read (a copy was kept under tempo.v1.corrupt-*)
export let saveFailed = false; // true while the last attempt to save failed (storage full / blocked)

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
  v: SCHEMA,
  rev: 0,
  tasks: [],
  habits: [],
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
    if (raw) {
      try {
        const out = migrate(JSON.parse(raw));
        out.rev = Math.max(out.rev, Number(localStorage.getItem(REV_KEY)) || 0);
        return out;
      } catch (e) {
        // unreadable: keep the raw text so nothing is lost for good, then start over
        console.warn('Saved data is corrupt', e);
        loadedCorrupt = true;
        try {
          localStorage.setItem(`${KEY}.corrupt-${Date.now()}`, raw);
        } catch {}
      }
    }
  } catch {}
  return seed(fresh());
}

const CLEAN_ID = /^[\w-]+$/;
// A usable, unique id: keeps the saved one when it is a safe string nobody else uses yet.
function cleanId(x, seen) {
  let id = typeof x === 'number' ? String(x) : x;
  if (typeof id !== 'string' || !CLEAN_ID.test(id) || seen.has(id)) {
    do id = uid();
    while (seen.has(id));
  }
  seen.add(id);
  return id;
}
const num = (x, d) => (typeof x === 'number' || (typeof x === 'string' && x.trim() !== '')) && Number.isFinite(Number(x)) ? Number(x) : d;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const REPEATS = ['daily', 'weekdays', 'weekly', 'monthly'];
// same limits as the steppers in settings.js
const LIMITS = { focus: [5, 90], short: [1, 30], long: [5, 60], every: [2, 8], goal: [1, 16] };

const arr = (x) => (Array.isArray(x) ? x : []);
const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);

// Make sure every saved record has the fields the screens expect (old saves and imported backups
// may miss some). Only fills gaps — never changes values that are already there.
function migrate(s) {
  if (!isObj(s)) s = {};
  const f = fresh();
  // step an older save up to the current shape, one version at a time
  let ver = Number(s.v) || 1;
  while (ver < SCHEMA && MIGRATIONS[ver]) (s = MIGRATIONS[ver](s)), ver++;
  const out = { ...f, ...s, v: SCHEMA, rev: Math.max(0, Number(s.rev) || 0), settings: { ...f.settings, ...(isObj(s.settings) ? s.settings : {}) }, timer: { ...f.timer, ...(isObj(s.timer) ? s.timer : {}) } };
  // old saves had projects + an inbox: every task is now either "work" or "personal"
  const oldProjects = arr(s.projects).filter(isObj);
  const areaOfProject = (id) => {
    const p = oldProjects.find((x) => x.id === id);
    return p && /work|prac|job|office/i.test(String(p.name)) ? 'work' : 'personal';
  };
  delete out.projects;
  for (const k of ['tasks', 'habits', 'pages', 'sessions']) out[k] = arr(out[k]).filter(isObj);
  const taskIds = new Set(), pageIds = new Set(), habitIds = new Set();
  // open daily tasks are habits now: they come back every day instead of piling up as overdue
  const dailies = out.tasks.filter((t) => t.repeat === 'daily' && t.done !== true);
  out.tasks = out.tasks.filter((t) => !dailies.includes(t));
  out.habits.push(...dailies.map((t) => ({ title: t.title, created: t.created })));
  out.habits = out.habits.map((h) => {
    const log = {};
    if (isObj(h.log)) for (const k in h.log) if (YMD.test(k) && h.log[k]) log[k] = true;
    return { id: cleanId(h.id, habitIds), title: String(h.title ?? ''), created: num(h.created, Date.now()), log };
  });
  out.tasks = out.tasks.map((t) => {
    const n = { ...newTask(), ...t, id: cleanId(t.id, taskIds) };
    n.title = String(n.title ?? '');
    n.notes = String(n.notes ?? '');
    n.tags = arr(n.tags).map(String);
    const subIds = new Set();
    n.sub = arr(n.sub).filter(isObj).map((x) => ({ id: cleanId(x.id, subIds), t: String(x.t ?? ''), d: !!x.d }));
    n.prio = [0, 1, 2, 3].includes(n.prio) ? n.prio : 0;
    n.est = Math.max(0, num(n.est, 0));
    n.pomos = Math.max(0, num(n.pomos, 0));
    n.focusMin = Math.max(0, num(n.focusMin, 0));
    n.done = n.done === true;
    n.created = num(n.created, Date.now());
    n.doneAt = n.done ? num(n.doneAt, null) : null;
    if (typeof n.due !== 'string' || !YMD.test(n.due)) n.due = null;
    if (!REPEATS.includes(n.repeat)) n.repeat = null;
    if (!(n.repeatDay >= 1 && n.repeatDay <= 31)) delete n.repeatDay;
    if (n.status !== 'doing') n.status = 'todo';
    n.area = t.area === 'work' || t.area === 'personal' ? t.area : areaOfProject(t.project); // t = what was saved (n already has the default)
    delete n.project;
    return n;
  });
  out.pages = out.pages.map((p) => {
    const n = { title: '', icon: '📄', pinned: false, created: Date.now(), updated: Date.now(), ...p, id: cleanId(p.id, pageIds) };
    n.title = String(n.title ?? '');
    n.created = num(n.created, Date.now());
    n.updated = num(n.updated, Date.now());
    const blockIds = new Set();
    n.blocks = arr(n.blocks).filter(isObj).map((x) => ({ ...newBlock(), ...x, id: cleanId(x.id, blockIds), text: String(x.text ?? '') }));
    if (!n.blocks.length) n.blocks.push(newBlock());
    return n;
  });
  out.sessions = out.sessions
    .filter((x) => Number.isFinite(x.end))
    .map((x) => {
      const o = { ...x, min: Math.max(0, num(x.min, 0)) };
      o.area = x.area === 'work' || x.area === 'personal' ? x.area : x.project ? areaOfProject(x.project) : null;
      delete o.project;
      return o;
    });
  for (const k in LIMITS) {
    const [lo, hi] = LIMITS[k];
    out.settings[k] = Math.min(hi, Math.max(lo, Math.round(num(out.settings[k], DEFAULT_SETTINGS[k]))));
  }
  if (!['auto', 'light', 'dark'].includes(out.settings.theme)) out.settings.theme = DEFAULT_SETTINGS.theme;
  if (!['off', 'brown', 'pink', 'white'].includes(out.settings.noise)) out.settings.noise = DEFAULT_SETTINGS.noise;
  const t = out.timer;
  if (!['focus', 'short', 'long'].includes(t.mode)) t.mode = 'focus';
  if (t.running && !Number.isFinite(t.endAt)) Object.assign(t, { running: false, endAt: null, remaining: null });
  t.cycle = Math.max(0, num(t.cycle, 0));
  if (t.remaining !== null && !Number.isFinite(t.remaining)) t.remaining = null;
  if (t.startedAt !== null && !Number.isFinite(t.startedAt)) t.startedAt = null;
  if (typeof t.taskId !== 'string') t.taskId = null;
  return out;
}

let saveTimer;
let frozen = false; // set by resetAll(): stop writing so the wipe is not undone on the way out
// Writes are frozen after a reset; thaw() lets a page that stays open (no reload) save again.
export const thaw = () => {
  frozen = false;
};
const setSaveFailed = (v) => {
  if (v === saveFailed) return;
  saveFailed = v;
  window.dispatchEvent(new CustomEvent(v ? 'store-save-failed' : 'store-save-ok'));
};
// Take data another window saved (only when it is newer than ours).
function adopt(raw) {
  try {
    const next = migrate(JSON.parse(raw));
    if (next.rev <= (state.rev || 0)) return false;
    state = next;
    return true;
  } catch {
    return false;
  }
}
function write() {
  if (frozen) return;
  try {
    // another window saved newer data than we have: take it instead of overwriting it with stale state
    const stored = Number(localStorage.getItem(REV_KEY)) || 0;
    if (stored > (state.rev || 0) && adopt(localStorage.getItem(KEY))) {
      emit();
      return;
    }
    state.rev = (state.rev || 0) + 1;
    localStorage.setItem(KEY, JSON.stringify(state));
    localStorage.setItem(REV_KEY, String(state.rev));
    setSaveFailed(false);
  } catch (e) {
    console.warn('Could not save', e);
    setSaveFailed(true); // the next save retries
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
// another window (or home-screen app + browser tab) changed the data: show it instead of clobbering it later
addEventListener('storage', (e) => {
  if (frozen || e.key !== KEY || !e.newValue) return;
  if (adopt(e.newValue)) {
    clearTimeout(saveTimer);
    emit();
  }
});

export const get = () => state;
export const subscribe = (fn) => (listeners.add(fn), () => listeners.delete(fn));
export const emit = () =>
  listeners.forEach((fn) => {
    try {
      fn();
    } catch (e) {
      console.error(e);
    }
  });

// silent = save without re-rendering the screen (used while typing).
export function mutate(fn, silent = false) {
  try {
    fn(state);
  } catch (e) {
    console.error(e); // keep whatever was changed so far and still save / redraw, so the screen matches the data
  }
  save();
  if (!silent) emit();
}

export function replaceAll(data) {
  const next = migrate(data);
  next.rev = state.rev || 0; // counts as newer than what is saved
  // a running timer from a backup would log a phantom session the moment it "ends": pause it instead
  const t = next.timer;
  if (t.running) Object.assign(t, { running: false, remaining: Math.max(0, t.endAt - Date.now()), endAt: null });
  state = next;
  flush();
  emit();
}

// Erase everything and start fresh. Writes are frozen first: otherwise the pending save and the
// pagehide/visibilitychange flush would put the old data right back while the page reloads.
export function resetAll() {
  clearTimeout(saveTimer);
  frozen = true;
  try {
    // an empty app (no sample tasks): saving the blank state means the next start doesn't re-seed examples
    localStorage.removeItem(REV_KEY);
    localStorage.setItem(KEY, JSON.stringify(fresh()));
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
  area: 'personal', // personal | work
  tags: [],
  sub: [],
  repeat: null, // daily | weekdays | weekly | monthly
  est: 0, // estimated pomodoros
  pomos: 0,
  focusMin: 0,
  status: 'todo', // todo | doing; done is a separate flag
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
    if (!t) return;
    Object.assign(t, patch);
    // the monthly target day belongs to the old due date / rule: recompute it from the new one
    if (('due' in patch || 'repeat' in patch) && !('repeatDay' in patch)) delete t.repeatDay;
  }, silent);
}

const daysIn = (y, m) => new Date(y, m + 1, 0).getDate();

// Next date for a repeating task. Steps from the task's own due date (so a weekly Monday task stays
// on Mondays even when it is finished late) until the date is after today.
export function nextDue(t, today = todayStr()) {
  const start = t.due || today;
  const anchorDay = t.repeatDay >= 1 && t.repeatDay <= 31 ? t.repeatDay : parseYmd(start).getDate(); // monthly: keep "the 31st" as the target day
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
      delete next.repeatDay;
      if (t.repeat === 'monthly') next.repeatDay = t.repeatDay || parseYmd(t.due || todayStr()).getDate();
      delete next.nextId;
      delete next.nextMade;
      s.tasks.unshift(next);
      t.nextId = next.id; // lets "undo" take the new copy back
      t.nextMade = { title: next.title, notes: next.notes, due: next.due, sub: next.sub.map((x) => x.t) }; // how the copy looked when made
      t.repeat = null; // the finished copy stays in history without repeating
    }
    if (!done && t.nextId) {
      // Undo of a repeating task: remove the copy that was created, but only while it is still untouched.
      // If it was edited, worked on or finished, keep it and just reopen this one. If it is gone, leave the repeat off.
      const copy = s.tasks.find((x) => x.id === t.nextId);
      const m = t.nextMade;
      const untouched =
        copy && m && !copy.done && copy.title === m.title && copy.notes === m.notes && copy.due === m.due &&
        copy.pomos === 0 && copy.focusMin === 0 && copy.sub.length === m.sub.length &&
        copy.sub.every((x, i) => !x.d && x.t === m.sub[i]);
      if (untouched) {
        t.repeat = copy.repeat;
        if (copy.repeatDay) t.repeatDay = copy.repeatDay;
        s.tasks = s.tasks.filter((x) => x !== copy);
        if (s.timer.taskId === copy.id) s.timer.taskId = t.id;
      }
      delete t.nextId;
      delete t.nextMade;
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

// ---------- habits ----------
// A habit has no due date: it is simply "done" or "not done" for each calendar day. `log` holds the days it was done.
export const getHabit = (id) => state.habits.find((h) => h.id === id);

export function addHabit(title) {
  const h = { id: uid(), title: String(title).trim(), created: Date.now(), log: {} };
  mutate((s) => s.habits.push(h));
  return h;
}

export function updateHabit(id, patch) {
  mutate((s) => {
    const h = s.habits.find((x) => x.id === id);
    if (h) Object.assign(h, patch);
  });
}

export function toggleHabit(id, day = todayStr()) {
  mutate((s) => {
    const h = s.habits.find((x) => x.id === id);
    if (!h) return;
    if (h.log[day]) delete h.log[day];
    else h.log[day] = true;
  });
}

export function deleteHabit(id) {
  let snap = null;
  mutate((s) => {
    const i = s.habits.findIndex((h) => h.id === id);
    if (i < 0) return;
    snap = { habit: s.habits[i], index: i };
    s.habits.splice(i, 1);
  });
  return snap;
}
export function restoreHabit(snap) {
  if (!snap) return;
  mutate((s) => {
    if (s.habits.some((h) => h.id === snap.habit.id)) return;
    s.habits.splice(Math.min(snap.index, s.habits.length), 0, snap.habit);
  });
}

// Days in a row, counted back from today (or from yesterday while today is still open), plus the best run ever.
export function habitStreak(h, today = todayStr()) {
  let cur = 0;
  let d = h.log[today] ? today : addDays(today, -1);
  while (h.log[d]) (cur++, (d = addDays(d, -1)));
  let best = 0, run = 0, prev = null;
  for (const k of Object.keys(h.log).sort()) {
    run = prev && addDays(prev, 1) === k ? run + 1 : 1;
    best = Math.max(best, run);
    prev = k;
  }
  return { cur, best };
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
  const t = todayStr();
  s.tasks.push(
    newTask({ title: 'Try a 25 min focus session', due: t, prio: 2, est: 1 }),
    newTask({ title: 'Tap me to open details, tap the square to finish', due: t, sub: [{ id: uid(), t: 'Add a due date', d: false }, { id: uid(), t: 'Add a subtask', d: false }] }),
    newTask({ title: 'Press and hold a task to reschedule or delete it', due: addDays(t, 1) }),
    newTask({ title: 'Plan the week', due: addDays(t, 1), area: 'work', repeat: 'weekly' }),
    newTask({ title: 'Choose work or personal for every task (below the bar, or @work)', area: 'work' })
  );
  s.habits.push({ id: uid(), title: 'Drink a glass of water', created: Date.now(), log: {} });
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
      b('todo', 'Write: gym every weekday *1  — repeats and plans one focus session'),
      b('todo', 'Picked up a word by mistake (like "sat" in a title)? Tap its chip above the bar to keep it as text'),
      b('quote', 'Your data stays on this phone. Back it up in Settings → Export.'),
    ],
  });
  return s;
}
state = load(); // initialised last: seed() needs the helpers above
