// Light/dark theme + accent colour.
// c = the accent itself (fills, borders, big shapes) · ink = text/icons ON the accent (>= 4.5:1 on c)
// text / textDark = the accent used AS small text on the light / dark background (>= 4.5:1 there)
import * as store from './store.js';

export const ACCENTS = {
  coral: { name: 'Red', c: '#ff2d2d', ink: '#111111', text: '#c4111b', textDark: '#ff2d2d' },
  amber: { name: 'Amber', c: '#f2a31b', ink: '#111111', text: '#83580f', textDark: '#f2a31b' },
  green: { name: 'Green', c: '#2fa56b', ink: '#111111', text: '#1f6f48', textDark: '#2fa56b' },
  blue: { name: 'Blue', c: '#3e7bfa', ink: '#111111', text: '#2f5dbe', textDark: '#5b8ffb' },
  violet: { name: 'Violet', c: '#8b5cf6', ink: '#000000', text: '#6e49c2', textDark: '#a27df8' },
  mono: { name: 'Mono', c: null, ink: null },
};

const mq = matchMedia('(prefers-color-scheme: dark)');

export function resolvedTheme() {
  const t = store.get().settings.theme;
  return t === 'auto' ? (mq.matches ? 'dark' : 'light') : t;
}

export function applyTheme() {
  const s = store.get().settings;
  const theme = resolvedTheme();
  const root = document.documentElement;
  root.dataset.theme = theme;
  let a = ACCENTS[s.accent] || ACCENTS.coral;
  if (s.accent === 'mono') a = theme === 'dark' ? { c: '#f2f2f3', ink: '#111113', text: '#f2f2f3', textDark: '#f2f2f3' } : { c: '#18181b', ink: '#ffffff', text: '#18181b', textDark: '#18181b' };
  const text = theme === 'dark' ? a.textDark : a.text;
  root.style.setProperty('--accent', a.c);
  root.style.setProperty('--accent-ink', a.ink);
  root.style.setProperty('--accent-text', text);
  const bg = theme === 'dark' ? '#111111' : '#ededed';
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', bg);
  try {
    localStorage.setItem('tempo.theme', JSON.stringify({ theme, accent: a.c, ink: a.ink, text }));
  } catch {}
}

mq.addEventListener?.('change', applyTheme);
