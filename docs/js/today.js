import * as store from './store.js';
import { taskRow, handleTaskClick, composer, bindComposer } from './components.js';
import { openSettings } from './settings.js';
import { icon } from './icons.js';
import { install, isStandalone } from './install.js';
import { toast } from './ui.js';
import { todayStr, DAYS, MONTHS, fmtMin, esc } from './util.js';

let showDone = false;
const bannerHidden = () => { try { return localStorage.getItem('tempo.hideInstall') === '1'; } catch { return false; } };

const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? 'Still up?' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};

function ring(done, total) {
  const R = 30, C = 2 * Math.PI * R;
  const frac = total ? done / total : 0;
  return `<svg class="mini-ring" width="76" height="76" viewBox="0 0 76 76" role="img" aria-label="${done} of ${total} done"><circle cx="38" cy="38" r="${R}" class="trk"/>
    <circle cx="38" cy="38" r="${R}" class="bar" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - frac)}" transform="rotate(-90 38 38)"/>
    <text x="38" y="43" text-anchor="middle">${total ? Math.round(frac * 100) + '%' : '–'}</text></svg>`;
}

export function render(root) {
  const st = store.get();
  const today = todayStr();
  const open = st.tasks.filter((t) => !t.done);
  const late = open.filter((t) => t.due && t.due < today).sort((a, b) => a.due.localeCompare(b.due));
  const todays = open.filter((t) => t.due === today).sort((a, b) => b.prio - a.prio);
  const doneToday = st.tasks.filter((t) => t.done && t.doneAt && new Date(t.doneAt).toDateString() === new Date().toDateString());
  const total = late.length + todays.length + doneToday.length;
  const mins = st.sessions.filter((s) => new Date(s.end).toDateString() === new Date().toDateString()).reduce((a, s) => a + s.min, 0);
  const sessions = st.sessions.filter((s) => new Date(s.end).toDateString() === new Date().toDateString()).length;
  const d = new Date();
  const section = (label, list, cls = '') =>
    list.length ? `<section class="sec ${cls}"><h3>${label}<span>${list.length}</span></h3>${list.map((t) => taskRow(t)).join('')}</section>` : '';

  const inbox = open.filter((t) => !t.due && !t.project).slice(0, 3);
  const empty = !late.length && !todays.length;

  root.innerHTML = `
    <header class="top">
      <div><div class="eyebrow">${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}</div><h1>${greeting()}</h1></div>
      <button class="icon-btn" data-act="settings" aria-label="settings">${icon('sliders', 22)}</button>
    </header>
    ${!isStandalone() && !bannerHidden() ? `<div class="install-banner"><div>${icon('download', 20)}<span><b>install to-do</b><small>Add it to your home screen</small></span></div><button class="btn primary" data-act="install">Install</button><button class="icon-btn" data-act="hideInstall" aria-label="hide install banner">${icon('x', 18)}</button></div>` : ''}
    <div class="hero card">
      ${ring(doneToday.length, total)}
      <div class="hero-t"><div class="big">${doneToday.length}<span> of ${total} done</span></div>
        <div class="sub-t">${mins ? `${fmtMin(mins)} focused · ${sessions}${st.settings.goal ? '/' + st.settings.goal : ''} session${sessions === 1 && !st.settings.goal ? '' : 's'}` : 'No focus time yet today'}</div></div>
    </div>
    ${section('Overdue', late, 'late')}
    ${section('Today', todays)}
    ${empty ? `<div class="empty">${icon('leaf', 34)}<p>${doneToday.length ? 'All clear. Enjoy the rest of your day.' : 'Nothing planned for today.'}</p><small>${inbox.length ? 'Add a task below, or pull one in from your inbox.' : 'Type a task in the bar below. Words like “tomorrow” or “#gym” are picked up automatically.'}</small></div>` : ''}
    ${empty && inbox.length ? `<section class="sec"><h3>From your inbox</h3>${inbox.map((t) => `<div class="pull" data-id="${t.id}">${taskRow(t)}<button class="chip" data-act="plan" aria-label="do today: ${esc(t.title)}">Do today</button></div>`).join('')}</section>` : ''}
    ${doneToday.length ? `<section class="sec dim"><button class="h3btn" data-act="toggleDone"><h3>Done today<span>${doneToday.length}</span></h3>${icon(showDone ? 'chevD' : 'chevR', 16)}</button>${showDone ? doneToday.map((t) => taskRow(t)).join('') : ''}</section>` : ''}
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
