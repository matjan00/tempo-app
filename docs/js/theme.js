// Light/dark theme + accent colour.
import * as store from './store.js';

export const ACCENTS = {
  coral: { name: 'Red', c: '#ff2d2d', ink: '#ffffff' },
  amber: { name: 'Amber', c: '#f2a31b', ink: '#1a1a1a' },
  green: { name: 'Green', c: '#2fa56b', ink: '#ffffff' },
  blue: { name: 'Blue', c: '#3e7bfa', ink: '#ffffff' },
  violet: { name: 'Violet', c: '#8b5cf6', ink: '#ffffff' },
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
  if (s.accent === 'mono') a = theme === 'dark' ? { c: '#f2f2f3', ink: '#111113' } : { c: '#18181b', ink: '#ffffff' };
  root.style.setProperty('--accent', a.c);
  root.style.setProperty('--accent-ink', a.ink);
  const bg = theme === 'dark' ? '#111111' : '#ededed';
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', bg);
  try {
    localStorage.setItem('tempo.theme', JSON.stringify({ theme, accent: a.c, ink: a.ink }));
  } catch {}
}

mq.addEventListener?.('change', applyTheme);
