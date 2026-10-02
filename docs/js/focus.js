import * as store from './store.js';
import * as timer from './timer.js';
import { openSheet } from './ui.js';
import { openSettings } from './settings.js';
import { icon } from './icons.js';
import { esc, pad, fmtMin, todayStr } from './util.js';

const R = 118;
const C = 2 * Math.PI * R;
let zen = false;

const mmss = (ms) => {
  const s = Math.ceil(ms / 1000);
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
};

export function render(root) {
  const v = timer.view();
  const st = store.get();
  const task = store.getTask(v.taskId);
  const todays = st.sessions.filter((s) => new Date(s.end).toDateString() === new Date().toDateString());
  const mins = todays.reduce((a, s) => a + s.min, 0);
  const dots = Array.from({ length: v.every }, (_, i) => `<i class="${i < v.cycle ? 'on' : ''}"></i>`).join('');
  document.body.classList.toggle('zen', zen);

  root.innerHTML = `
    <div class="focus ${v.running ? 'running' : ''} mode-${v.mode}">
      <header class="top"><div><div class="eyebrow">${timer.MODE_LABEL[v.mode]}</div><h1>Focus</h1></div>
        <div class="top-btns"><button class="icon-btn" data-act="zen" aria-label="Zen mode">${icon(zen ? 'shrink' : 'expand', 21)}</button>
        <button class="icon-btn" data-act="settings" aria-label="Settings">${icon('sliders', 22)}</button></div></header>
      <div class="seg modes">${timer.MODES.map((m) => `<button data-mode="${m}" class="${m === v.mode ? 'on' : ''}">${m === 'focus' ? 'Focus' : m === 'short' ? 'Short' : 'Long'}</button>`).join('')}</div>
      <div class="dial" data-act="toggle">
        <svg viewBox="0 0 260 260" width="100%"><circle cx="130" cy="130" r="${R}" class="trk"/>
          <circle id="f-ring" cx="130" cy="130" r="${R}" class="bar" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - v.rem / v.total)}" transform="rotate(-90 130 130)"/></svg>
        <div class="dial-in"><div class="time" id="f-time">${mmss(v.rem)}</div><div class="state" id="f-state">${v.running ? 'tap to pause' : v.rem < v.total ? 'paused' : 'tap to start'}</div></div>
      </div>
      <button class="task-pick" data-act="pick">${task ? `<span class="tp-l">Working on</span><span class="tp-t">${esc(task.title)}</span>` : `<span class="tp-t muted">${icon('plus', 15)} Choose a task (optional)</span>`}</button>
      <div class="controls">
        <button class="ctl" data-act="reset" aria-label="Reset">${icon('reset', 22)}</button>
        <button class="ctl main" data-act="toggle" aria-label="${v.running ? 'Pause' : 'Start'}">${icon(v.running ? 'pause' : 'play', 30)}</button>
        <button class="ctl" data-act="skip" aria-label="Skip">${icon('skip', 22)}</button>
      </div>
      <div class="dots" title="Sessions until long break">${dots}</div>
      <div class="today-line">${todays.length} session${todays.length === 1 ? '' : 's'} today · ${fmtMin(mins)}${st.settings.goal ? ` · goal ${st.settings.goal}` : ''}</div>
      <div class="noise"><span>${icon('volume', 16)} Sound</span>${['off', 'brown', 'pink', 'white'].map((k) => `<button class="chip ${st.settings.noise === k ? 'on' : ''}" data-noise="${k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div>
    </div>`;

  root.onclick = (e) => {
    const m = e.target.closest('[data-mode]');
    if (m) return timer.setMode(m.dataset.mode);
    const n = e.target.closest('[data-noise]');
    if (n) return timer.setNoise(n.dataset.noise);
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (a === 'toggle') timer.toggle();
    else if (a === 'reset') timer.reset();
    else if (a === 'skip') timer.skip();
    else if (a === 'settings') openSettings();
    else if (a === 'zen') (zen = !zen), render(root);
    else if (a === 'pick') pickTask();
  };
}

// Called every tick while the Focus tab is visible — updates only the numbers, not the whole screen.
export function tickUI() {
  const t = document.getElementById('f-time');
  if (!t) return;
  const v = timer.view();
  t.textContent = mmss(v.rem);
  document.getElementById('f-ring').setAttribute("stroke-dashoffset", C * (1 - v.rem / v.total));
}

export const leaveZen = () => {
  zen = false;
  document.body.classList.remove('zen');
};

function pickTask() {
  const today = todayStr();
  const open = store.get().tasks.filter((t) => !t.done).sort((a, b) => (a.due === today ? -1 : 0) - (b.due === today ? -1 : 0) || b.prio - a.prio).slice(0, 40);
  const cur = store.get().timer.taskId;
  const rec = openSheet(
    `<h2 class="sh">Work on…</h2>
    <div class="pick-list">
      <button class="pick ${!cur ? 'on' : ''}" data-id="">No specific task</button>
      ${open.map((t) => `<button class="pick ${cur === t.id ? 'on' : ''}" data-id="${t.id}"><span class="check sm p${t.prio}"></span>${esc(t.title)}</button>`).join('')}
      ${open.length ? '' : '<div class="empty"><small>No open tasks yet.</small></div>'}
    </div>`
  );
  rec.body.addEventListener('click', (e) => {
    const b = e.target.closest('.pick');
    if (!b) return;
    timer.setTask(b.dataset.id);
    rec.close();
  });
}
