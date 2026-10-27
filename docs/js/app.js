import * as store from './store.js';
import * as timer from './timer.js';
import { applyTheme } from './theme.js';
import { icon } from './icons.js';
import { onInstallChange } from './install.js';
import * as today from './today.js';
import * as tasks from './tasks.js';
import * as habits from './habits.js';
import * as focus from './focus.js';
import * as notes from './notes.js';
import { closeAll, toast, focusSnapshot, focusRestore, reducedMotion } from './ui.js';
import { bindLongPress } from './components.js';

const TABS = [
  ['today', 'Today', 'sun', today],
  ['tasks', 'Tasks', 'tasks', tasks],
  ['habits', 'Habits', 'habits', habits],
  ['focus', 'Focus', 'timer', focus],
  ['notes', 'Notes', 'notes', notes],
];

const root = document.getElementById('screen');
const nav = document.getElementById('nav');
let tab = 'today';
try {
  const saved = localStorage.getItem('tempo.tab');
  if (TABS.some((t) => t[0] === saved)) tab = saved;
} catch {}

function drawNav() {
  // built once; afterwards only the highlighted tab changes, so keyboard focus on the bar is never lost
  if (nav.children.length !== TABS.length)
    nav.innerHTML = TABS.map(([k, label, ic]) => `<button type="button" data-tab="${k}">${icon(ic, 23)}<span>${label}</span></button>`).join('');
  for (const b of nav.children) {
    const on = b.dataset.tab === tab;
    b.classList.toggle('on', on);
    if (on) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
}

function render() {
  const mod = TABS.find((t) => t[0] === tab)[3];
  // keep what the user is typing (inputs marked data-keep) and the scroll position across re-renders
  const kept = [...root.querySelectorAll('[data-keep]')].map((el) => ({
    key: el.dataset.keep,
    value: el.value,
    focused: document.activeElement === el,
    pos: el.selectionStart,
  }));
  const scroll = root.scrollTop;
  const snap = kept.some((k) => k.focused) ? null : focusSnapshot(root); // any other focused control (task row, button…)
  root.onclick = root.oninput = root.onchange = root.onkeydown = null;
  mod.render(root);
  root.scrollTop = scroll;
  for (const k of kept) {
    const el = root.querySelector(`[data-keep="${k.key}"]`);
    if (!el) continue;
    if (el.value !== k.value) {
      el.value = k.value;
      el.dispatchEvent(new Event('input'));
    }
    if (k.focused) {
      el.focus();
      try {
        el.setSelectionRange(k.pos, k.pos);
      } catch {}
    }
  }
  if (snap) focusRestore(root, snap);
  drawNav(); // self-heals if the bar's buttons were ever lost
  syncTyping(); // the focused quick-add input may have been replaced by this render
}

// Each tab remembers where it was scrolled to (for this session), so switching tabs doesn't lose your place.
const scrollOf = {};
function go(next) {
  if (next === tab) return root.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
  scrollOf[tab] = root.scrollTop;
  tab = next;
  try {
    localStorage.setItem('tempo.tab', tab);
  } catch {}
  if (tab !== 'focus') focus.leaveZen();
  drawNav();
  root.scrollTop = 0;
  root.dataset.tab = tab; // before render(): the screens (and the quick-add bar) read it
  render();
  root.scrollTop = scrollOf[tab] || 0;
}

nav.addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (b) go(b.dataset.tab);
});

// "Start focus" on a task anywhere in the app
document.addEventListener('tempo:focus-task', (e) => {
  closeAll();
  timer.setTask(e.detail);
  // keep a focus session that is already under way (just switch its task); otherwise get a fresh focus timer
  if (timer.view().mode !== 'focus') timer.setMode('focus');
  go('focus');
  render();
});

// Hide the tab bar while typing in the quick-add bar so the keyboard has room.
// The class is derived from what is actually focused (never toggled blindly), because a focused input that gets
// removed by a re-render / tab switch fires no focusout, which used to leave the nav hidden for good.
function syncTyping() {
  const a = document.activeElement;
  const on = !!(a && a.isConnected && a.classList?.contains('qa-input') && document.hasFocus());
  document.body.classList.toggle('typing', on);
}
document.addEventListener('focusin', syncTyping);
document.addEventListener('focusout', () => setTimeout(syncTyping, 50));
window.addEventListener('blur', syncTyping);
window.addEventListener('pageshow', syncTyping);
window.addEventListener('resize', syncTyping);
window.visualViewport?.addEventListener('resize', syncTyping);
document.addEventListener('visibilitychange', syncTyping);
document.addEventListener('pointerdown', () => setTimeout(syncTyping, 0), true);

onInstallChange(() => store.emit());

// the theme only needs repainting when theme / accent changed (not on every task edit)
let themeKey = '';
const themeNow = () => {
  const { theme, accent } = store.get().settings;
  return `${theme}|${accent}`;
};
const syncTheme = () => {
  const k = themeNow();
  if (k === themeKey) return;
  applyTheme();
  themeKey = themeNow(); // applyTheme may have corrected an unknown accent
};
store.subscribe(() => {
  syncTheme();
  render();
});

// Saving to the phone's storage failed (full / blocked) or the saved data was unreadable: say so, once.
let saveFailed = false;
window.addEventListener('store-save-failed', () => {
  if (saveFailed) return;
  saveFailed = true;
  toast('could not save your changes. the phone storage may be full. export a backup now.', { ms: 10000 });
});
window.addEventListener('store-save-ok', () => {
  if (!saveFailed) return;
  saveFailed = false;
  toast('saving works again');
});

// Timer heartbeat
let lastTitle = '';
let lastDay = new Date().toDateString();
// the app may stay open past midnight: redraw so "today", overdue and stats move to the new day
function checkDay() {
  const day = new Date().toDateString();
  if (day !== lastDay) {
    lastDay = day;
    store.emit();
  }
}
setInterval(() => {
  checkDay(); // cheap, and also runs while hidden (the browser throttles hidden timers anyway)
  timer.tick(); // must keep running: it is what ends a session
  const v = timer.view();
  if (document.hidden && !v.running && lastTitle === 'to-do') return; // nothing visible changes
  if (!document.hidden && tab === 'focus') focus.tickUI();
  const title = v.running ? `${String(Math.floor(Math.ceil(v.rem / 1000) / 60)).padStart(2, '0')}:${String(Math.ceil(v.rem / 1000) % 60).padStart(2, '0')} · ${timer.MODE_LABEL[v.mode].toLowerCase()}` : 'to-do';
  if (title !== lastTitle) document.title = lastTitle = title;
}, 250);
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && (checkDay(), timer.tick(), tab === 'focus' && focus.tickUI()));


// Service worker (offline + installable). Reload once when a new version takes over.
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  const had = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && reg.update().catch(() => {}));
  }).catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (had && !reloaded) {
      reloaded = true;
      location.reload();
    }
  });
}

bindLongPress(root); // press-and-hold a task row for quick actions (bound once: #screen is never replaced)

applyTheme();
themeKey = themeNow();
drawNav();
// the saved data was unreadable at start-up (flag set by the store; may not exist in older builds)
if (store.loadedCorrupt) toast('your saved data could not be read, so the app started fresh. import a backup if you have one.', { ms: 12000 });
root.dataset.tab = tab;
render();
timer.sync();
