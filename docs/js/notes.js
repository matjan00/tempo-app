// Notes tab: a list of Notion-like pages + a block editor (full-screen layer).
import { icon } from './icons.js';
import { esc, timeAgo, uid } from './util.js';
import * as store from './store.js';
import * as ui from './ui.js';

// ---------------------------------------------------------------- constants
const TYPES = [
  { t: 'p', label: 'Text', ic: null, txt: 'T', kw: 'text paragraph plain p' },
  { t: 'h1', label: 'Heading 1', ic: null, txt: 'H1', kw: 'heading title h1 big' },
  { t: 'h2', label: 'Heading 2', ic: null, txt: 'H2', kw: 'heading subtitle h2' },
  { t: 'bullet', label: 'Bulleted list', ic: 'bullet', kw: 'bullet list ul' },
  { t: 'num', label: 'Numbered list', ic: 'numbered', kw: 'number numbered list ol' },
  { t: 'todo', label: 'To-do', ic: 'todo', kw: 'todo task check checkbox' },
  { t: 'quote', label: 'Quote', ic: 'quote', kw: 'quote cite' },
  { t: 'divider', label: 'Divider', ic: 'minus', kw: 'divider line separator hr' },
];
const PH = { p: "type '/' for blocks", h1: 'heading 1', h2: 'heading 2', bullet: 'list', num: 'list', todo: 'to-do', quote: 'quote' };
const LISTY = ['bullet', 'num', 'todo', 'quote'];

const EMOJIS = ['📄', '📝', '📓', '📔', '📚', '📖', '🗒️', '📋', '📌', '💡', '🎯', '✅', '🚀', '⭐', '🔥', '🌱', '🌿', '☀️', '🌙', '🏠', '💼', '🧠', '🎨', '🎧', '🎬', '✈️', '🍳', '🏋️', '🏃', '💰', '🛒', '📅', '⏰', '🔑', '🧩', '🧪', '💻', '📱', '🎁', '❤️', '😀', '🤔', '👋', '🙏', '🐶', '🐱', '🌍', '🏆'];

const b = (type, text = '') => store.newBlock(type, text);
const TEMPLATES = [
  { name: 'Blank', icon: '📄', title: '', blocks: () => [b('p')] },
  {
    name: 'Meeting notes',
    icon: '🗒️',
    title: 'Meeting notes',
    blocks: () => [
      b('p', 'Date: '),
      b('p', 'Attendees: '),
      b('h2', 'Agenda'),
      b('bullet'),
      b('h2', 'Notes'),
      b('p'),
      b('h2', 'Action items'),
      b('todo'),
    ],
  },
  {
    name: 'Weekly plan',
    icon: '📅',
    title: 'Weekly plan',
    blocks: () => [
      b('h2', 'Top 3 priorities'),
      b('todo'),
      b('todo'),
      b('todo'),
      b('h2', 'Monday'),
      b('bullet'),
      b('h2', 'Tuesday'),
      b('bullet'),
      b('h2', 'Wednesday'),
      b('bullet'),
      b('h2', 'Thursday'),
      b('bullet'),
      b('h2', 'Friday'),
      b('bullet'),
      b('h2', 'Review'),
      b('p', 'What went well, what to change next week?'),
    ],
  },
  {
    name: 'Project brief',
    icon: '🎯',
    title: 'Project brief',
    blocks: () => [
      b('h2', 'Goal'),
      b('p'),
      b('h2', 'Why it matters'),
      b('p'),
      b('h2', 'Scope'),
      b('bullet'),
      b('h2', 'Milestones'),
      b('todo'),
      b('todo'),
      b('h2', 'Risks'),
      b('bullet'),
    ],
  },
  {
    name: 'Reading list',
    icon: '📚',
    title: 'Reading list',
    blocks: () => [b('h2', 'To read'), b('todo'), b('todo'), b('h2', 'Reading now'), b('bullet'), b('h2', 'Favourite quotes'), b('quote')],
  },
];

// ---------------------------------------------------------------- list screen
let q = '';

