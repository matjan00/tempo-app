// Bottom sheets / full-screen layers, toasts and confirm dialogs.
// Sheets push a history entry so the phone's Back gesture closes them instead of leaving the app.
import { icon } from './icons.js';
import { esc } from './util.js';

const layers = document.getElementById('layers');
const toasts = document.getElementById('toasts');
const stack = [];
let ignorePops = 0;

function flushHistory() {
  if (ignorePops > 0) return;
  for (const r of stack)
    if (!r.pushed) {
      history.pushState({ sheet: 1 }, '');
      r.pushed = true;
    }
}

export function openSheet(html, { full = false, cls = '', onClose } = {}) {
  const el = document.createElement('div');
  el.className = `overlay ${full ? 'full' : ''} ${cls}`;
  el.innerHTML = `<div class="backdrop"></div><div class="panel" role="dialog" aria-modal="true">${full ? '' : '<div class="grab-zone" aria-hidden="true"><div class="grab"></div></div>'}<div class="panel-body">${html}</div></div>`;
  layers.appendChild(el);
  const rec = { el, body: el.querySelector('.panel-body'), onClose, pushed: false, closed: false };
  rec.close = () => closeRec(rec, false);
  stack.push(rec);
  flushHistory();
  el.querySelector('.backdrop').addEventListener('click', rec.close);
  const panel = el.querySelector('.panel');
  panel.tabIndex = -1;
  // drag the handle down to close the sheet
  const zone = el.querySelector('.grab-zone');
  if (zone) {
    let y0 = null;
    zone.addEventListener('pointerdown', (e) => {
      y0 = e.clientY;
      zone.setPointerCapture?.(e.pointerId);
      panel.style.transition = 'none';
    });
    zone.addEventListener('pointermove', (e) => {
      if (y0 === null) return;
      panel.style.transform = `translateY(${Math.max(0, e.clientY - y0)}px)`;
    });
    const end = (e) => {
      if (y0 === null) return;
      const dy = e.clientY - y0;
      y0 = null;
      panel.style.transition = '';
      panel.style.transform = '';
      if (dy > 80) rec.close();
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }
  // a [data-close] button anywhere in the sheet closes it
  rec.body.addEventListener('click', (e) => e.target.closest('[data-close]') && rec.close());
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
  // move focus into the sheet (screen readers / keyboards) unless the sheet already focused a field
  setTimeout(() => !rec.closed && !panel.contains(document.activeElement) && panel.focus({ preventScroll: true }), 30);
  return rec;
}

function closeRec(rec, fromPop) {
  if (rec.closed) return;
  rec.closed = true;
  const i = stack.indexOf(rec);
  if (i >= 0) stack.splice(i, 1);
  rec.el.classList.remove('in');
  setTimeout(() => rec.el.remove(), 260);
  try {
    rec.onClose?.();
  } catch (e) {
    console.error(e);
  }
  if (!fromPop && rec.pushed) {
    ignorePops++;
    history.back();
  }
}

addEventListener('popstate', () => {
  if (ignorePops > 0) {
    ignorePops--;
    flushHistory();
    return;
  }
  const top = stack[stack.length - 1];
  if (top) {
    top.pushed = false;
    closeRec(top, true);
  }
});

export const closeAll = () => [...stack].reverse().forEach((r) => r.close());
export const topSheet = () => stack[stack.length - 1] || null;

// Escape closes the top sheet (keyboards / desktop).
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.defaultPrevented) return;
  const top = topSheet();
  if (top) {
    e.preventDefault();
    top.close();
  }
});

// Toasts: newest on top of the stack, at most 3 at once. With an action (e.g. "undo") they stay a bit longer.
export function toast(msg, { action, onAction, ms } = {}) {
  ms ??= action ? 5000 : 3400;
  while (toasts.children.length >= 3) toasts.firstElementChild.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action)}</button>` : ''}`;
  toasts.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  let dead = false;
  const kill = () => {
    if (dead) return;
    dead = true;
    el.classList.remove('in');
    setTimeout(() => el.remove(), 250);
  };
  el.querySelector('button')?.addEventListener('click', () => {
    if (dead) return;
    onAction?.();
    kill();
  });
  setTimeout(kill, ms);
  return kill;
}

export function confirmDialog(message, { ok = 'Delete', danger = true, title = 'Are you sure?' } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const rec = openSheet(
      `<div class="confirm"><h3>${esc(title)}</h3><p>${esc(message)}</p>
        <div class="row-btns"><button class="btn ghost" data-r="0">Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-r="1">${esc(ok)}</button></div></div>`,
      { cls: 'small', onClose: () => !answered && resolve(false) }
    );
    rec.body.addEventListener('click', (e) => {
      const b = e.target.closest('[data-r]');
      if (!b) return;
      answered = true;
      resolve(b.dataset.r === '1');
      rec.close();
    });
  });
}

export const sheetHeader = (title, right = '') =>
  `<div class="sheet-head"><h2>${esc(title)}</h2><div>${right}</div></div>`;
export const closeBtn = () => `<button class="icon-btn" data-close aria-label="Close">${icon('x', 20)}</button>`;
