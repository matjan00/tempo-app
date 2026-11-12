// Light/dark theme + accent colour.
// c = the accent itself (fills, borders, big shapes) · ink = text/icons ON the accent (>= 4.5:1 on c)
// text / textDark = the accent used AS small text on the light / dark background (>= 4.5:1 there)
import * as store from './store.js';

export const ACCENTS = {
  blue: { name: 'Blue', c: '#2563eb', ink: '#ffffff', text: '#1d4ed8', textDark: '#7aa5ff' },
  coral: { name: 'Red', c: '#e5383b', ink: '#ffffff', text: '#c0262d', textDark: '#ff7b7b' },
  amber: { name: 'Amber', c: '#f2a31b', ink: '#111111', text: '#83580f', textDark: '#f2b544' },
  green: { name: 'Green', c: '#1f8a55', ink: '#ffffff', text: '#1a7347', textDark: '#4cc58a' },
  violet: { name: 'Violet', c: '#7c4ddb', ink: '#ffffff', text: '#6a3fc7', textDark: '#b294f9' },
  mono: { name: 'Mono', c: null, ink: null },
};

const mq = matchMedia('(prefers-color-scheme: dark)');

export function resolvedTheme() {
  const t = store.get().settings.theme;
  return t === 'auto' ? (mq.matches ? 'dark' : 'light') : t;
}

export function applyTheme() {
  const s = store.get().settings;
  // an accent from a corrupt save / imported backup: fall back to the default and fix the saved value
  if (!Object.hasOwn(ACCENTS, s.accent)) store.mutate((st) => (st.settings.accent = 'blue'), true);
  const theme = resolvedTheme();
  const root = document.documentElement;
  root.dataset.theme = theme;
  let a = ACCENTS[s.accent] || ACCENTS.blue;
  if (s.accent === 'mono') a = theme === 'dark' ? { c: '#f2f2f3', ink: '#111113', text: '#f2f2f3', textDark: '#f2f2f3' } : { c: '#1c1c1e', ink: '#ffffff', text: '#1c1c1e', textDark: '#1c1c1e' };
  const text = theme === 'dark' ? a.textDark : a.text;
  root.style.setProperty('--accent', a.c);
  root.style.setProperty('--accent-ink', a.ink);
  root.style.setProperty('--accent-text', text);
  const bg = theme === 'dark' ? '#121212' : '#ffffff';
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', bg);
  try {
    localStorage.setItem('tempo.theme', JSON.stringify({ theme, accent: a.c, ink: a.ink, text }));
  } catch {}
}

mq.addEventListener?.('change', applyTheme);