const firstText = (pg) => {
  const bl = pg.blocks.find((x) => x.type !== 'divider' && x.text.trim());
  return bl ? bl.text.trim().slice(0, 140) : '';
};

function rowHtml(pg) {
  const snip = firstText(pg);
  return `<button class="notes-row" data-act="open" data-id="${pg.id}">
    <span class="notes-ico">${esc(pg.icon || '📄')}</span>
    <span class="notes-main">
      <span class="notes-title">${pg.title.trim() ? esc(pg.title) : 'untitled'}</span>
      <span class="notes-snip">${snip ? esc(snip) : '<i>empty</i>'}</span>
    </span>
    <span class="notes-time">${pg.pinned ? icon('pin', 13) : ''}${esc(timeAgo(pg.updated))}</span>
  </button>`;
}

function listHtml() {
  const all = store.get().pages;
  if (!all.length)
    return `<div class="empty"><div class="notes-empty-ic">${icon('notes', 34)}</div><h3>No notes yet</h3><p>Capture ideas, plans and lists in pages that work like Notion.</p><button class="btn primary" data-act="new">New page</button></div>`;
  const needle = q.trim().toLowerCase();
  let pages = [...all].sort((a, c) => c.updated - a.updated);
  if (needle)
    pages = pages.filter((p) => p.title.toLowerCase().includes(needle) || p.blocks.some((x) => x.text.toLowerCase().includes(needle)));
  if (!pages.length) return `<div class="empty"><p>No notes match “<span class="keep">${esc(q.trim())}</span>”.</p><small>Search looks in titles and text.</small></div>`;
  const pinned = pages.filter((p) => p.pinned);
  const rest = pages.filter((p) => !p.pinned);
  let out = '';
  if (pinned.length) out += `<div class="notes-sec">Pinned</div><div class="notes-card">${pinned.map(rowHtml).join('')}</div>`;
  if (rest.length) out += `<div class="notes-sec">${pinned.length ? 'Recent' : needle ? 'Results' : 'Recent'}</div><div class="notes-card">${rest.map(rowHtml).join('')}</div>`;
  return out;
}

export function render(root) {
  const n = store.get().pages.length;
  root.innerHTML = `<header class="top"><div><div class="eyebrow">${n} ${n === 1 ? 'page' : 'pages'}</div><h1>Notes</h1></div>
      <button class="icon-btn" data-act="new" aria-label="new page">${icon('plus', 22)}</button></header>
    <label class="notes-search">${icon('search', 18)}<input type="search" data-q data-keep="notesq" placeholder="search notes" aria-label="search notes" value="${esc(q)}" autocomplete="off" enterkeyhint="search"></label>
    <div class="notes-list">${listHtml()}</div>`;

  root.oninput = (e) => {
    if (!e.target.matches('[data-q]')) return;
    q = e.target.value;
    root.querySelector('.notes-list').innerHTML = listHtml();
  };
  root.onclick = (e) => {
    const a = e.target.closest('[data-act]');
    if (!a) return;
    if (a.dataset.act === 'open') openPage(a.dataset.id);
    else if (a.dataset.act === 'new') templateSheet();
  };
}

function templateSheet() {
  const rec = ui.openSheet(
    `${ui.sheetHeader('New page', ui.closeBtn())}
     <div class="notes-tpls">${TEMPLATES.map(
       (t, i) => `<button class="notes-tpl" data-i="${i}"><span class="notes-ico">${t.icon}</span><span>${esc(t.name)}</span></button>`
     ).join('')}</div>`
  );
  rec.body.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) return rec.close();
    const t = e.target.closest('[data-i]');
    if (!t) return;
    const tpl = TEMPLATES[+t.dataset.i];
    const page = store.addPage({ title: tpl.title, icon: tpl.icon, blocks: tpl.blocks() });
    rec.close();
    openPage(page.id);
  });
}

