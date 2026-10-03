// Pieces shared by Today and Tasks: task rows, quick-add composer, task detail sheet.
import * as store from './store.js';
import { parseQuick } from './parse.js';
import { openSheet, toast } from './ui.js';
import { icon } from './icons.js';
import { esc, fmtDate, todayStr, addDays, parseYmd, haptic, uid } from './util.js';

export const PRIO_LABEL = ['None', 'Low', 'Medium', 'High'];
const REPEATS = [[null, 'Never'], ['daily', 'Daily'], ['weekdays', 'Weekdays'], ['weekly', 'Weekly'], ['monthly', 'Monthly']];

export const projectOf = (id) => store.get().projects.find((p) => p.id === id);

// ---------- task row ----------
export function taskRow(t, { showProject = true } = {}) {
  const today = todayStr();
  const meta = [];
  if (t.due) {
    const cls = !t.done && t.due < today ? 'late' : t.due === today ? 'today' : '';
    meta.push(`<span class="m ${cls}">${icon('calendar', 13)}${fmtDate(t.due)}</span>`);
  }
  const p = showProject && projectOf(t.project);
  if (p) meta.push(`<span class="m"><i class="dot" style="background:${p.color}"></i>${esc(p.name)}</span>`);
  if (t.sub.length) meta.push(`<span class="m">${icon('list', 13)}${t.sub.filter((s) => s.d).length}/${t.sub.length}</span>`);
  if (t.est || t.pomos) meta.push(`<span class="m">${icon('timer', 13)}${t.pomos}${t.est ? '/' + t.est : ''}</span>`);
  if (t.repeat) meta.push(`<span class="m">${icon('repeat', 13)}</span>`);
  for (const tag of t.tags.slice(0, 3)) meta.push(`<span class="m tag">#${esc(tag)}</span>`);
  const title = t.title.trim() ? esc(t.title) : '<span class="muted">untitled</span>';
  return `<div class="task ${t.done ? 'done' : ''}" data-id="${t.id}">
    <button class="check p${t.prio}" data-act="toggle" aria-label="${t.done ? 'mark as not done' : 'mark as done'}: ${esc(t.title)}">${t.done ? icon('check', 15) : ''}</button>
    <button type="button" class="t-main" data-act="open" aria-label="open ${esc(t.title)}"><span class="t-title">${title}</span>${meta.length ? `<span class="t-meta">${meta.join('')}</span>` : ''}</button>
    ${t.done ? '' : `<button class="icon-btn t-play" data-act="focus" aria-label="focus on this task">${icon('play', 16)}</button>`}
  </div>`;
}

const pending = new Set(); // rows whose "done" tap is still animating (ignore double taps)

// Mark done / not done with the little pop animation and an undo toast.
export function toggleDone(id, row = null) {
  const t = store.getTask(id);
  if (!t || pending.has(id)) return;
  haptic();
  const done = !t.done;
  if (row) {
    row.classList.toggle('done', done);
    row.querySelector('.check')?.classList.toggle('pop', done);
  }
  const apply = () => {
    pending.delete(id);
    store.setDone(id, done);
  };
  if (done && row) {
    pending.add(id);
    setTimeout(apply, 320);
  } else apply();
  if (done) toast(t.repeat ? `done. next one: ${fmtDate(store.nextDue(t)).toLowerCase()}` : 'task completed', { action: 'undo', onAction: () => (pending.has(id) ? setTimeout(() => store.setDone(id, false), 340) : store.setDone(id, false)) });
}

// Shared click handling for lists of task rows. Returns true if it handled the event.
export function handleTaskClick(e, { onFocus } = {}) {
  const el = e.target.closest('[data-act]');
  const row = e.target.closest('.task');
  if (!el || !row) return false;
  if (row.dataset.held) {
    // this "click" is the end of a long-press that already opened the menu
    delete row.dataset.held;
    return true;
  }
  const id = row.dataset.id;
  const t = store.getTask(id);
  if (!t) return false;
  if (el.dataset.act === 'toggle') return toggleDone(id, row), true;
  if (el.dataset.act === 'open') return openTask(id), true;
  if (el.dataset.act === 'focus') return onFocus?.(id), true;
  return false;
}

