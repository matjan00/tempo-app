// Small helpers shared by every screen.
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
export const pad = (n) => String(n).padStart(2, '0');

// Dates are stored as local "YYYY-MM-DD" strings so "today" never shifts with time zones.
export const ymd = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseYmd = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const todayStr = () => ymd();
export const addDays = (s, n) => {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
};
export const diffDays = (a, b) => Math.round((parseYmd(a) - parseYmd(b)) / 864e5);

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function fmtDate(s) {
  if (!s) return '';
  const diff = diffDays(s, todayStr());
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  const d = parseYmd(s);
  if (diff > 1 && diff < 7) return DAYS[d.getDay()].slice(0, 3);
  const base = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === new Date().getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

export function fmtMin(m) {
  m = Math.round(m);
  const h = Math.floor(m / 60);
  return h ? `${h}h${m % 60 ? ' ' + (m % 60) + 'm' : ''}` : `${m}m`;
}

export function timeAgo(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return fmtDate(ymd(new Date(ts)));
}

export function debounce(fn, ms) {
  let t;
  const wrapped = (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
  wrapped.flush = (...a) => {
    clearTimeout(t);
    fn(...a);
  };
  return wrapped;
}

export const haptic = (ms = 10) => {
  try {
    navigator.vibrate?.(ms);
  } catch {}
};

export const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