// ---------------------------------------------------------------- caret helpers
// Offsets are measured in characters of the block's text (the contenteditable only ever contains plain text).
function selOffsets(el) {
  const s = getSelection();
  if (!s || !s.rangeCount) return null;
  const r = s.getRangeAt(0);
  if (!el.contains(r.startContainer) || !el.contains(r.endContainer)) return null;
  const pre = document.createRange();
  pre.selectNodeContents(el);
  pre.setEnd(r.startContainer, r.startOffset);
  const start = pre.toString().length;
  return { start, end: start + r.toString().length };
}
const caretOffset = (el) => selOffsets(el)?.start ?? null;

function setCaret(el, off = 'end') {
  el.focus({ preventScroll: true });
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  const r = document.createRange();
  if (!nodes.length) r.setStart(el, 0);
  else {
    let rem = off === 'end' ? Infinity : Math.max(0, off);
    let placed = false;
    for (const n of nodes) {
      if (rem <= n.nodeValue.length) {
        r.setStart(n, rem);
        placed = true;
        break;
      }
      rem -= n.nodeValue.length;
    }
    if (!placed) {
      const last = nodes[nodes.length - 1];
      r.setStart(last, last.nodeValue.length);
    }
  }
  r.collapse(true);
  const s = getSelection();
  s.removeAllRanges();
  s.addRange(r);
}