// ---------- long-press quick actions ----------
// Press and hold a task row (or right-click it) to reschedule, focus or delete it without opening it.
export function bindLongPress(root) {
  let timer = null;
  let start = null;
  const cancel = () => {
    clearTimeout(timer);
    timer = null;
    root.querySelectorAll('.task.pressing').forEach((x) => x.classList.remove('pressing'));
  };
  root.addEventListener('pointerdown', (e) => {
    const row = e.target.closest('.task[data-id]');
    if (!row || e.button > 0) return;
    cancel();
    start = { x: e.clientX, y: e.clientY };
    row.classList.add('pressing');
    timer = setTimeout(() => {
      cancel();
      row.dataset.held = '1';
      setTimeout(() => delete row.dataset.held, 700);
      haptic(18);
      taskActions(row.dataset.id);
    }, 480);
  });
  root.addEventListener('pointermove', (e) => {
    if (timer && start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) cancel();
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => root.addEventListener(ev, cancel));
  root.addEventListener('scroll', cancel, true);
  root.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.task[data-id]');
    if (!row) return;
    e.preventDefault();
    if (row.dataset.held) return; // already opened by the long-press timer
    cancel();
    taskActions(row.dataset.id);
  });
}

const nextMonday = () => {
  const d = parseYmd(todayStr());
  return addDays(todayStr(), ((8 - d.getDay()) % 7) || 7);
};

export function taskActions(id) {
  const t = store.getTask(id);
  if (!t) return;
  const today = todayStr();
  const opt = (k, ic, label, on = false) => `<button type="button" class="qa-act ${on ? 'on' : ''}" data-qa="${k}">${icon(ic, 19)}<span>${label}</span></button>`;
  const rec = openSheet(
    `<div class="qa-sheet">
      <p class="qa-sheet-t">${esc(t.title || 'untitled')}</p>
      <div class="qa-grid">
        ${opt('today', 'sun', 'today', t.due === today)}
        ${opt('tomorrow', 'calendar', 'tomorrow', t.due === addDays(today, 1))}
        ${opt('week', 'calendar', 'next week', t.due === nextMonday())}
        ${opt('none', 'x', 'no date', !t.due)}
      </div>
      <div class="qa-list">
        ${opt('done', 'check', t.done ? 'mark as not done' : 'mark as done')}
        ${t.done ? '' : opt('focus', 'play', 'start focus')}
        ${opt('open', 'more', 'open details')}
        ${opt('delete', 'trash', 'delete')}
      </div>
    </div>`,
    { cls: 'small' }
  );
  rec.body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-qa]');
    if (!b) return;
    const k = b.dataset.qa;
    rec.close();
    const due = { today, tomorrow: addDays(today, 1), week: nextMonday(), none: null };
    if (k in due) {
      const before = store.getTask(id)?.due ?? null;
      if (before === due[k]) return;
      store.updateTask(id, { due: due[k] });
      toast(due[k] ? `moved to ${fmtDate(due[k]).toLowerCase()}` : 'date removed', { action: 'undo', onAction: () => store.updateTask(id, { due: before }) });
    } else if (k === 'done') toggleDone(id);
    else if (k === 'focus') document.dispatchEvent(new CustomEvent('tempo:focus-task', { detail: id }));
    else if (k === 'open') setTimeout(() => openTask(id), 60);
    else if (k === 'delete') deleteWithUndo(id);
  });
}

export function deleteWithUndo(id) {
  const snap = store.deleteTask(id);
  if (snap) toast('task deleted', { action: 'undo', onAction: () => store.restoreTask(snap) });
}

