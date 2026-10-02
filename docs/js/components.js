// Pieces shared by Today and Tasks: task rows, quick-add composer, task detail sheet.
import * as store from './store.js';
import { parseQuick } from './parse.js';
import { openSheet, confirmDialog, toast } from './ui.js';
import { icon } from './icons.js';
import { esc, fmtDate, todayStr, addDays, parseYmd, haptic } from './util.js';

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
  return `<div class="task ${t.done ? 'done' : ''}" data-id="${t.id}">
    <button class="check p${t.prio}" data-act="toggle" aria-label="${t.done ? 'Mark as not done' : 'Mark as done'}">${t.done ? icon('check', 15) : ''}</button>
    <div class="t-main" data-act="open"><div class="t-title">${esc(t.title)}</div>${meta.length ? `<div class="t-meta">${meta.join('')}</div>` : ''}</div>
    ${t.done ? '' : `<button class="icon-btn t-play" data-act="focus" aria-label="Focus on this task">${icon('play', 16)}</button>`}
  </div>`;
}

// Shared click handling for lists of task rows. Returns true if it handled the event.
export function handleTaskClick(e, { onFocus } = {}) {
  const el = e.target.closest('[data-act]');
  const row = e.target.closest('.task');
  if (!el || !row) return false;
  const id = row.dataset.id;
  const t = store.getTask(id);
  if (!t) return false;
  if (el.dataset.act === 'toggle') {
    haptic();
    const done = !t.done;
    row.classList.toggle('done', done);
    el.classList.toggle('pop', done);
    setTimeout(() => store.setDone(id, done), done ? 300 : 0);
    if (done) toast('Task completed', { action: 'Undo', onAction: () => store.setDone(id, false) });
    return true;
  }
  if (el.dataset.act === 'open') return openTask(id), true;
  if (el.dataset.act === 'focus') return onFocus?.(id), true;
  return false;
}

// ---------- quick-add composer ----------
export function composer({ placeholder = 'Add a task…', hint = true } = {}) {
  return `<div class="composer">
    <div class="qa-chips" hidden></div>
    <form class="qa-form" autocomplete="off">
      <input class="qa-input" data-keep="qa" type="text" enterkeyhint="done" placeholder="${esc(placeholder)}" aria-label="New task">
      <button class="qa-send" type="submit" aria-label="Add task">${icon('plus', 22)}</button>
    </form>
    ${hint ? `<div class="qa-hint">Try: <b>gym tomorrow !1 #health *2</b></div>` : ''}
  </div>`;
}

export function bindComposer(root, getDefaults = () => ({})) {
  const form = root.querySelector('.qa-form');
  if (!form) return;
  const input = form.querySelector('.qa-input');
  const chips = root.querySelector('.qa-chips');
  const hint = root.querySelector('.qa-hint');
  const show = () => {
    const r = parseQuick(input.value, store.get().projects);
    const c = [];
    if (r.due) c.push(`${icon('calendar', 13)}${fmtDate(r.due)}`);
    if (r.prio) c.push(`${icon('flag', 13)}${PRIO_LABEL[r.prio]}`);
    if (r.project) c.push(`<i class="dot" style="background:${projectOf(r.project).color}"></i>${esc(projectOf(r.project).name)}`);
    r.tags.forEach((t) => c.push(`#${esc(t)}`));
    if (r.repeat) c.push(`${icon('repeat', 13)}${r.repeat}`);
    if (r.est) c.push(`${icon('timer', 13)}${r.est}`);
    chips.hidden = !c.length;
    chips.innerHTML = c.map((x) => `<span class="m chip-sm">${x}</span>`).join('');
    if (hint) hint.hidden = !!input.value;
  };
  input.addEventListener('input', show);
  show();
  form.querySelector('.qa-send').addEventListener('mousedown', (e) => e.preventDefault());
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    const r = parseQuick(text, store.get().projects);
    const d = getDefaults();
    input.value = '';
    haptic(8);
    store.addTask({
      title: r.title,
      due: r.due || d.due || null,
      prio: r.prio,
      tags: r.tags,
      project: r.project || d.project || null,
      repeat: r.repeat,
      est: r.est,
    });
    document.querySelector('[data-keep=qa]')?.focus();
  });
}

// ---------- task detail sheet ----------
const autosize = (ta) => {
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
};