// ---------------------------------------------------------------- markdown shortcuts
const MD = [
  [/^[-*]\s\[( |x|X)?\]\s/, 'todo'],
  [/^\[( |x|X)?\]\s/, 'todo'],
  [/^##\s/, 'h2'],
  [/^#\s/, 'h1'],
  [/^[-*•]\s/, 'bullet'],
  [/^\d+[.)]\s/, 'num'],
  [/^>\s/, 'quote'],
];
function parseMd(text) {
  for (const [re, type] of MD) {
    const m = text.match(re);
    if (m) return { type, len: m[0].length, text: text.slice(m[0].length), done: type === 'todo' && /x/i.test(m[1] || '') };
  }
  return null;
}

// ---------------------------------------------------------------- editor
export function openPage(id) {
  const page = store.getPage(id);
  if (!page) return;
  if (!page.blocks.length) page.blocks.push(b('p'));

  const rec = ui.openSheet(
    `<div class="pg">
      <div class="pg-bar">
        <button class="icon-btn" data-act="back" aria-label="back to notes">${icon('chevL', 22)}</button>
        <span class="pg-grow"></span>
        <button class="icon-btn pg-pin" data-act="pin" aria-label="pin page">${icon('pin', 21)}</button>
        <button class="icon-btn" data-act="more" aria-label="page options">${icon('more', 22)}</button>
      </div>
      <div class="pg-scroll">
        <div class="pg-inner">
          <button class="pg-emoji" data-act="emoji" aria-label="change page icon">${esc(page.icon || '📄')}</button>
          <textarea class="pg-title" rows="1" placeholder="untitled" enterkeyhint="next" spellcheck="true" aria-label="page title"></textarea>
          <div class="pg-blocks" role="group" aria-label="page content"></div>
          <div class="pg-tail" data-act="tail"></div>
        </div>
      </div>
      <div class="pg-dock">
        <div class="pg-slash" hidden></div>
        <div class="pg-tools">
          ${TYPES.map((t) => `<button class="pg-tool" data-t="${t.t}" aria-label="${t.label}">${t.ic ? icon(t.ic, 19) : `<b>${t.txt}</b>`}</button>`).join('')}
          <span class="pg-sep"></span>
          <button class="pg-tool" data-a="up" aria-label="move block up">${icon('up', 19)}</button>
          <button class="pg-tool" data-a="down" aria-label="move block down">${icon('down', 19)}</button>
          <button class="pg-tool pg-danger" data-a="del" aria-label="delete block">${icon('trash', 19)}</button>
        </div>
      </div>
    </div>`,
    { full: true, cls: 'pg-layer', onClose: () => cleanup() }
  );

  const pg = rec.body.querySelector('.pg');
  const titleEl = pg.querySelector('.pg-title');
  const blocksEl = pg.querySelector('.pg-blocks');
  const dock = pg.querySelector('.pg-dock');
  const slashEl = pg.querySelector('.pg-slash');
  const pinBtn = pg.querySelector('.pg-pin');
  const emojiBtn = pg.querySelector('.pg-emoji');
  let cur = null; // id of the block the toolbar acts on
  let divSel = false; // a divider is the "current" block
  let slashItems = [];
  let dockTimer;

  const m = (fn) => store.mutate(fn, true); // silent: no re-render of the list screen
  const touch = () => (page.updated = Date.now());
  const idx = (bid) => page.blocks.findIndex((x) => x.id === bid);
  const blk = (bid) => page.blocks[idx(bid)];
  const blockEl = (bid) => blocksEl.querySelector(`.blk[data-id="${bid}"]`);
  const txtEl = (bid) => blockEl(bid)?.querySelector('.txt') || null;
  const curTxt = () => (cur ? txtEl(cur) : null);

  // ---- rendering
  function blockHtml(bl, n) {
    if (bl.type === 'divider') return `<div class="blk blk-divider" data-id="${bl.id}" data-type="divider"><hr></div>`;
    let lead = '';
    if (bl.type === 'bullet') lead = '<span class="blk-mark" contenteditable="false">•</span>';
    else if (bl.type === 'num') lead = `<span class="blk-mark" contenteditable="false">${n}.</span>`;
    else if (bl.type === 'todo')
      lead = `<button class="blk-check" data-act="check" contenteditable="false" tabindex="-1" role="checkbox" aria-checked="${!!bl.done}" aria-label="done">${icon('check', 14)}</button>`;
    return `<div class="blk blk-${bl.type}${bl.done ? ' done' : ''}" data-id="${bl.id}" data-type="${bl.type}">${lead}<div class="txt" contenteditable="true" data-ph="${esc(PH[bl.type] || '')}" spellcheck="true">${esc(bl.text)}</div></div>`;
  }
  function renderBlocks(focusId, off = 'end') {
    let n = 0;
    blocksEl.innerHTML = page.blocks
      .map((bl) => {
        n = bl.type === 'num' ? n + 1 : 0;
        return blockHtml(bl, n);
      })
      .join('');
    if (focusId) {
      cur = focusId;
      const el = txtEl(focusId);
      if (el) {
        setCaret(el, off);
        el.scrollIntoView({ block: 'nearest' });
      }
    }
    updateTools();
  }
  function autosize() {
    titleEl.style.height = 'auto';
    titleEl.style.height = titleEl.scrollHeight + 'px';
  }
  function updatePin() {
    pinBtn.classList.toggle('on', !!page.pinned);
  }

  // ---- toolbar / dock
  function placeDock() {
    const vv = window.visualViewport;
    const bottom = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
    dock.style.bottom = bottom + 'px';
  }
  function showDock(on) {
    dock.classList.toggle('on', on);
    if (on) placeDock();
    else hideSlash();
  }
  function updateTools() {
    const t = cur && blk(cur)?.type;
    dock.querySelectorAll('[data-t]').forEach((x) => x.classList.toggle('on', x.dataset.t === t));
  }
  const scheduleDockCheck = () => {
    clearTimeout(dockTimer);
    dockTimer = setTimeout(() => {
      const a = document.activeElement;
      if (!(a && a.closest && a.closest('.txt')) && !divSel) showDock(false);
    }, 160);
  };
  const vv = window.visualViewport;
  const onVV = () => {
    placeDock();
    curTxt()?.scrollIntoView({ block: 'nearest' });
  };
  vv?.addEventListener('resize', onVV);
  vv?.addEventListener('scroll', placeDock);

  // ---- slash menu
  function hideSlash() {
    slashItems = [];
    slashEl.hidden = true;
    slashEl.innerHTML = '';
  }
  function updateSlash(bl, text) {
    if (text.startsWith('/') && !/\s/.test(text)) {
      const f = text.slice(1).toLowerCase();
      slashItems = TYPES.filter((t) => !f || t.label.toLowerCase().includes(f) || t.kw.includes(f));
      if (slashItems.length) {
        slashEl.innerHTML = slashItems
          .map(
            (t, i) =>
              `<button class="pg-slash-item${i === 0 ? ' first' : ''}" data-s="${t.t}"><span class="pg-slash-ic">${t.ic ? icon(t.ic, 18) : `<b>${t.txt}</b>`}</span>${t.label}</button>`
          )
          .join('');
        slashEl.hidden = false;
        return;
      }
    }
    hideSlash();
  }
  function pickSlash(type) {
    hideSlash();
    if (!cur) return;
    convert(cur, type, { clear: true });
  }

  // ---- structural operations (all re-render the block container)
  function convert(bid, type, { clear = false } = {}) {
    const i = idx(bid);
    if (i < 0) return;
    const el = txtEl(bid);
    const off = el ? caretOffset(el) : null;
    let focus = bid;
    m(() => {
      const bl = page.blocks[i];
      bl.type = type;
      if (clear) bl.text = '';
      if (type === 'divider') {
        bl.text = '';
        bl.done = false;
        if (!page.blocks[i + 1] || page.blocks[i + 1].type === 'divider') page.blocks.splice(i + 1, 0, b('p'));
        focus = page.blocks[i + 1].id;
      }
      if (type !== 'todo') bl.done = false;
      touch();
    });
    renderBlocks(focus, focus === bid ? (clear ? 0 : off ?? 'end') : 0);
    divSel = false;
    showDock(true);
  }

  function onEnter(el) {
    if (!slashEl.hidden && slashItems.length) return pickSlash(slashItems[0].t);
    const bid = el.closest('.blk').dataset.id;
    const i = idx(bid);
    const bl = page.blocks[i];
    if (!bl) return;
    const text = el.textContent;
    if (LISTY.includes(bl.type) && text === '') {
      m(() => {
        bl.type = 'p';
        bl.done = false;
        touch();
      });
      return renderBlocks(bid, 0);
    }
    const o = selOffsets(el) || { start: text.length, end: text.length };
    if (o.start === 0 && o.end === 0 && text !== '') {
      // caret at the very start: open an empty line above and keep this block (and its type) as it is
      const above = b(bl.type === 'bullet' || bl.type === 'num' || bl.type === 'todo' ? bl.type : 'p');
      m(() => {
        page.blocks.splice(i, 0, above);
        touch();
      });
      hideSlash();
      return renderBlocks(bid, 0);
    }
    const before = text.slice(0, o.start);
    const after = text.slice(o.end);
    const nt = bl.type === 'bullet' || bl.type === 'num' || bl.type === 'todo' ? bl.type : 'p';
    const nb = b(nt, after);
    m(() => {
      bl.text = before;
      page.blocks.splice(i + 1, 0, nb);
      touch();
    });
    hideSlash();
    renderBlocks(nb.id, 0);
  }

  // returns true when the event was handled (caller must preventDefault)
  function onBackspace(el) {
    const o = selOffsets(el);
    if (!o || o.start !== o.end || o.start !== 0) return false;
    const bid = el.closest('.blk').dataset.id;
    const i = idx(bid);
    const bl = page.blocks[i];
    if (!bl) return false;
    if (bl.type !== 'p') {
      m(() => {
        bl.type = 'p';
        bl.done = false;
        touch();
      });
      renderBlocks(bid, 0);
      return true;
    }
    if (i === 0) return true; // nothing to merge into; swallow
    const prev = page.blocks[i - 1];
    if (prev.type === 'divider') {
      m(() => {
        page.blocks.splice(i - 1, 1);
        touch();
      });
      renderBlocks(bid, 0);
      return true;
    }
    const joint = prev.text.length;
    m(() => {
      prev.text += el.textContent;
      page.blocks.splice(i, 1);
      touch();
    });
    hideSlash();
    renderBlocks(prev.id, joint);
    return true;
  }

  function moveFocus(bid, dir) {
    let i = idx(bid) + dir;
    while (page.blocks[i] && page.blocks[i].type === 'divider') i += dir;
    const t = page.blocks[i];
    if (!t) return false;
    const el = txtEl(t.id);
    if (!el) return false;
    setCaret(el, dir < 0 ? 'end' : 0);
    el.scrollIntoView({ block: 'nearest' });
    return true;
  }

  function focusFirst() {
    const f = page.blocks.find((x) => x.type !== 'divider');
    if (f) setCaret(txtEl(f.id), 0);
  }

  function addTrailing() {
    const last = page.blocks[page.blocks.length - 1];
    if (last && last.type === 'p' && !last.text) return setCaret(txtEl(last.id), 0);
    const nb = b('p');
    m(() => {
      page.blocks.push(nb);
      touch();
    });
    renderBlocks(nb.id, 0);
  }

  // ---- toolbar actions
  function toolAction(a) {
    if (!cur) return;
    const i = idx(cur);
    if (i < 0) return;
    const el = txtEl(cur);
    const off = el ? caretOffset(el) : null;
    if (a === 'up' || a === 'down') {
      const j = a === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= page.blocks.length) return;
      m(() => {
        const [x] = page.blocks.splice(i, 1);
        page.blocks.splice(j, 0, x);
        touch();
      });
      renderBlocks(cur, off ?? 'end');
      if (!txtEl(cur)) blockEl(cur)?.scrollIntoView({ block: 'nearest' });
    } else if (a === 'del') {
      let focusId;
      const [gone] = page.blocks.slice(i, i + 1);
      m(() => {
        page.blocks.splice(i, 1);
        if (!page.blocks.length) page.blocks.push(b('p'));
        // caret goes to the end of the block above (or the start of the one below when deleting the first)
        const n = page.blocks[i > 0 ? i - 1 : 0];
        focusId = n.id;
        touch();
      });
      divSel = false;
      renderBlocks(focusId, i > 0 ? 'end' : 0);
      if (!txtEl(focusId)) divSel = true;
      if (gone && (gone.text.trim() || gone.type === 'divider'))
        ui.toast('block deleted', {
          action: 'undo',
          onAction: () => {
            if (rec.closed || page.blocks.some((x) => x.id === gone.id)) return;
            m(() => {
              page.blocks.splice(Math.min(i, page.blocks.length), 0, gone);
              touch();
            });
            renderBlocks(gone.type === 'divider' ? null : gone.id, 'end');
          },
        });
    }
    // keep a selected divider highlighted
    if (divSel) blockEl(cur)?.classList.add('sel');
  }

  // ---- events
  pg.addEventListener('beforeinput', (e) => {
    const t = e.target;
    const enter = e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak';
    if (t === titleEl) {
      if (enter) {
        e.preventDefault();
        focusFirst();
      }
      return;
    }
    const el = t.closest?.('.txt');
    if (!el) return;
    if (enter) {
      e.preventDefault();
      onEnter(el);
    } else if (e.inputType === 'deleteContentBackward') {
      if (onBackspace(el)) e.preventDefault();
    }
  });

  pg.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.target === titleEl) {
      if (e.key === 'Enter') {
        e.preventDefault();
        focusFirst();
      }
      return;
    }
    const el = e.target.closest?.('.txt');
    if (!el) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      onEnter(el);
    } else if (e.key === 'Backspace') {
      if (onBackspace(el)) e.preventDefault();
    } else if (e.key === 'ArrowUp' && !e.shiftKey) {
      const o = selOffsets(el);
      if (o && o.start === 0 && o.end === 0 && moveFocus(el.closest('.blk').dataset.id, -1)) e.preventDefault();
    } else if (e.key === 'ArrowDown' && !e.shiftKey) {
      const o = selOffsets(el);
      const len = el.textContent.length;
      if (o && o.start === len && o.end === len && moveFocus(el.closest('.blk').dataset.id, 1)) e.preventDefault();
    } else if (e.key === 'Escape' && !slashEl.hidden) {
      e.preventDefault(); // close only the menu, not the page
      hideSlash();
    }
  });

  pg.addEventListener('input', (e) => {
    if (e.target === titleEl) {
      const v = titleEl.value.replace(/\r?\n/g, ' ');
      if (v !== titleEl.value) {
        const pos = titleEl.selectionStart;
        titleEl.value = v; // a pasted line break would otherwise stay visible in the title box
        titleEl.setSelectionRange(pos, pos);
      }
      m(() => {
        page.title = v;
        touch();
      });
      return autosize();
    }
    const el = e.target.closest?.('.txt');
    if (!el) return;
    const bid = el.closest('.blk').dataset.id;
    const bl = blk(bid);
    if (!bl) return;
    let text = el.textContent;
    if (text === '' && el.innerHTML !== '') el.innerHTML = ''; // drop stray <br> so the placeholder shows
    // markdown shortcuts (only on plain paragraphs, caret right after the prefix)
    if (bl.type === 'p' && e.inputType !== 'deleteContentBackward') {
      if (text === '---') {
        return convert(bid, 'divider', { clear: true });
      }
      const md = parseMd(text);
      if (md && !parseMd(bl.text || '') && caretOffset(el) >= md.len) {
        const off = caretOffset(el) - md.len; // keep the caret where it was, even if text arrived in one chunk
        m(() => {
          bl.type = md.type;
          bl.text = md.text;
          bl.done = md.done;
          touch();
        });
        hideSlash();
        return renderBlocks(bid, off);
      }
    }
    m(() => {
      bl.text = text;
      touch();
    });
    updateSlash(bl, text);
  });

  pg.addEventListener('paste', (e) => {
    const el = e.target.closest?.('.txt');
    if (e.target === titleEl) return;
    if (!el) return;
    e.preventDefault();
    const raw = (e.clipboardData || window.clipboardData)?.getData('text/plain') || '';
    const lines = raw.replace(/\r\n?/g, '\n').replace(/ /g, ' ').split('\n');
    if (lines.length === 1) {
      document.execCommand('insertText', false, lines[0]);
      return;
    }
    while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    const bid = el.closest('.blk').dataset.id;
    const i = idx(bid);
    const bl = page.blocks[i];
    const text = el.textContent;
    const o = selOffsets(el) || { start: text.length, end: text.length };
    const before = text.slice(0, o.start);
    const after = text.slice(o.end);
    const made = lines.slice(1).map((l) => {
      const md = parseMd(l);
      return md ? { ...b(md.type, md.text), done: md.done } : b('p', l);
    });
    let lastId = bid;
    let caret;
    m(() => {
      const firstMd = !before && !after && bl.type === 'p' ? parseMd(lines[0]) : null;
      if (firstMd) {
        bl.type = firstMd.type;
        bl.text = firstMd.text;
        bl.done = firstMd.done;
      } else bl.text = before + lines[0];
      const last = made[made.length - 1];
      if (last) {
        caret = last.text.length;
        last.text += after;
        lastId = last.id;
      } else {
        caret = bl.text.length;
        bl.text += after;
      }
      page.blocks.splice(i + 1, 0, ...made);
      touch();
    });
    hideSlash();
    renderBlocks(lastId, caret);
  });

  pg.addEventListener('focusin', (e) => {
    clearTimeout(dockTimer);
    if (e.target === titleEl) {
      divSel = false;
      return showDock(false);
    }
    const el = e.target.closest?.('.txt');
    if (!el) return;
    const bid = el.closest('.blk').dataset.id;
    if (cur !== bid) hideSlash();
    cur = bid;
    divSel = false;
    blocksEl.querySelectorAll('.blk.sel').forEach((x) => x.classList.remove('sel'));
    updateTools();
    showDock(true);
  });
  pg.addEventListener('focusout', scheduleDockCheck);

  // keep focus in the editor while tapping toolbar / slash items
  dock.addEventListener('mousedown', (e) => e.preventDefault());

  slashEl.addEventListener('click', (e) => {
    const s = e.target.closest('[data-s]');
    if (s) pickSlash(s.dataset.s);
  });
  dock.querySelector('.pg-tools').addEventListener('click', (e) => {
    const t = e.target.closest('[data-t]');
    if (t && cur) return convert(cur, t.dataset.t);
    const a = e.target.closest('[data-a]');
    if (a) toolAction(a.dataset.a);
  });

  pg.addEventListener('click', async (e) => {
    const chk = e.target.closest('.blk-check');
    if (chk) {
      const row = chk.closest('.blk');
      const bl = blk(row.dataset.id);
      if (!bl) return;
      m(() => {
        bl.done = !bl.done;
        touch();
      });
      row.classList.toggle('done', bl.done);
      chk.setAttribute('aria-checked', bl.done);
      return;
    }
    const div = e.target.closest('.blk-divider');
    if (div) {
      cur = div.dataset.id;
      divSel = true;
      blocksEl.querySelectorAll('.blk.sel').forEach((x) => x.classList.remove('sel'));
      div.classList.add('sel');
      updateTools();
      return showDock(true);
    }
    const a = e.target.closest('[data-act]');
    if (!a) return;
    switch (a.dataset.act) {
      case 'back':
        rec.close();
        break;
      case 'tail':
        addTrailing();
        break;
      case 'pin':
        m(() => {
          page.pinned = !page.pinned;
          touch();
        });
        updatePin();
        break;
      case 'emoji':
        emojiSheet();
        break;
      case 'more':
        moreSheet();
        break;
    }
  });

  function emojiSheet() {
    const r = ui.openSheet(
      `${ui.sheetHeader('Page icon', ui.closeBtn())}<div class="pg-emojis">${EMOJIS.map((x) => `<button data-e="${x}">${x}</button>`).join('')}</div>`
    );
    r.body.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) return r.close();
      const x = e.target.closest('[data-e]');
      if (!x) return;
      m(() => {
        page.icon = x.dataset.e;
        touch();
      });
      emojiBtn.textContent = page.icon;
      r.close();
    });
  }

  function moreSheet() {
    const r = ui.openSheet(
      `${ui.sheetHeader('Page', ui.closeBtn())}
       <div class="pg-menu">
         <button data-m="dup">${icon('copy', 20)}<span>Duplicate</span></button>
         <button data-m="del" class="pg-danger">${icon('trash', 20)}<span>Delete page</span></button>
       </div>`
    );
    r.body.addEventListener('click', async (e) => {
      if (e.target.closest('[data-close]')) return r.close();
      const x = e.target.closest('[data-m]');
      if (!x) return;
      r.close();
      if (x.dataset.m === 'dup') {
        const copy = store.addPage({
          title: (page.title || 'untitled') + ' (copy)',
          icon: page.icon,
          blocks: page.blocks.map((bl) => ({ ...bl, id: uid() })),
        });
        ui.toast('page duplicated', { action: 'open', onAction: () => (rec.close(), setTimeout(() => openPage(copy.id), 300)) });
      } else {
        const pid = page.id;
        rec.close();
        const snap = store.deletePage(pid);
        if (snap) ui.toast('page deleted', { action: 'undo', onAction: () => store.restorePage(snap) });
      }
    });
  }

  function cleanup() {
    clearTimeout(dockTimer);
    vv?.removeEventListener('resize', onVV);
    vv?.removeEventListener('scroll', placeDock);
    const p = store.getPage(id);
    if (p) {
      // drop pages the user opened and never wrote anything in
      // (any number of blank lines counts as empty; a divider or a checked box counts as content)
      const empty = !p.title.trim() && p.blocks.every((x) => x.type !== 'divider' && !x.text.trim() && !x.done);
      if (empty) {
        store.deletePage(id);
        ui.toast('empty page discarded');
      } else store.emit();
    }
  }

  // ---- initial paint
  titleEl.value = page.title;
  updatePin();
  renderBlocks();
  requestAnimationFrame(() => {
    autosize();
    if (!page.title.trim() && page.blocks.every((x) => !x.text)) titleEl.focus({ preventScroll: true });
  });
  return rec;
}
