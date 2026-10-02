import * as store from './store.js';
import { taskRow, handleTaskClick, composer, bindComposer, openProject, projectOf, openTask } from './components.js';
import { icon } from './icons.js';
import { esc, todayStr, addDays, diffDays, fmtDate } from './util.js';

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

function board(all) {
  const cols = [
    ['todo', 'To do', all.filter((t) => !t.done && t.status !== 'doing').sort(byOrder)],
    ['doing', 'Doing', all.filter((t) => !t.done && t.status === 'doing').sort(byOrder)],
    ['done', 'Done', all.filter((t) => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)).slice(0, 30)],
  ];
  return `<div class="board">${cols
    .map(
      ([k, label, list]) => `<div class="col" data-col="${k}"><h3>${label}<span>${list.length}</span></h3>
      ${list
        .map((t) => {
          const p = projectOf(t.project);
          return `<div class="card-k ${t.done ? 'done' : ''}" data-id="${t.id}"><div class="ck-t" data-act="open">${esc(t.title)}</div>
          <div class="ck-m">${t.due ? `<span class="m ${!t.done && t.due < todayStr() ? 'late' : ''}">${fmtDate(t.due)}</span>` : ''}${p ? `<span class="m"><i class="dot" style="background:${p.color}"></i>${esc(p.name)}</span>` : ''}${t.prio ? `<span class="m p${t.prio}-f">${icon('flag', 12)}</span>` : ''}</div>
          <div class="ck-a">${k !== 'todo' ? `<button class="icon-btn" data-mv="${k === 'doing' ? 'todo' : 'doing'}" aria-label="Move left">${icon('chevL', 16)}</button>` : '<span></span>'}${k !== 'done' ? `<button class="icon-btn" data-mv="${k === 'todo' ? 'doing' : 'done'}" aria-label="Move right">${icon('chevR', 16)}</button>` : ''}</div></div>`;
        })
        .join('') || '<div class="col-empty">Nothing here</div>'}</div>`
    )
    .join('')}</div>`;
}

export function render(root) {
  const st = store.get();
  const scoped = st.tasks.filter(matches);
  const open = scoped.filter((t) => !t.done);
  const done = scoped.filter((t) => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  const curProject = projectOf(filter);

  const chip = (k, label, extra = '') => `<button class="chip ${filter === k ? 'on' : ''}" data-f="${k}">${extra}${label}</button>`;
  let body;
  if (view === 'board') body = board(scoped);
  else {
    const g = groups([...open]);
    body = Object.entries(g)
      .filter(([, l]) => l.length)
      .map(([label, l]) => `<section class="sec ${label === 'Overdue' ? 'late' : ''}"><h3>${label}<span>${l.length}</span></h3>${l.map((t) => taskRow(t, { showProject: !curProject })).join('')}</section>`)
      .join('');
    if (!open.length)
      body = `<div class="empty">${icon('tasks', 34)}<p>${search ? 'No tasks match your search.' : 'No open tasks here.'}</p><small>${search ? '' : 'Type one in the bar below.'}</small></div>`;
    if (done.length)
      body += `<section class="sec dim"><button class="h3btn" data-act="toggleDone"><h3>Completed<span>${done.length}</span></h3>${icon(showDone ? 'chevD' : 'chevR', 16)}</button>${showDone ? done.slice(0, 50).map((t) => taskRow(t, { showProject: !curProject })).join('') : ''}</section>`;
  }

  root.innerHTML = `
    <header class="top"><div><div class="eyebrow">${open.length} open</div><h1>Tasks</h1></div>
      <div class="top-btns"><button class="icon-btn ${searching ? 'on' : ''}" data-act="search" aria-label="Search">${icon('search', 21)}</button>
      <button class="icon-btn" data-act="view" aria-label="Switch view">${icon(view === 'list' ? 'board' : 'list', 21)}</button></div></header>
    ${searching ? `<input class="search" data-keep="search" type="search" placeholder="Search tasks, notes, #tags" value="${esc(search)}">` : ''}
    <div class="chips scroll" id="filters">${chip('all', 'All')}${chip('inbox', 'Inbox')}${st.projects.map((p) => chip(p.id, esc(p.name), `<i class="dot" style="background:${p.color}"></i>`)).join('')}<button class="chip add" data-act="newproj" aria-label="New project">${icon('plus', 15)}</button></div>
    ${curProject ? `<button class="proj-edit" data-act="editproj">${icon('more', 18)} Edit project</button>` : ''}
    ${body}
    ${composer({ placeholder: curProject ? `Add to ${curProject.name}…` : 'Add a task…' })}`;

  bindComposer(root, () => ({ project: curProject?.id || null }));
  const s = root.querySelector('.search');
  if (s) {
    s.addEventListener('input', () => {
      search = s.value;
      const pos = s.selectionStart;
      render(root);
      const n = root.querySelector('.search');
      n?.focus();
      n?.setSelectionRange(pos, pos);
    });
    if (!search && searching) setTimeout(() => s.focus(), 0);
  }

  root.onclick = (e) => {
    if (handleTaskClick(e, { onFocus: (id) => document.dispatchEvent(new CustomEvent('tempo:focus-task', { detail: id })) })) return;
    const mv = e.target.closest('[data-mv]');
    if (mv) {
      const id = mv.closest('.card-k').dataset.id;
      const to = mv.dataset.mv;
      return store.mutate((x) => {
        const t = x.tasks.find((k) => k.id === id);
        if (to === 'done') (t.done = true), (t.doneAt = Date.now()), (t.status = 'todo');
        else (t.done = false), (t.doneAt = null), (t.status = to);
      });
    }
    const f = e.target.closest('[data-f]');
    if (f) return (filter = f.dataset.f), render(root);
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (a === 'open') return openTask(e.target.closest('.card-k').dataset.id);
    if (a === 'view') return (view = view === 'list' ? 'board' : 'list'), render(root);
    if (a === 'search') return (searching = !searching), searching || (search = ''), render(root);
    if (a === 'toggleDone') return (showDone = !showDone), render(root);
    if (a === 'newproj') return openProject(null, (id) => id && ((filter = id), render(root)));
    if (a === 'editproj') return openProject(filter, (id) => ((filter = id || 'all'), render(root)));
  };
}
