import * as store from './store.js';
import { taskRow, handleTaskClick, composer, bindComposer, openProject, projectOf, openTask, toggleDone, prioMark } from './components.js';
import { icon } from './icons.js';
import { esc, todayStr, diffDays, fmtDate } from './util.js';

// UI state that should survive re-renders
let view = 'list'; // list | board
let filter = 'all'; // all | inbox | <projectId>
let search = '';
let searching = false;
let showDone = false;

const matches = (t) => {
  if (filter === 'inbox' && t.project) return false;
  if (filter !== 'all' && filter !== 'inbox' && t.project !== filter) return false;
  if (!search) return true;
  const q = search.toLowerCase();
  return t.title.toLowerCase().includes(q) || t.notes.toLowerCase().includes(q) || t.tags.some((x) => x.includes(q.replace(/^#/, '')));
};

const byOrder = (a, b) => (a.due || '9999').localeCompare(b.due || '9999') || b.prio - a.prio || b.created - a.created;

function groups(open) {
  const today = todayStr();
  const g = { Overdue: [], Today: [], Tomorrow: [], 'This week': [], Later: [], 'No date': [] };
  for (const t of open.sort(byOrder)) {
    if (!t.due) g['No date'].push(t);
    else {
      const d = diffDays(t.due, today);
      (d < 0 ? g.Overdue : d === 0 ? g.Today : d === 1 ? g.Tomorrow : d < 7 ? g['This week'] : g.Later).push(t);
    }
  }
  return g;
}

const COLS = { todo: 'to do', doing: 'doing', done: 'done' };

function board(all) {
  const today = todayStr();
  const cols = [
    ['todo', all.filter((t) => !t.done && t.status !== 'doing').sort(byOrder)],
    ['doing', all.filter((t) => !t.done && t.status === 'doing').sort(byOrder)],
    ['done', all.filter((t) => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)).slice(0, 30)],
  ];
  const mv = (to, back) =>
    `<button type="button" class="ck-mv ${back ? 'back' : ''}" data-mv="${to}" aria-label="move to ${COLS[to]}">${back ? `${icon('chevL', 15)}${COLS[to]}` : `${COLS[to]}${icon('chevR', 15)}`}</button>`;
  return `<div class="board">${cols
    .map(
      ([k, list]) => `<section class="col" data-col="${k}" aria-label="${COLS[k]}"><h2>${COLS[k]}<span>${list.length}</span></h2>
      ${list
        .map((t) => {
          const p = projectOf(t.project);
          const cls = t.due && !t.done ? (t.due < today ? 'late' : t.due === today ? 'today' : '') : '';
          return `<div class="card-k ${t.done ? 'done' : ''}" data-id="${t.id}"><button type="button" class="ck-t" data-act="open">${esc(t.title) || '<span class="muted">untitled</span>'}</button>
          <div class="ck-m">${prioMark(t.prio)}${t.due ? `<span class="m ${cls}">${fmtDate(t.due)}</span>` : ''}${p ? `<span class="m"><i class="dot" style="background:${p.color}"></i>${esc(p.name)}</span>` : ''}</div>
          <div class="ck-a">${k !== 'todo' ? mv(k === 'doing' ? 'todo' : 'doing', true) : '<span></span>'}${k !== 'done' ? mv(k === 'todo' ? 'doing' : 'done', false) : ''}</div></div>`;
        })
        .join('') || '<div class="col-empty">nothing here</div>'}</section>`
    )
    .join('')}</div>`;
}

// Everything below the filter chips. Re-drawn on its own while searching, so the search field
// (and the keyboard's word suggestions) is never replaced mid-word.
function bodyHtml() {
  const st = store.get();
  const scoped = st.tasks.filter(matches);
  const open = scoped.filter((t) => !t.done);
  const done = scoped.filter((t) => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  const curProject = projectOf(filter);
  if (view === 'board') return { html: board(scoped), open: open.length };
  const g = groups([...open]);
  let body = Object.entries(g)
    .filter(([, l]) => l.length)
    .map(([label, l]) => `<section class="sec ${label === 'Overdue' ? 'late' : ''}"><h2>${label}<span>${l.length}</span></h2>${l.map((t) => taskRow(t, { showProject: !curProject })).join('')}</section>`)
    .join('');
  if (!open.length)
    body = `<div class="empty">${icon('tasks', 34)}<p>${search ? 'no tasks match your search.' : done.length ? 'everything here is done.' : curProject ? `no tasks in ${esc(curProject.name)} yet.` : filter === 'inbox' ? 'nothing in your inbox (tasks without a project).' : 'no tasks yet.'}</p><small>${search ? 'try another word or a #tag.' : 'type one in the bar below.'}</small></div>`;
  if (done.length)
    body += `<section class="sec dim"><h2 class="hbtn"><button class="h3btn" data-act="toggleDone" aria-expanded="${showDone}">Completed<span>${done.length}</span>${icon(showDone ? 'chevD' : 'chevR', 16)}</button></h2>${showDone ? done.slice(0, 50).map((t) => taskRow(t, { showProject: !curProject })).join('') : ''}</section>`;
  return { html: body, open: open.length };
}

export function render(root) {
  const st = store.get();
  if (filter !== 'all' && filter !== 'inbox' && !projectOf(filter)) filter = 'all'; // project was deleted
  const curProject = projectOf(filter);
  const body = bodyHtml();

  const chip = (k, label, extra = '') => `<button class="chip ${filter === k ? 'on' : ''}" data-f="${k}" aria-pressed="${filter === k}">${extra}${label}</button>`;
  const vbtn = (k) => `<button type="button" data-view="${k}" class="${view === k ? 'on' : ''}" aria-pressed="${view === k}">${k}</button>`;

  root.innerHTML = `
    <header class="top"><div><div class="eyebrow" id="tasks-count">${body.open} open</div><h1>Tasks</h1></div>
      <div class="top-btns"><button class="icon-btn ${searching ? 'on' : ''}" data-act="search" aria-label="search tasks" aria-pressed="${searching}">${icon('search', 21)}</button>
      <div class="seg view-seg" role="group" aria-label="show tasks as">${vbtn('list')}${vbtn('board')}</div></div></header>
    ${searching ? `<input class="search" data-keep="search" type="search" placeholder="search tasks, notes, #tags" aria-label="search tasks" value="${esc(search)}">` : ''}
    <div class="chips scroll" id="filters">${chip('all', 'All')}${chip('inbox', 'Inbox')}${st.projects.map((p) => chip(p.id, esc(p.name), `<i class="dot" style="background:${p.color}"></i>`)).join('')}<button class="chip add" data-act="newproj" aria-label="new project">${icon('plus', 15)}</button></div>
    ${curProject ? `<button class="proj-edit" data-act="editproj">${icon('more', 18)} edit project</button>` : ''}
    <div class="tasks-body">${body.html}</div>
    ${composer({ placeholder: curProject ? `add to ${curProject.name}…` : filter === 'inbox' ? 'add to inbox…' : 'add a task…' })}`;

  bindComposer(root, () => ({ project: curProject?.id || null }));
  const s = root.querySelector('.search');
  if (s) {
    let t = null;
    const update = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        if (search === s.value) return;
        search = s.value;
        const b = bodyHtml();
        const host = root.querySelector('.tasks-body');
        if (!host) return;
        host.innerHTML = b.html;
        const c = root.querySelector('#tasks-count');
        if (c) c.textContent = `${b.open} open`;
      }, 120);
    };
    s.addEventListener('input', (e) => !e.isComposing && update());
    s.addEventListener('compositionend', update);
    if (!search && searching) setTimeout(() => s.focus(), 0);
  }

  root.onclick = (e) => {
    // the end of a long-press on a board card (the quick-actions sheet is already open)
    const held = e.target.closest('.card-k[data-held]');
    if (held) return delete held.dataset.held;
    if (handleTaskClick(e, { onFocus: (id) => document.dispatchEvent(new CustomEvent('tempo:focus-task', { detail: id })) })) return;
    const mv = e.target.closest('[data-mv]');
    if (mv) {
      const id = mv.closest('.card-k').dataset.id;
      const to = mv.dataset.mv;
      const t = store.getTask(id);
      if (!t) return;
      // go through setDone so repeating tasks schedule their next copy (and undo works)
      if (to === 'done') return toggleDone(id);
      if (t.done) store.setDone(id, false);
      return store.updateTask(id, { status: to });
    }
    const f = e.target.closest('[data-f]');
    if (f) return (filter = f.dataset.f), render(root);
    const v = e.target.closest('[data-view]');
    if (v) return v.dataset.view !== view && ((view = v.dataset.view), render(root));
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (a === 'open') return openTask(e.target.closest('.card-k').dataset.id);
    if (a === 'search') return (searching = !searching), searching || (search = ''), render(root);
    if (a === 'toggleDone') return (showDone = !showDone), render(root);
    if (a === 'newproj') return openProject(null, (id) => id && ((filter = id), render(root)));
    if (a === 'editproj') return openProject(filter, (id) => ((filter = id || 'all'), render(root)));
  };
}
