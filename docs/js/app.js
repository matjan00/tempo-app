import * as store from './store.js';
import * as timer from './timer.js';
import { applyTheme } from './theme.js';
import { icon } from './icons.js';
import { onInstallChange } from './install.js';
import * as today from './today.js';
import * as tasks from './tasks.js';
import * as focus from './focus.js';
import * as notes from './notes.js';
import * as stats from './stats.js';
import { closeAll } from './ui.js';
import { bindLongPress } from './components.js';

const TABS = [
  ['today', 'Today', 'sun', today],
  ['tasks', 'Tasks', 'tasks', tasks],
  ['focus', 'Focus', 'timer', focus],
  ['notes', 'Notes', 'notes', notes],
  ['stats', 'Stats', 'stats', stats],
];

const root = document.getElementById('screen');
const nav = document.getElementById('nav');
let tab = 'today';
try {
  const saved = localStorage.getItem('tempo.tab');
  if (TABS.some((t) => t[0] === saved)) tab = saved;
} catch {}

function drawNav() {
  nav.innerHTML = TABS.map(([k, label, ic]) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}" ${k === tab ? 'aria-current="page"' : ''}>${icon(ic, 23)}<span>${label}</span></button>`).join('');
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
}

// Each tab remembers where it was scrolled to (for this session), so switching tabs doesn't lose your place.
const scrollOf = {};
function go(next) {
  if (next === tab) return root.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  scrollOf[tab] = root.scrollTop;
  tab = next;
  try {
    localStorage.setItem('tempo.tab', tab);
  } catch {}
  if (tab !== 'focus') focus.leaveZen();
  drawNav();
  root.scrollTop = 0;
  render();
  root.scrollTop = scrollOf[tab] || 0;
  root.dataset.tab = tab;
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
document.addEventListener('focusin', (e) => e.target.classList?.contains('qa-input') && document.body.classList.add('typing'));
document.addEventListener('focusout', (e) => e.target.classList?.contains('qa-input') && setTimeout(() => !document.activeElement?.classList?.contains('qa-input') && document.body.classList.remove('typing'), 50));

onInstallChange(() => store.emit());

store.subscribe(() => {
  applyTheme();
  render();
});

// Timer heartbeat
let lastTitle = '';
let lastDay = new Date().toDateString();
setInterval(() => {
  // the app may stay open past midnight: redraw so "today", overdue and stats move to the new day
  const day = new Date().toDateString();
  if (day !== lastDay) {
    lastDay = day;
    store.emit();
  }
  timer.tick();
  if (tab === 'focus') focus.tickUI();
  const v = timer.view();
  const title = v.running ? `${String(Math.floor(Math.ceil(v.rem / 1000) / 60)).padStart(2, '0')}:${String(Math.ceil(v.rem / 1000) % 60).padStart(2, '0')} · ${timer.MODE_LABEL[v.mode].toLowerCase()}` : 'to-do';
  if (title !== lastTitle) document.title = lastTitle = title;
}, 250);
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && (timer.tick(), tab === 'focus' && focus.tickUI()));


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
drawNav();
root.dataset.tab = tab;
render();
timer.sync();