// ---------- quick-add composer ----------
export function composer({ placeholder = 'add a task…', hint = true } = {}) {
  return `<div class="composer">
    <div class="qa-chips" hidden></div>
    <form class="qa-form" autocomplete="off">
      <input class="qa-input" data-keep="qa" type="text" enterkeyhint="done" placeholder="${esc(placeholder)}" aria-label="new task" maxlength="300">
      <button class="qa-send" type="submit" aria-label="add task">${icon('plus', 22)}</button>
    </form>
    ${hint ? `<div class="qa-hint">try: <b>gym tomorrow !1 #health *2</b></div>` : ''}
  </div>`;
}

// Words the user tapped away in the preview chips stay in the title. Kept across re-renders while typing.
let ignored = new Set();

export function bindComposer(root, getDefaults = () => ({})) {
  const form = root.querySelector('.qa-form');
  if (!form) return;
  const input = form.querySelector('.qa-input');
  const chips = root.querySelector('.qa-chips');
  const hint = root.querySelector('.qa-hint');
  const show = () => {
    if (!input.value.trim()) ignored = new Set();
    const r = parseQuick(input.value, store.get().projects, ignored);
    const c = [];
    const chip = (kind, html, label) => c.push(`<button type="button" class="m chip-sm" data-ig="${esc(kind)}" aria-label="keep ${esc(label)} as text">${html}${icon('x', 12, 'chip-x')}</button>`);
    if (r.due) chip('due', `${icon('calendar', 13)}${fmtDate(r.due)}`, 'date');
    if (r.prio) chip('prio', `${icon('flag', 13)}${PRIO_LABEL[r.prio]}`, 'priority');
    const p = r.project && projectOf(r.project);
    if (p) chip('project', `<i class="dot" style="background:${p.color}"></i>${esc(p.name)}`, 'project');
    r.tags.forEach((t) => chip(`tag:${t}`, `#${esc(t)}`, 'tag'));
    if (r.repeat) chip('repeat', `${icon('repeat', 13)}${r.repeat}`, 'repeat');
    if (r.est) chip('est', `${icon('timer', 13)}${r.est}`, 'pomodoros');
    chips.hidden = !c.length;
    chips.innerHTML = c.join('');
    if (hint) hint.hidden = !!input.value;
  };
  input.addEventListener('input', show);
  show();
  chips.addEventListener('mousedown', (e) => e.preventDefault()); // keep the keyboard open
  chips.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ig]');
    if (!b) return;
    ignored.add(b.dataset.ig);
    show();
    input.focus();
  });
  form.querySelector('.qa-send').addEventListener('mousedown', (e) => e.preventDefault());
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return input.focus();
    const r = parseQuick(text, store.get().projects, ignored);
    const d = getDefaults();
    input.value = '';
    ignored = new Set();
    haptic(8);
    const t = store.addTask({
      title: r.title,
      due: r.due || d.due || null,
      prio: r.prio,
      tags: r.tags,
      project: r.project || d.project || null,
      repeat: r.repeat,
      est: r.est,
    });
    document.querySelector('[data-keep=qa]')?.focus();
    // briefly highlight the new row so it is easy to spot
    const row = document.querySelector(`.task[data-id="${t.id}"]`);
    if (row) {
      row.classList.add('fresh');
      row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } else toast(t.due ? `added for ${fmtDate(t.due).toLowerCase()}` : 'added to inbox');
  });
}

// ---------- task detail sheet ----------
const autosize = (ta) => {
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
};

