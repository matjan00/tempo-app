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
  // swipe down to close: from the handle / top bar always, from anywhere else when the sheet is scrolled to the top
  if (!full) {
    const body = rec.body;
    let sx = null, sy = 0, dragging = false, fromTop = false, lastY = 0, lastT = 0, vy = 0;
    panel.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return (sx = null);
      const t = e.touches[0];
      sx = t.clientX; sy = lastY = t.clientY; lastT = e.timeStamp; vy = 0; dragging = false;
      fromTop = !!e.target.closest('.grab-zone, .ts-bar');
    }, { passive: true });
    panel.addEventListener('touchmove', (e) => {
      if (sx === null) return;
      const t = e.touches[0];
      const dy = t.clientY - sy, dx = t.clientX - sx;
      if (!dragging) {
        if (dy > 6 && dy > Math.abs(dx) * 1.2 && (fromTop || body.scrollTop <= 0) && !e.target.closest('input[type=range], .chips.scroll')) {
          dragging = true;
          panel.style.transition = 'none';
        } else if (Math.abs(dx) > 12 || dy < -6) return (sx = null);
        else return;
      }
      e.preventDefault();
      panel.style.transform = `translateY(${Math.max(0, dy)}px)`;
      const dt = Math.max(8, e.timeStamp - lastT);
      vy = (t.clientY - lastY) / dt;
      lastY = t.clientY; lastT = e.timeStamp;
    }, { passive: false });
    const end = (e) => {
      if (sx === null || !dragging) return (sx = null);
      sx = null;
      const dy = (e.changedTouches?.[0]?.clientY ?? lastY) - sy;
      if (dy > 90 || (vy > 0.6 && dy > 40)) {
        panel.style.transition = 'transform .2s ease-out';
        panel.style.transform = 'translateY(100%)';
        rec.close();
      } else {
        panel.style.transition = 'transform .2s var(--ease)';
        panel.style.transform = '';
        setTimeout(() => (panel.style.transition = ''), 220);
      }
    };
    panel.addEventListener('touchend', end);
    panel.addEventListener('touchcancel', end);
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

// Toasts sit at the bottom, in thumb reach: just above the quick-add bar (or the tab bar / the notes toolbar),
// never on top of them. Newest at the bottom, at most 3 at once.
const DOCKS = '.pg-dock.on, .composer, #nav';
let watched = null;
const resizeWatch = typeof ResizeObserver === 'function' ? new ResizeObserver(() => placeToasts()) : null;
export function placeToasts() {
  if (!toasts.children.length) return;
  const vh = window.innerHeight;
  let top = vh;
  let composer = null;
  for (const el of document.querySelectorAll(DOCKS)) {
    const r = el.getBoundingClientRect();
    if (!r.height || getComputedStyle(el).display === 'none' || r.top >= vh) continue;
    if (el.classList.contains('composer')) composer = el;
    top = Math.min(top, r.top);
  }
  toasts.style.bottom = `${Math.max(12, vh - top + 10)}px`;
  // the quick-add bar grows when its preview chips appear: follow it
  if (resizeWatch && composer !== watched) {
    if (watched) resizeWatch.unobserve(watched);
    if (composer) resizeWatch.observe(composer);
    watched = composer;
  }
}
addEventListener('resize', () => placeToasts());
window.visualViewport?.addEventListener('resize', () => placeToasts());
['focusin', 'focusout'].forEach((ev) => document.addEventListener(ev, () => setTimeout(placeToasts, 80)));

// With an action (e.g. "undo") a toast stays ~7 s; touching / holding it pauses the countdown.
export function toast(msg, { action, onAction, ms } = {}) {
  ms ??= action ? 7000 : 3400;
  while (toasts.children.length >= 3) toasts.firstElementChild.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action)}</button>` : ''}`;
  toasts.appendChild(el);
  placeToasts();
  requestAnimationFrame(() => el.classList.add('in'));
  let dead = false;
  let timer = null;
  let left = ms;
  let since = 0;
  const kill = () => {
    if (dead) return;
    dead = true;
    clearTimeout(timer);
    el.classList.remove('in');
    setTimeout(() => el.remove(), 250);
  };
  const run = () => {
    if (dead || timer) return;
    since = Date.now();
    timer = setTimeout(kill, left);
  };
  const hold = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
    left = Math.max(1500, left - (Date.now() - since));
  };
  el.addEventListener('pointerdown', hold);
  el.addEventListener('pointerenter', (e) => e.pointerType === 'mouse' && hold());
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => el.addEventListener(ev, run));
  el.querySelector('button')?.addEventListener('click', () => {
    if (dead) return;
    onAction?.();
    kill();
  });
  run();
  return kill;
}

// "cancel" is the safe, visually primary choice; the destructive one is outlined in red and kept apart.
export function confirmDialog(message, { ok = 'delete', danger = true, title = 'are you sure?' } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const rec = openSheet(
      `<div class="confirm"><h2>${esc(title)}</h2><p>${esc(message)}</p>
        <div class="row-btns confirm-btns">${
          danger
            ? `<button class="btn danger" data-r="1">${esc(ok)}</button><button class="btn safe" data-r="0">cancel</button>`
            : `<button class="btn ghost" data-r="0">cancel</button><button class="btn primary" data-r="1">${esc(ok)}</button>`
        }</div></div>`,
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
