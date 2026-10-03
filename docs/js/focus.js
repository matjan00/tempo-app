import * as store from './store.js';
import * as timer from './timer.js';
import { openSheet, toast } from './ui.js';
import { openSettings } from './settings.js';
import { icon } from './icons.js';
import { esc, pad, todayStr } from './util.js';

const R = 118;
const C = 2 * Math.PI * R;
let zen = false;

const mmss = (ms) => {
  const s = Math.ceil(ms / 1000);
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
};

const SOUNDS = ['off', 'brown', 'pink', 'white'];

// "12:34" with a separate colon, so it can blink while the timer runs
const timeHtml = (ms) => {
  const [m, s] = mmss(ms).split(':');
  return `<span id="f-mm">${m}</span><span class="colon" aria-hidden="true">:</span><span id="f-ss">${s}</span>`;
};

export function render(root) {
  const v = timer.view();
  const st = store.get();
  const task = store.getTask(v.taskId);
  const round = v.cycle >= v.every ? 0 : v.cycle; // sessions finished in the current round
  const dots = Array.from({ length: v.every }, (_, i) => `<i class="${i < v.cycle ? 'on' : ''}${v.mode === 'focus' && i === round ? ' now' : ''}"></i>`).join('');
  // the one session counter: dots + a short line
  const count = v.mode === 'focus' ? `session ${round + 1} of ${v.every}` : v.mode === 'long' ? 'round done. well done' : `next: session ${round + 1} of ${v.every}`;
  const noise = SOUNDS.includes(st.settings.noise) ? st.settings.noise : 'off';
  const nextNoise = SOUNDS[(SOUNDS.indexOf(noise) + 1) % SOUNDS.length];
  document.body.classList.toggle('zen', zen);

  root.innerHTML = `
    <div class="focus ${v.running ? 'running' : v.rem < v.total ? 'paused' : 'idle'} mode-${v.mode}">
      <header class="top focus-top"><h1 class="sr">focus timer</h1>
        <div class="seg modes" role="group" aria-label="timer mode">${timer.MODES.map((m) => `<button data-mode="${m}" class="${m === v.mode ? 'on' : ''}" aria-pressed="${m === v.mode}">${m === 'focus' ? 'focus' : m === 'short' ? 'short' : 'long'}</button>`).join('')}</div>
        <div class="top-btns"><button class="icon-btn" data-act="zen" aria-label="${zen ? 'leave full screen' : 'full screen timer'}" aria-pressed="${zen}">${icon(zen ? 'shrink' : 'expand', 21)}</button>
        <button class="icon-btn" data-act="settings" aria-label="settings">${icon('sliders', 22)}</button></div></header>
      <div class="dial" data-act="toggle" role="button" tabindex="0" aria-label="${v.running ? 'pause timer' : 'start timer'}">
        <svg viewBox="0 0 260 260" width="100%" aria-hidden="true"><circle cx="130" cy="130" r="${R}" class="trk"/>
          <circle id="f-ring" cx="130" cy="130" r="${R}" class="bar" stroke-dasharray="${C}" stroke-dashoffset="${offset(v)}" transform="rotate(-90 130 130)"/></svg>
        <div class="dial-in"><div class="dial-mode">${timer.MODE_LABEL[v.mode].toLowerCase()}</div><div class="time" id="f-time" role="timer" aria-label="${mmss(v.rem)} left">${timeHtml(v.rem)}</div><div class="state" id="f-state">${v.running ? 'running · tap to pause' : v.rem < v.total ? 'paused · tap to resume' : 'tap to start'}</div></div>
      </div>
      <button class="task-pick ${task ? 'has' : ''}" data-act="pick">${task ? `<span class="tp-l">working on</span><span class="tp-t">${esc(task.title || 'untitled')}</span>` : `<span class="tp-none">${icon('plus', 15)} choose a task (optional)</span>`}</button>
      <div class="controls">
        <button class="ctl" data-act="reset" aria-label="reset timer">${icon('reset', 22)}</button>
        <button class="ctl main" data-act="toggle" aria-label="${v.running ? 'pause' : 'start'}">${icon(v.running ? 'pause' : 'play', 30)}</button>
        <button class="ctl" data-act="skip" aria-label="${v.mode === 'focus' ? 'skip to break' : 'skip break'}">${icon('skip', 22)}</button>
      </div>
      <div class="f-foot">
        <div class="f-count"><div class="dots" aria-hidden="true">${dots}</div><span>${count}</span></div>
        <button type="button" class="chip noise-btn ${noise !== 'off' ? 'on' : ''}" data-noise="${nextNoise}" aria-label="background sound: ${noise}. tap for ${nextNoise}">${icon('volume', 16)}<span>sound: ${noise}</span></button>
      </div>
    </div>`;

  // Reset / skip / mode change throw away the current session, so they offer an undo.
  const withUndo = (fn, msg) => {
    const had = timer.hasProgress();
    const snap = timer.snapshot();
    fn();
    if (had) toast(msg, { action: 'undo', onAction: () => timer.restore(snap) });
  };
  root.onclick = (e) => {
    const m = e.target.closest('[data-mode]');
    if (m) return m.dataset.mode !== v.mode && withUndo(() => timer.setMode(m.dataset.mode), `switched to ${timer.MODE_LABEL[m.dataset.mode].toLowerCase()}`);
    const n = e.target.closest('[data-noise]');
    if (n) return timer.setNoise(n.dataset.noise);
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (a === 'toggle') timer.toggle();
    else if (a === 'reset') withUndo(() => timer.reset(), 'timer reset');
    else if (a === 'skip') withUndo(() => timer.skip(), v.mode === 'focus' ? 'session skipped (not logged)' : 'break skipped');
    else if (a === 'settings') openSettings();
    else if (a === 'zen') (zen = !zen), render(root);
    else if (a === 'pick') pickTask();
  };
  root.onkeydown = (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.dial')) {
      e.preventDefault();
      timer.toggle();
    }
  };
}

const offset = (v) => C * (1 - Math.min(1, Math.max(0, v.rem / v.total)));

// Called every tick while the Focus tab is visible — updates only the numbers, not the whole screen.
export function tickUI() {
  const t = document.getElementById('f-time');
  if (!t) return;
  const v = timer.view();
  const [m, s] = mmss(v.rem).split(':');
  const mm = document.getElementById('f-mm');
  const ss = document.getElementById('f-ss');
  if (mm && mm.textContent !== m) mm.textContent = m;
  if (ss && ss.textContent !== s) ss.textContent = s;
  const label = `${m}:${s} left`;
  if (t.getAttribute('aria-label') !== label) t.setAttribute('aria-label', label);
  document.getElementById('f-ring').setAttribute('stroke-dashoffset', offset(v));
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
    `<h2 class="sh">work on…</h2>
    <div class="pick-list">
      <button class="pick none ${!cur ? 'on' : ''}" data-id="">no specific task</button>
      ${open.map((t) => `<button class="pick ${cur === t.id ? 'on' : ''}" data-id="${t.id}"><span class="check sm p${t.prio}" aria-hidden="true"></span><span class="pick-t">${esc(t.title || 'untitled')}</span>${t.due === today ? '<span class="pick-d">today</span>' : ''}</button>`).join('')}
      ${open.length ? '' : '<div class="empty"><small>no open tasks yet. add one on the tasks tab.</small></div>'}
    </div>`
  );
  rec.body.addEventListener('click', (e) => {
    const b = e.target.closest('.pick');
    if (!b) return;
    timer.setTask(b.dataset.id);
    rec.close();
  });
}
