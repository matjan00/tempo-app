import * as store from './store.js';
import { taskRow, handleTaskClick, composer, bindComposer } from './components.js';
import { openSettings } from './settings.js';
import { icon } from './icons.js';
import { install, isStandalone } from './install.js';
import { toast } from './ui.js';
import { todayStr, DAYS, MONTHS, fmtMin, fmtDate, esc } from './util.js';

let showDone = false;
const bannerHidden = () => { try { return localStorage.getItem('tempo.hideInstall') === '1'; } catch { return false; } };

const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? 'Still up?' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};

// One slim line instead of a ring: "2 of 5 done" + a thin segmented bar. Only shown once something is done or planned.
function progress(done, total) {
  if (!total) return '';
  const segs = total <= 12
    ? `<span class="prog-bar segs" aria-hidden="true">${Array.from({ length: total }, (_, i) => `<i class="${i < done ? 'on' : ''}"></i>`).join('')}</span>`
    : `<span class="prog-bar" aria-hidden="true"><i class="on" style="width:${((done / total) * 100).toFixed(1)}%"></i></span>`;
  return `<div class="prog"><p class="prog-t"><b>${done} of ${total} done</b></p>${segs}</div>`;
}

export function render(root) {
  const st = store.get();
  const today = todayStr();
  const open = st.tasks.filter((t) => !t.done);
  const late = open.filter((t) => t.due && t.due < today).sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
  const todays = open.filter((t) => t.due === today).sort((a, b) => b.prio - a.prio);
  const doneToday = st.tasks.filter((t) => t.done && t.doneAt && new Date(t.doneAt).toDateString() === new Date().toDateString());
  const total = late.length + todays.length + doneToday.length;
  const d = new Date();
  const section = (label, list, cls = '') =>
    list.length ? `<section class="sec ${cls}"><h2>${label}<span>${list.length}</span></h2>${list.map((t) => taskRow(t)).join('')}</section>` : '';

  // "unplanned": open tasks without a date
  const unplanned = open.filter((t) => !t.due).slice(0, 3);
  const empty = !late.length && !todays.length;

  root.innerHTML = `
    <header class="top">
      <div><div class="eyebrow">${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}</div><h1>${greeting()}</h1></div>
      <button class="icon-btn" data-act="settings" aria-label="settings">${icon('sliders', 22)}</button>
    </header>
    ${!isStandalone() && !bannerHidden() ? `<div class="install-banner">${icon('download', 18)}<span class="ib-t">install to-do</span><button class="btn primary" data-act="install">install</button><button class="icon-btn" data-act="hideInstall" aria-label="hide install banner">${icon('x', 18)}</button></div>` : ''}
    ${progress(doneToday.length, total)}
    ${section('Overdue', late, 'late')}
    ${section('Today', todays)}
    ${empty ? `<div class="empty">${icon('leaf', 34)}<p>${doneToday.length ? 'all clear. enjoy the rest of your day.' : 'nothing planned for today.'}</p><small>${unplanned.length ? 'add a task below, or plan one of your unplanned tasks.' : 'type a task in the bar below. words like “tomorrow” or “#gym” are picked up automatically.'}</small></div>` : ''}
    ${empty && unplanned.length ? `<section class="sec"><h2>unplanned tasks</h2>${unplanned.map((t) => `<div class="pull" data-id="${t.id}">${taskRow(t)}<button class="chip" data-act="plan" aria-label="do today: ${esc(t.title)}">do today</button></div>`).join('')}</section>` : ''}
    ${doneToday.length ? `<section class="sec dim"><h2 class="hbtn"><button class="h3btn" data-act="toggleDone" aria-expanded="${showDone}">Done today<span>${doneToday.length}</span>${icon(showDone ? 'chevD' : 'chevR', 16)}</button></h2>${showDone ? doneToday.map((t) => taskRow(t)).join('') : ''}</section>` : ''}
    ${composer({ placeholder: 'add a task for today…' })}
  `;

  bindComposer(root, () => ({ due: today }));
  root.onclick = (e) => {
    if (handleTaskClick(e, { onFocus: (id) => document.dispatchEvent(new CustomEvent('tempo:focus-task', { detail: id })) })) return;
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (a === 'settings') openSettings();
    if (a === 'install') install();
    if (a === 'hideInstall') { try { localStorage.setItem('tempo.hideInstall', '1'); } catch {} render(root); }
    if (a === 'toggleDone') (showDone = !showDone), render(root);
    if (a === 'plan') {
      const id = e.target.closest('.pull').dataset.id;
      store.updateTask(id, { due: today });
      toast('planned for today', { action: 'undo', onAction: () => store.updateTask(id, { due: null }) });
    }
  };
}
