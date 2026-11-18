// Day timeline on Today: the planned blocks for today (and a look at tomorrow), the daily score + streak,
// ticking blocks off, marking them missed (with a reason) and "replan from now".
import * as store from './store.js';
import * as P from './plan.js';
import { openSheet, toast } from './ui.js';
import { icon } from './icons.js';
import { esc, todayStr, addDays, haptic } from './util.js';
import { openTask } from './components.js';

let view = null; // 'today' | 'tomorrow' (null: pick automatically)

const KIND = { meeting: 'Meeting', prep: 'Prep', lunch: 'Lunch', break: 'Break', habit: 'Habit', personal: 'Personal' };
const REASONS = ['meeting ran over', 'interrupted', 'took longer than planned', 'too tired', 'didn’t feel like it'];

const hm = (min) => (min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}` : `${min} min`);

// ---------- score line (replaces the "x of y done" line when today has a plan) ----------
export function scoreLine(plan, plans, today) {
  const so = P.score(plan, P.nowMin());
  const all = P.score(plan);
  const st = P.streak(plans, today);
  const pct = so.pct;
  const label = pct === null ? 'Nothing due yet' : `Score ${pct}%`;
  const bar = all.planned ? Math.round((all.done / all.planned) * 100) : 0;
  return `<div class="prog day-score ${pct !== null && pct < P.STREAK_PCT ? 'low' : ''}">
    <p class="prog-t"><b>${label}</b> · ${hm(all.done)} of ${hm(all.planned)} done · ${icon('fire', 13)} streak ${st}</p>
    <span class="prog-bar" role="progressbar" aria-label="plan done" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${bar}"><i class="on" style="width:${bar}%"></i></span>
  </div>`;
}

// ---------- timeline ----------
function blockRow(b, { at, live }) {
  const fixed = P.FIXED.includes(b.kind);
  const s = P.toMin(b.start), e = P.toMin(b.end);
  const now = live && s <= at && at < e && b.status !== 'missed';
  const unticked = live && e <= at && !fixed && b.status === 'planned';
  const meta = [`<span class="m">${b.start}–${b.end}</span>`];
  if (now) meta.unshift('<span class="m now-m">Now</span>');
  if (KIND[b.kind]) meta.push(`<span class="m">${KIND[b.kind]}</span>`);
  else if (b.area) meta.push(`<span class="m">${b.area === 'work' ? 'Work' : 'Personal'}</span>`);
  if (b.copyOf) meta.push('<span class="m">Second try</span>');
  if (b.status === 'missed') meta.push(`<span class="m miss">Missed${b.moved ? ` · moved to ${esc(b.moved)}` : ''}</span>`);
  if (unticked) meta.push('<span class="m miss">Not ticked</span>');
  const title = b.title.trim() ? esc(b.title) : '<span class="muted">untitled</span>';
  const mark = fixed
    ? `<span class="blk-dot" aria-hidden="true"></span>`
    : `<button type="button" class="check" data-act="bcheck" role="checkbox" aria-checked="${b.status === 'done'}" aria-label="${esc(b.title || 'block')}" ${live && b.status !== 'missed' ? '' : 'disabled'}>${b.status === 'done' ? icon('check', 15) : ''}</button>`;
  return `<div class="task blk k-${b.kind} ${b.status} ${now ? 'now' : ''} ${unticked ? 'unticked' : ''}" data-bid="${esc(b.id)}">
    <span class="blk-time" aria-hidden="true">${b.start}</span>
    ${mark}
    <button type="button" class="t-main" data-act="bopen"><span class="t-title">${title}</span><span class="t-meta">${meta.join('')}</span></button>
  </div>`;
}

// Which plan the section shows. Returns null when there is nothing to show.
function shown(today) {
  const tp = store.getPlan(today);
  const mp = store.getPlan(addDays(today, 1));
  if (!tp && !mp) return null;
  let v = view;
  if (v === 'today' && !tp) v = null;
  if (v === 'tomorrow' && !mp) v = null;
  if (!v) v = tp ? 'today' : 'tomorrow';
  return { v, plan: v === 'today' ? tp : mp, hasToday: !!tp, hasTomorrow: !!mp };
}

export function section(today = todayStr()) {
  const s = shown(today);
  if (!s) return '';
  const at = P.nowMin();
  const live = s.v === 'today';
  const tab = (v, label, on) =>
    on ? `<button type="button" class="day-tab ${s.v === v ? 'on' : ''}" data-act="dview" data-v="${v}" aria-pressed="${s.v === v}">${label}</button>` : '';
  const canReplan = live && s.plan.blocks.some((b) => !P.FIXED.includes(b.kind) && b.status === 'planned' && P.toMin(b.end) > at - 600);
  const blocks = s.plan.blocks;
  return `<section class="sec day">
    <div class="day-h">
      <div class="day-tabs">${tab('today', 'Today’s plan', s.hasToday)}${tab('tomorrow', 'Tomorrow', s.hasTomorrow)}</div>
      ${canReplan ? `<button type="button" class="chip day-replan" data-act="replan">${icon('reset', 14)} Replan from now</button>` : ''}
    </div>
    ${blocks.length ? blocks.map((b) => blockRow(b, { at, live })).join('') : '<p class="day-empty">Nothing planned.</p>'}
  </section>`;
}

// Task ids that today's plan already covers (Today hides them from its own task list).
export function plannedTaskIds(today = todayStr()) {
  const p = store.getPlan(today);
  return new Set((p?.blocks || []).map((b) => b.taskId).filter(Boolean));
}

// ---------- actions ----------
const save = (plan) => store.setPlan(plan);
const getBlock = (date, id) => store.getPlan(date)?.blocks.find((b) => b.id === id) || null;

function setStatus(date, id, status) {
  const p = structuredClone(store.getPlan(date));
  const b = p.blocks.find((x) => x.id === id);
  if (!b) return;
  b.status = status;
  if (status === 'done') b.doneAt = Date.now();
  else delete b.doneAt;
  save(p);
}

// Tick a block. A task is finished with its last open block of the day; a habit is ticked for today.
function tick(id) {
  const today = todayStr();
  const plan = store.getPlan(today);
  const b = getBlock(today, id);
  if (!plan || !b) return;
  haptic();
  if (b.status === 'done') return setStatus(today, id, 'planned');
  setStatus(today, id, 'done');
  let undoTask = null;
  if (b.taskId) {
    const t = store.getTask(b.taskId);
    const more = plan.blocks.some((x) => x.id !== id && x.taskId === b.taskId && x.status === 'planned');
    if (t && !t.done && !more) {
      store.setDone(t.id, true);
      undoTask = () => store.setDone(t.id, false);
    }
  } else if (b.habitId) {
    const h = store.getHabit(b.habitId);
    if (h && !h.log[today]) {
      store.toggleHabit(h.id, today);
      undoTask = () => store.getHabit(h.id)?.log[today] && store.toggleHabit(h.id, today);
    }
  }
  toast(undoTask && b.taskId ? 'done, task completed' : 'done', {
    action: 'undo',
    onAction: () => {
      setStatus(today, id, 'planned');
      undoTask?.();
    },
  });
}

// Missed: keep the reason, move a copy to the next free slot today, or the task to tomorrow.
function miss(id, reason) {
  const today = todayStr();
  const before = store.getPlan(today);
  const b = getBlock(today, id);
  if (!before || !b) return;
  const { plan, moved } = P.missBlock(before, id, reason, P.nowMin());
  save(plan);
  let undoDue = null;
  if (moved === 'tomorrow' && b.taskId) {
    const t = store.getTask(b.taskId);
    if (t && !t.done) {
      const was = t.due;
      store.updateTask(t.id, { due: addDays(today, 1) });
      undoDue = () => store.updateTask(t.id, { due: was });
    }
  }
  toast(moved === 'tomorrow' ? 'missed. moved to tomorrow.' : moved ? `missed. moved to ${moved}.` : 'marked as skipped', {
    action: 'undo',
    ms: 7000,
    onAction: () => {
      save(before);
      undoDue?.();
    },
  });
}

function replan() {
  const today = todayStr();
  const before = store.getPlan(today);
  if (!before) return;
  const { plan, tomorrow } = P.replanFrom(before, P.nowMin());
  save(plan);
  const undo = [];
  for (const b of tomorrow) {
    const t = b.taskId && store.getTask(b.taskId);
    if (t && !t.done) {
      const was = t.due;
      store.updateTask(t.id, { due: addDays(today, 1) });
      undo.push(() => store.updateTask(t.id, { due: was }));
    }
  }
  toast(tomorrow.length ? `replanned. ${tomorrow.length} moved to tomorrow.` : 'replanned from now', {
    action: 'undo',
    ms: 8000,
    onAction: () => {
      save(before);
      undo.forEach((f) => f());
    },
  });
}

// ---------- block sheet ----------
function openBlock(date, id) {
  const b = getBlock(date, id);
  if (!b) return;
  const live = date === todayStr();
  const fixed = P.FIXED.includes(b.kind);
  const task = b.taskId ? store.getTask(b.taskId) : null;
  const opt = (k, ic, label) => `<button type="button" class="qa-act" data-qa="${k}">${icon(ic, 19)}<span>${label}</span></button>`;
  const info = [`${b.start}–${b.end}`, hm(P.dur(b)), KIND[b.kind] || (b.area === 'work' ? 'Work' : b.area === 'personal' ? 'Personal' : '')].filter(Boolean).join(' · ');
  const acts = [];
  if (live && b.status === 'planned' && !fixed) acts.push(opt('done', 'check', 'done'), opt('miss', 'x', 'missed it…'));
  if (live && b.status === 'done') acts.push(opt('undone', 'reset', 'mark as not done'));
  if (live && b.status === 'planned' && fixed) acts.push(opt('skip', 'x', 'didn’t happen'));
  if (task && !task.done && live) acts.push(opt('focus', 'play', 'start focus'));
  if (task) acts.push(opt('task', 'more', 'open task'));
  const status = b.status === 'missed' ? `<p class="blk-why">Missed${b.reason ? `: ${esc(b.reason)}` : ''}${b.moved ? ` · moved to ${esc(b.moved)}` : ''}</p>` : '';
  const rec = openSheet(
    `<div class="qa-sheet">
      <p class="qa-sheet-t">${esc(b.title || 'untitled')}</p>
      <p class="blk-info">${esc(info)}</p>
      ${status}
      ${acts.length ? `<div class="qa-list">${acts.join('')}</div>` : ''}
    </div>`,
    { cls: 'small', ariaLabel: 'plan block' }
  );
  rec.body.addEventListener('click', (e) => {
    const k = e.target.closest('[data-qa]')?.dataset.qa;
    if (!k) return;
    rec.close();
    if (k === 'done') tick(id);
    else if (k === 'undone') setStatus(date, id, 'planned');
    else if (k === 'skip') miss(id, 'didn’t happen');
    else if (k === 'miss') setTimeout(() => askReason(id), 60);
    else if (k === 'focus') document.dispatchEvent(new CustomEvent('tempo:focus-task', { detail: b.taskId }));
    else if (k === 'task') setTimeout(() => openTask(b.taskId), 60);
  });
}

function askReason(id) {
  const b = getBlock(todayStr(), id);
  if (!b) return;
  const rec = openSheet(
    `<div class="qa-sheet">
      <p class="qa-sheet-t">Why was it missed?</p>
      <p class="blk-info">${esc(b.title)} · ${b.start}–${b.end}</p>
      <div class="blk-reasons">${REASONS.map((r) => `<button type="button" class="chip" data-r="${esc(r)}">${esc(r)}</button>`).join('')}</div>
      <input class="field blk-reason" data-reason type="text" maxlength="200" placeholder="or say it in a few words" aria-label="reason">
      <div class="row-btns"><button type="button" class="btn primary" data-go>Move it</button></div>
    </div>`,
    { cls: 'small', ariaLabel: 'missed block', focus: '[data-reason]' }
  );
  const input = rec.body.querySelector('[data-reason]');
  const go = () => {
    rec.close();
    miss(id, input.value.trim());
  };
  rec.body.addEventListener('click', (e) => {
    const r = e.target.closest('[data-r]');
    if (r) {
      input.value = r.dataset.r;
      return go();
    }
    if (e.target.closest('[data-go]')) go();
  });
  input.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), go()));
}

// Click handling for the Today screen. Returns true if it handled the event.
export function handleClick(e, rerender) {
  const el = e.target.closest('[data-act]');
  if (!el) return false;
  const a = el.dataset.act;
  if (a === 'dview') {
    view = el.dataset.v;
    rerender();
    return true;
  }
  if (a === 'replan') return replan(), true;
  const row = el.closest('[data-bid]');
  if (!row) return false;
  const date = row.closest('.day') && shown(todayStr())?.v === 'tomorrow' ? addDays(todayStr(), 1) : todayStr();
  if (a === 'bcheck') return tick(row.dataset.bid), true;
  if (a === 'bopen') return openBlock(date, row.dataset.bid), true;
  return false;
}
