// Bottom sheets / full-screen layers, toasts and confirm dialogs.
// Sheets push a history entry so the phone's Back gesture closes them instead of leaving the app.
import { icon } from './icons.js';
import { esc } from './util.js';

const layers = document.getElementById('layers');
const toasts = document.getElementById('toasts');
const stack = [];
let ignorePops = 0;
let sheetSeq = 0;
const screenEl = document.getElementById('screen');
const navEl = document.getElementById('nav');

// Toasts live in one persistent polite live region, so screen readers announce each new one.
toasts.setAttribute('role', 'status');
toasts.setAttribute('aria-live', 'polite');

// One place for "should this animate?" (scrolls, smooth jumps).
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const scrollToEl = (el, opts = {}) => el?.scrollIntoView({ block: 'nearest', ...opts, behavior: reducedMotion() ? 'auto' : 'smooth' });

// Remember which element has focus inside `root` as a CSS selector (ids / data-* attributes), so it can be
// put back after the markup was redrawn.
const cssq = (v) => String(v).replace(/["\\]/g, '\\$&');
export function focusSnapshot(root) {
  const a = document.activeElement;
  if (!root || !a || a === root || a === document.body || !root.contains(a)) return null;
  const parts = [];
  for (let el = a; el && el !== root; el = el.parentElement) {
    if (el.id) {
      parts.unshift(`#${CSS.escape(el.id)}`);
      break;
    }
    const attrs = [...el.attributes].filter((x) => x.name.startsWith('data-')).map((x) => `[${x.name}="${cssq(x.value)}"]`).join('');
    if (attrs) parts.unshift(el.localName + attrs);
    else if (el === a) parts.unshift(el.localName + (el.classList[0] ? `.${CSS.escape(el.classList[0])}` : ''));
  }
  let pos = null;
  try {
    pos = a.selectionStart;
  } catch {}
  return { sel: parts.join(' '), pos };
}
export function focusRestore(root, snap) {
  if (!snap || !snap.sel) return false;
  try {
    const el = root.querySelector(snap.sel);
    if (!el || el.disabled) return false;
    el.focus({ preventScroll: true });
    if (snap.pos != null) el.setSelectionRange?.(snap.pos, snap.pos);
    return document.activeElement === el;
  } catch {
    return false;
  }
}

// While a sheet is open everything behind it is inert (no tabbing / reading into the page underneath).
function syncInert() {
  const open = stack.length > 0;
  for (const e of [screenEl, navEl]) if (e) e.inert = open;
  stack.forEach((r, i) => (r.el.inert = i < stack.length - 1));
}

function flushHistory() {
  if (ignorePops > 0) return;
  for (const r of stack)
    if (!r.pushed) {
      history.pushState({ sheet: 1 }, '');
      r.pushed = true;
    }
}

export function openSheet(html, { full = false, cls = '', onClose, ariaLabel = '', focus = '' } = {}) {
  const el = document.createElement('div');
  el.className = `overlay ${full ? 'full' : ''} ${cls}`;
  el.innerHTML = `<div class="backdrop"></div><div class="panel" role="dialog" aria-modal="true">${full ? '' : '<div class="grab-zone" aria-hidden="true"><div class="grab"></div></div>'}<div class="panel-body">${html}</div></div>`;
  layers.appendChild(el);
  const rec = { el, body: el.querySelector('.panel-body'), onClose, pushed: false, closed: false };
  rec.close = () => closeRec(rec, false);
  // resolves once the closing animation is over and the sheet is gone from the page
  rec.whenClosed = new Promise((r) => (rec.resolveClosed = r));
  rec.opener = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
  rec.openerSnap = focusSnapshot(document.body);
  stack.push(rec);
  syncInert();
  flushHistory();
  el.querySelector('.backdrop').addEventListener('click', rec.close);
  const panel = el.querySelector('.panel');
  panel.tabIndex = -1;
  // name the dialog for screen readers: explicit label, else its heading
  const heading = el.querySelector('h2:not(.lbl)');
  if (ariaLabel) panel.setAttribute('aria-label', ariaLabel);
  else if (heading) {
    heading.id ||= `sheet-title-${++sheetSeq}`;
    panel.setAttribute('aria-labelledby', heading.id);
  }
  // swipe down to close: from the handle / top bar always, from anywhere else when the sheet is scrolled to the top
  if (!full) {
    // nearest scrollable ancestors of the touch target (up to the panel): the sheet only drags down when all are at the top
    const scrolledAway = (target) => {
      for (let n = target instanceof Element ? target : null; n && n !== panel.parentElement; n = n.parentElement) {
        const oy = getComputedStyle(n).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight + 1 && n.scrollTop > 0) return true;
      }
      return false;
    };
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
        if (dy > 6 && dy > Math.abs(dx) * 1.2 && (fromTop || !scrolledAway(e.target)) && !e.target.closest('input[type=range], .chips.scroll')) {
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
  setTimeout(() => {
    if (rec.closed || panel.contains(document.activeElement)) return;
    const first = (focus && rec.body.querySelector(focus)) || rec.body.querySelector('button:not([disabled]), [href], input:not([type=hidden]):not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])');
    (first || panel).focus({ preventScroll: true });
  }, 30);
  return rec;
}

function closeRec(rec, fromPop) {
  if (rec.closed) return;
  rec.closed = true;
  const i = stack.indexOf(rec);
  if (i >= 0) stack.splice(i, 1);
  rec.el.classList.remove('in');
  setTimeout(() => (rec.el.remove(), rec.resolveClosed()), 260);
  syncInert();
  try {
    rec.onClose?.();
  } catch (e) {
    console.error(e);
  }
  // hand focus back to what opened the sheet (unless focus already went somewhere else)
  const ae = document.activeElement;
  if (!ae || ae === document.body || rec.el.contains(ae)) {
    if (rec.opener?.isConnected && !rec.opener.disabled) rec.opener.focus({ preventScroll: true });
    else focusRestore(document.body, rec.openerSnap);
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
  if (!toasts.children.length) {
    // nothing to follow any more: stop observing the quick-add bar
    if (watched) resizeWatch?.unobserve(watched);
    watched = null;
    return;
  }
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

// With an action (e.g. "undo") a toast stays ~7 s; touching / holding / focusing it pauses the countdown.
export function toast(msg, { action, onAction, ms } = {}) {
  ms ??= action ? 7000 : 3400;
  while (toasts.children.length >= 3) toasts.firstElementChild.remove();
  const el = document.createElement('div');
  el.className = 'toast';
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
    setTimeout(() => (el.remove(), placeToasts()), 250);
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
  // keyboard users: tabbing to the Undo button pauses the countdown, leaving it resumes
  el.addEventListener('focusin', hold);
  el.addEventListener('focusout', run);
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
      { cls: 'small', focus: '[data-r="0"]', onClose: () => !answered && resolve(false) }
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