export function openTask(id) {
  const t0 = store.getTask(id);
  const origTitle = t0?.title || '';
  if (!t0) return;
  const projects = store.get().projects;
  const seg = (name, items, cur) =>
    `<div class="seg" data-seg="${name}">${items.map(([v, l]) => `<button type="button" data-v="${v ?? ''}" class="${(cur ?? '') === (v ?? '') ? 'on' : ''}">${l}</button>`).join('')}</div>`;

  const rec = openSheet(
    `<div class="ts">
      <div class="ts-bar"><button type="button" class="btn ghost" data-close aria-label="back to the list">${icon('chevL', 18)} back</button></div>
      <div class="ts-head"><button class="check big p${t0.prio} ${t0.done ? 'on' : ''}" id="ts-check" aria-label="${t0.done ? 'mark as not done' : 'mark as done'}">${t0.done ? icon('check', 18) : ''}</button>
        <textarea id="ts-title" rows="1" placeholder="task name" enterkeyhint="done" aria-label="task name">${esc(t0.title)}</textarea></div>
      <textarea id="ts-notes" rows="1" placeholder="add notes…" aria-label="notes">${esc(t0.notes)}</textarea>

      <div class="lbl">When</div>
      <div class="chips" id="ts-when">
        <button type="button" class="chip" data-d="${todayStr()}">Today</button>
        <button type="button" class="chip" data-d="${addDays(todayStr(), 1)}">Tomorrow</button>
        <button type="button" class="chip" data-d="week">Next week</button>
        <button type="button" class="chip" data-d="">No date</button>
        <label class="chip date ${t0.due ? 'on' : ''}">${icon('calendar', 15)}<span id="ts-due-label">${t0.due ? fmtDate(t0.due) : 'Pick date'}</span><input type="date" id="ts-date" value="${t0.due || ''}" aria-label="pick a date"></label>
      </div>

      <div class="lbl">Priority</div>
      ${seg('prio', PRIO_LABEL.map((l, i) => [i, l]), t0.prio)}

      <div class="lbl">Project</div>
      <div class="chips" id="ts-proj">
        <button type="button" class="chip ${!t0.project ? 'on' : ''}" data-p="">Inbox</button>
        ${projects.map((p) => `<button type="button" class="chip ${t0.project === p.id ? 'on' : ''}" data-p="${p.id}"><i class="dot" style="background:${p.color}"></i>${esc(p.name)}</button>`).join('')}
      </div>

      <div class="lbl">Repeat</div>
      ${seg('repeat', REPEATS, t0.repeat)}

      <div class="lbl">Status</div>
      ${seg('status', [['todo', 'To do'], ['doing', 'Doing']], t0.status)}

      <div class="lbl">Pomodoros <span class="muted">${t0.pomos} done · ${t0.focusMin} min</span></div>
      <div class="stepper"><button type="button" data-est="-1" aria-label="Fewer">−</button><span id="ts-est">${t0.est}</span><button type="button" data-est="1" aria-label="More">+</button><span class="muted sm">planned</span></div>

      <div class="lbl">Tags</div>
      <input id="ts-tags" class="field" type="text" placeholder="work, urgent" value="${esc(t0.tags.join(', '))}" aria-label="tags">

      <div class="lbl">Subtasks</div>
      <div id="ts-subs"></div>
      <form id="ts-subform" class="subadd">${icon('plus', 16)}<input type="text" placeholder="add subtask" enterkeyhint="done" aria-label="add subtask"></form>

      <div class="ts-actions">
        ${t0.done ? '' : `<button class="btn primary grow" id="ts-start">${icon('play', 16)} Start focus</button>`}
        <button class="btn ghost danger-ink ${t0.done ? 'grow' : ''}" id="ts-del" aria-label="delete task">${icon('trash', 18)}${t0.done ? ' delete' : ''}</button>
      </div>
    </div>`,
    { onClose: () => onClose() }
  );

  // Save anything still being typed when the sheet closes (Back gesture, backdrop tap…).
  const onClose = () => {
    const t = cur();
    if (t) {
      const patch = {};
      if (!title.value.trim()) patch.title = origTitle.trim() ? origTitle : 'untitled'; // never leave a task without a name
      const tags = parseTags($('#ts-tags').value);
      if (tags.join() !== t.tags.join()) patch.tags = tags;
      const pendingSub = $('#ts-subform input').value.trim();
      if (pendingSub) patch.sub = [...t.sub, { id: uid(), t: pendingSub, d: false }];
      if (Object.keys(patch).length) store.updateTask(id, patch, true);
    }
    store.emit();
  };

  const $ = (s) => rec.body.querySelector(s);
  const cur = () => store.getTask(id);
  const set = (patch, silent = false) => store.updateTask(id, patch, silent);

  const title = $('#ts-title');
  const notes = $('#ts-notes');
  [title, notes].forEach(autosize);
  requestAnimationFrame(() => [title, notes].forEach(autosize));
  if (!t0.title) title.focus();
  title.addEventListener('input', () => (autosize(title), set({ title: title.value }, true)));
  title.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), title.blur()));
  notes.addEventListener('input', () => (autosize(notes), set({ notes: notes.value }, true)));

  $('#ts-check').onclick = () => {
    rec.close();
    toggleDone(id);
  };

  const markWhen = () => {
    const due = cur().due;
    const presets = { [todayStr()]: 1, [addDays(todayStr(), 1)]: 1, [nextMonday()]: 1 };
    rec.body.querySelectorAll('#ts-when .chip[data-d]').forEach((c) => {
      const d = c.dataset.d === 'week' ? nextMonday() : c.dataset.d || null;
      c.classList.toggle('on', d === due);
      c.setAttribute('aria-pressed', d === due);
    });
    const custom = !!due && !presets[due];
    $('#ts-when .date').classList.toggle('on', custom);
    $('#ts-due-label').textContent = custom ? fmtDate(due) : 'Pick date';
    $('#ts-date').value = due || '';
  };
  const setDue = (d) => (set({ due: d || null }, true), markWhen());
  markWhen();
  $('#ts-when').addEventListener('click', (e) => {
    const c = e.target.closest('.chip[data-d]');
    if (!c) return;
    setDue(c.dataset.d === 'week' ? nextMonday() : c.dataset.d);
  });
  $('#ts-date').addEventListener('change', (e) => setDue(e.target.value));

  rec.body.addEventListener('click', (e) => {
    const b = e.target.closest('.seg button');
    if (b) {
      const name = b.closest('.seg').dataset.seg;
      b.closest('.seg').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      if (name === 'prio') {
        set({ prio: Number(b.dataset.v) });
        $('#ts-check').className = `check big p${b.dataset.v} ${cur().done ? 'on' : ''}`;
      }
      if (name === 'repeat') set({ repeat: b.dataset.v || null });
      if (name === 'status') set({ status: b.dataset.v });
      return;
    }
    const pj = e.target.closest('#ts-proj .chip');
    if (pj) {
      rec.body.querySelectorAll('#ts-proj .chip').forEach((x) => x.classList.toggle('on', x === pj));
      set({ project: pj.dataset.p || null });
      return;
    }
    const est = e.target.closest('[data-est]');
    if (est) {
      const v = Math.max(0, Math.min(20, cur().est + Number(est.dataset.est)));
      set({ est: v });
      $('#ts-est').textContent = v;
    }
  });

  $('#ts-tags').addEventListener('input', (e) => set({ tags: parseTags(e.target.value) }, true));
  $('#ts-tags').addEventListener('change', (e) => {
    const tags = parseTags(e.target.value);
    set({ tags });
    e.target.value = tags.join(', ');
  });

  // subtasks
  const subs = $('#ts-subs');
  const renderSubs = () => {
    subs.innerHTML = cur()
      .sub.map(
        (s) => `<div class="sub ${s.d ? 'done' : ''}" data-s="${s.id}">
          <button type="button" class="check sm ${s.d ? 'on' : ''}" data-sa="tog" aria-label="${s.d ? 'mark subtask as not done' : 'mark subtask as done'}">${s.d ? icon('check', 12) : ''}</button>
          <input type="text" value="${esc(s.t)}" data-sa="edit" aria-label="subtask"><button type="button" class="icon-btn" data-sa="del" aria-label="remove subtask">${icon('x', 16)}</button></div>`
      )
      .join('');
  };
  renderSubs();
  const editSub = (sid, fn, rerender) => {
    const sub = cur().sub.map((s) => (s.id === sid ? fn(s) : s)).filter(Boolean);
    set({ sub }, !rerender);
    if (rerender) renderSubs();
  };
  subs.addEventListener('click', (e) => {
    const row = e.target.closest('.sub');
    const a = e.target.closest('[data-sa]')?.dataset.sa;
    if (!row) return;
    if (a === 'tog') editSub(row.dataset.s, (s) => ({ ...s, d: !s.d }), true);
    if (a === 'del') editSub(row.dataset.s, () => null, true);
  });
  subs.addEventListener('input', (e) => {
    const row = e.target.closest('.sub');
    if (row && e.target.dataset.sa === 'edit') editSub(row.dataset.s, (s) => ({ ...s, t: e.target.value }), false);
  });
  $('#ts-subform').addEventListener('submit', (e) => {
    e.preventDefault();
    const inp = e.target.querySelector('input');
    const text = inp.value.trim();
    if (!text) return;
    set({ sub: [...cur().sub, { id: uid(), t: text, d: false }] });
    inp.value = '';
    renderSubs();
    inp.focus();
  });

  const start = $('#ts-start');
  if (start)
    start.onclick = () => {
      rec.close();
      document.dispatchEvent(new CustomEvent('tempo:focus-task', { detail: id }));
    };
  // No "are you sure?" step: the toast offers undo instead, which is quicker and just as safe.
  $('#ts-del').onclick = () => {
    rec.close();
    deleteWithUndo(id);
  };
}