export function openTask(id) {
  const t0 = store.getTask(id);
  if (!t0) return;
  const projects = store.get().projects;
  const seg = (name, items, cur) =>
    `<div class="seg" data-seg="${name}">${items.map(([v, l]) => `<button type="button" data-v="${v ?? ''}" class="${(cur ?? '') === (v ?? '') ? 'on' : ''}">${l}</button>`).join('')}</div>`;

  const rec = openSheet(
    `<div class="ts">
      <div class="ts-head"><button class="check big p${t0.prio} ${t0.done ? 'on' : ''}" id="ts-check" aria-label="Done">${t0.done ? icon('check', 18) : ''}</button>
        <textarea id="ts-title" rows="1" placeholder="Task name" enterkeyhint="done">${esc(t0.title)}</textarea></div>
      <textarea id="ts-notes" rows="1" placeholder="Add notes…">${esc(t0.notes)}</textarea>

      <div class="lbl">When</div>
      <div class="chips" id="ts-when">
        <button type="button" class="chip" data-d="${todayStr()}">Today</button>
        <button type="button" class="chip" data-d="${addDays(todayStr(), 1)}">Tomorrow</button>
        <button type="button" class="chip" data-d="week">Next week</button>
        <button type="button" class="chip" data-d="">No date</button>
        <label class="chip date ${t0.due ? 'on' : ''}">${icon('calendar', 15)}<span id="ts-due-label">${t0.due ? fmtDate(t0.due) : 'Pick date'}</span><input type="date" id="ts-date" value="${t0.due || ''}"></label>
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
      <input id="ts-tags" class="field" type="text" placeholder="work, urgent" value="${esc(t0.tags.join(', '))}">

      <div class="lbl">Subtasks</div>
      <div id="ts-subs"></div>
      <form id="ts-subform" class="subadd">${icon('plus', 16)}<input type="text" placeholder="Add subtask" enterkeyhint="done"></form>

      <div class="ts-actions">
        <button class="btn primary grow" id="ts-start">${icon('play', 16)} Start focus</button>
        <button class="btn ghost danger-ink" id="ts-del" aria-label="Delete">${icon('trash', 18)}</button>
      </div>
    </div>`,
    { onClose: () => store.emit() }
  );

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
    const done = !cur().done;
    store.setDone(id, done);
    rec.close();
  };

  const markWhen = () => {
    const due = cur().due;
    rec.body.querySelectorAll('#ts-when .chip[data-d]').forEach((c) => {
      const d = c.dataset.d === 'week' ? null : c.dataset.d;
      c.classList.toggle('on', d !== null ? (d || null) === due : false);
    });
    const preset = due && [todayStr(), addDays(todayStr(), 1)].includes(due);
    $('#ts-when .date').classList.toggle('on', !!due && !preset);
    $('#ts-due-label').textContent = due ? fmtDate(due) : 'Pick date';
    $('#ts-date').value = due || '';
  };
  const setDue = (d) => (set({ due: d || null }), markWhen());
  markWhen();
  $('#ts-when').addEventListener('click', (e) => {
    const c = e.target.closest('.chip[data-d]');
    if (!c) return;
    if (c.dataset.d === 'week') {
      const d = parseYmd(todayStr());
      setDue(addDays(todayStr(), ((8 - d.getDay()) % 7) || 7));
    } else setDue(c.dataset.d);
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

  $('#ts-tags').addEventListener('change', (e) => {
    const tags = [...new Set(e.target.value.split(/[,\s]+/).map((x) => x.replace(/^#/, '').toLowerCase()).filter(Boolean))];
    set({ tags });
    e.target.value = tags.join(', ');
  });

  // subtasks
  const subs = $('#ts-subs');
  const renderSubs = () => {
    subs.innerHTML = cur()
      .sub.map(
        (s) => `<div class="sub ${s.d ? 'done' : ''}" data-s="${s.id}">
          <button type="button" class="check sm ${s.d ? 'on' : ''}" data-sa="tog">${s.d ? icon('check', 12) : ''}</button>
          <input type="text" value="${esc(s.t)}" data-sa="edit"><button type="button" class="icon-btn" data-sa="del" aria-label="Remove">${icon('x', 16)}</button></div>`
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
    set({ sub: [...cur().sub, { id: Math.random().toString(36).slice(2, 8), t: text, d: false }] });
    inp.value = '';
    renderSubs();
    inp.focus();
  });

  $('#ts-start').onclick = () => {
    rec.close();
    document.dispatchEvent(new CustomEvent('tempo:focus-task', { detail: id }));
  };
  $('#ts-del').onclick = async () => {
    if (!(await confirmDialog(`“${cur().title || 'Untitled'}” will be deleted.`, { title: 'Delete task?' }))) return;
    const copy = { ...cur() };
    rec.close();
    store.deleteTask(id);
    toast('Task deleted', { action: 'Undo', onAction: () => store.mutate((s) => s.tasks.unshift(copy)) });
  };
}

// ---------- project sheet ----------
export const PROJECT_COLORS = ['#ff5d47', '#f2a31b', '#2fa56b', '#3e7bfa', '#8b5cf6', '#e0529c', '#14b8a6', '#8b8b93'];

export function openProject(id, onDone) {
  const p = id ? projectOf(id) : null;
  let color = p?.color || PROJECT_COLORS[Math.floor(Math.random() * 6)];
  const rec = openSheet(
    `<div class="ts"><h2 class="sh">${p ? 'Edit project' : 'New project'}</h2>
      <input id="pj-name" class="field big" type="text" placeholder="Project name" value="${esc(p?.name || '')}" maxlength="30">
      <div class="lbl">Colour</div>
      <div class="swatches">${PROJECT_COLORS.map((c) => `<button type="button" class="sw ${c === color ? 'on' : ''}" data-c="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}</div>
      <div class="ts-actions"><button class="btn primary grow" id="pj-save">${p ? 'Save' : 'Create project'}</button>${p ? `<button class="btn ghost danger-ink" id="pj-del" aria-label="Delete">${icon('trash', 18)}</button>` : ''}</div></div>`,
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
    del.onclick = async () => {
      if (!(await confirmDialog('Its tasks will move to your Inbox.', { title: `Delete “${p.name}”?` }))) return;
      rec.close();
      store.deleteProject(id);
      onDone?.(null);
    };
}
