import * as store from './store.js';
import { taskRow, handleTaskClick, composer, bindComposer } from './components.js';
import { icon } from './icons.js';
import { esc, todayStr, diffDays } from './util.js';

// UI state that should survive re-renders
let filter = 'all'; // all | personal | work
let search = '';
let searching = false;
let showDone = false;
let doneLimit = 50; // how many completed tasks are listed; "show more" raises it
let searchTimer = null; // pending (debounced) redraw of the list while typing in the search field

const matches = (t) => {
  if (filter !== 'all' && t.area !== filter) return false;
  if (!search) return true;
  const q = search.toLowerCase();
  return t.title.toLowerCase().includes(q) || t.notes.toLowerCase().includes(q) || t.tags.some((x) => String(x).toLowerCase().includes(q.replace(/^#/, '')));
};

const byOrder = (a, b) => ((a.due || '9999') < (b.due || '9999') ? -1 : (a.due || '9999') > (b.due || '9999') ? 1 : 0) || b.prio - a.prio || b.created - a.created;

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

// Everything below the filter chips. Re-drawn on its own while searching, so the search field
// (and the keyboard's word suggestions) is never replaced mid-word.
function bodyHtml() {
  const st = store.get();
  const scoped = st.tasks.filter(matches);
  const open = scoped.filter((t) => !t.done);
  const done = scoped.filter((t) => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  const g = groups([...open]);
  let body = Object.entries(g)
    .filter(([, l]) => l.length)
    .map(([label, l]) => `<section class="sec ${label === 'Overdue' ? 'late' : ''}"><h2>${label}<span>${l.length}</span></h2>${l.map((t) => taskRow(t, { showArea: filter === 'all' })).join('')}</section>`)
    .join('');
  if (!open.length)
    body = `<div class="empty">${icon('tasks', 34)}<p>${search ? 'no tasks match your search.' : done.length ? 'everything here is done.' : filter !== 'all' ? `no ${filter} tasks yet.` : 'no tasks yet.'}</p><small>${search ? 'try another word or a #tag.' : 'type one in the bar below.'}</small></div>`;
  if (done.length)
    body += `<section class="sec dim"><h2 class="hbtn"><button class="h3btn" data-act="toggleDone" aria-expanded="${showDone}">Completed<span>${done.length}</span>${icon(showDone ? 'chevD' : 'chevR', 16)}</button></h2>${showDone ? done.slice(0, doneLimit).map((t) => taskRow(t, { showArea: filter === 'all' })).join('') : ''}${showDone && done.length > doneLimit ? `<button class="chip" data-act="moreDone">show ${Math.min(50, done.length - doneLimit)} more</button>` : ''}</section>`;
  return { html: body, open: open.length };
}

export function render(root) {
  clearTimeout(searchTimer); // a redraw from an older render must not land on this one
  const body = bodyHtml();

  const chip = (k, label, extra = '') => `<button class="chip ${filter === k ? 'on' : ''}" data-f="${k}" aria-pressed="${filter === k}">${extra}${label}</button>`;

  root.innerHTML = `
    <header class="top"><div><div class="eyebrow" id="tasks-count">${body.open} open</div><h1>Tasks</h1></div>
      <div class="top-btns"><button class="icon-btn ${searching ? 'on' : ''}" data-act="search" aria-label="search tasks" aria-pressed="${searching}">${icon('search', 21)}</button>
</div></header>
    ${searching ? `<input class="search" data-keep="search" type="search" placeholder="search tasks, notes, #tags" aria-label="search tasks" value="${esc(search)}">` : ''}
    <div class="chips scroll" id="filters">${chip('all', 'all')}${chip('personal', 'personal')}${chip('work', 'work')}</div>
    <div class="tasks-body">${body.html}</div>
    ${composer({ placeholder: filter !== 'all' ? `add a ${filter} task…` : 'add a task…' })}`;

  bindComposer(root, () => ({ area: filter !== 'all' ? filter : null }));
  const s = root.querySelector('.search');
  if (s) {
    // the query updates at once (so a re-render never loses it); only the list redraw is delayed
    const update = () => {
      search = s.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
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
    if (handleTaskClick(e, { onFocus: (id) => document.dispatchEvent(new CustomEvent('tempo:focus-task', { detail: id })) })) return;
    const f = e.target.closest('[data-f]');
    if (f) return (filter = f.dataset.f), render(root);
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (a === 'search') return (searching = !searching), searching || (search = ''), render(root);
    if (a === 'toggleDone') return (showDone = !showDone), (doneLimit = 50), render(root);
    if (a === 'moreDone') return (doneLimit += 50), render(root);
  };
}