const parseTags = (v) => [...new Set(String(v).split(/[,\s]+/).map((x) => x.replace(/^#+/, '').toLowerCase()).filter(Boolean))];

// ---------- project sheet ----------
export const PROJECT_COLORS = ['#ff5d47', '#f2a31b', '#2fa56b', '#3e7bfa', '#8b5cf6', '#e0529c', '#14b8a6', '#8b8b93'];

export function openProject(id, onDone) {
  const p = id ? projectOf(id) : null;
  let color = p?.color || PROJECT_COLORS[Math.floor(Math.random() * 6)];
  const rec = openSheet(
    `<div class="ts"><h2 class="sh">${p ? 'Edit project' : 'New project'}</h2>
      <input id="pj-name" class="field big" type="text" placeholder="project name" aria-label="project name" value="${esc(p?.name || '')}" maxlength="30">
      <div class="lbl">Colour</div>
      <div class="swatches">${PROJECT_COLORS.map((c, i) => `<button type="button" class="sw ${c === color ? 'on' : ''}" data-c="${c}" style="background:${c}" aria-label="colour ${i + 1}" aria-pressed="${c === color}"></button>`).join('')}</div>
      <div class="ts-actions"><button class="btn primary grow" id="pj-save">${p ? 'Save' : 'Create project'}</button>${p ? `<button class="btn ghost danger-ink" id="pj-del" aria-label="delete project">${icon('trash', 18)}</button>` : ''}</div></div>`,
    { cls: 'small' }
  );
  const name = rec.body.querySelector('#pj-name');
  setTimeout(() => !p && name.focus(), 300);
  rec.body.querySelector('.swatches').addEventListener('click', (e) => {
    const b = e.target.closest('.sw');
    if (!b) return;
    color = b.dataset.c;
    rec.body.querySelectorAll('.sw').forEach((x) => x.classList.toggle('on', x === b));
  });
  const save = () => {
    const n = name.value.trim();
    if (!n) return name.focus();
    let pid = id;
    if (p) store.updateProject(id, { name: n, color });
    else pid = store.addProject(n, color).id;
    rec.close();
    onDone?.(pid);
  };
  rec.body.querySelector('#pj-save').onclick = save;
  name.addEventListener('keydown', (e) => e.key === 'Enter' && save());
  const del = rec.body.querySelector('#pj-del');
  if (del)
    del.onclick = () => {
      rec.close();
      const snap = store.deleteProject(id);
      onDone?.(null);
      if (snap) toast(`project deleted. its tasks moved to inbox`, { action: 'undo', onAction: () => store.restoreProject(snap) });
    };
}
