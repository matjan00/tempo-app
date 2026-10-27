// Habits: things you do every day. They show on Today until done, and this tab keeps the history as little squares.
import * as store from './store.js';
import { icon } from './icons.js';
import { openSheet, toast } from './ui.js';
import { esc, todayStr, addDays, parseYmd, haptic, DAYS, MONTHS } from './util.js';

const WEEKS = 12; // how many weeks of squares each habit shows

// ---------- Today ----------
export function habitRow(h, today = todayStr()) {
  const done = !!h.log[today];
  const title = h.title.trim() ? esc(h.title) : '<span class="muted">untitled</span>';
  return `<div class="task habit ${done ? 'done' : ''}" data-hid="${esc(h.id)}">
    <button type="button" class="check p0" data-act="hcheck" role="checkbox" aria-checked="${done}" aria-label="${esc(h.title.trim() || 'untitled')}">${done ? icon('check', 15) : ''}</button>
    <button type="button" class="t-main" data-act="hopen"><span class="t-title">${title}</span><span class="t-meta"><span class="m">${icon('repeat', 13)}every day</span></span></button>
  </div>`;
}

export function toggleHabit(id, row = null) {
  const h = store.getHabit(id);
  if (!h) return;
  haptic();
  const done = !h.log[todayStr()];
  if (row) {
    row.classList.toggle('done', done);
    row.querySelector('.check')?.classList.toggle('pop', done);
  }
  store.toggleHabit(id);
  if (done) toast('habit done', { action: 'undo', onAction: () => store.toggleHabit(id) });
}

// Shared click handling for habit rows (Today and Habits). Returns true if it handled the event.
export function handleHabitClick(e) {
  const el = e.target.closest('[data-act]');
  const row = e.target.closest('[data-hid]');
  if (!el || !row) return false;
  if (el.dataset.act === 'hcheck') return toggleHabit(row.dataset.hid, row), true;
  if (el.dataset.act === 'hopen') return openHabit(row.dataset.hid), true;
  return false;
}

export function openHabit(id) {
  const h = store.getHabit(id);
  if (!h) return;
  const { cur, best } = store.habitStreak(h);
  const rec = openSheet(
    `<div class="ts">
      <div class="ts-bar"><button type="button" class="btn ghost" data-close aria-label="back">${icon('chevL', 18)} back</button></div>
      <h2 class="lbl">habit</h2>
      <div class="ts-head"><textarea id="hb-title" rows="1" placeholder="habit name" enterkeyhint="done" aria-label="habit name" maxlength="300">${esc(h.title)}</textarea></div>
      <p class="hb-info">${cur} day streak · best ${best} · done ${Object.keys(h.log).length} times</p>
      <button type="button" class="btn danger" id="hb-del">${icon('trash', 16)} delete habit</button>
    </div>`,
    { ariaLabel: 'habit' }
  );
  const ta = rec.body.querySelector('#hb-title');
  const fit = () => ((ta.style.height = 'auto'), (ta.style.height = ta.scrollHeight + 'px'));
  fit();
  ta.addEventListener('input', fit);
  ta.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), ta.blur()));
  ta.addEventListener('change', () => {
    const t = ta.value.trim();
    if (t) store.updateHabit(id, { title: t });
  });
  rec.body.querySelector('#hb-del').addEventListener('click', () => {
    rec.close();
    const snap = store.deleteHabit(id);
    if (snap) toast('habit deleted', { action: 'undo', onAction: () => store.restoreHabit(snap) });
  });
}

// ---------- Habits tab ----------
const MON = (d) => (d.getDay() + 6) % 7; // Monday = 0

function squares(h, today) {
  const start = addDays(today, -MON(parseYmd(today)) - (WEEKS - 1) * 7); // the Monday WEEKS-1 weeks before this one
  const since = new Date(h.created);
  const created = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, '0')}-${String(since.getDate()).padStart(2, '0')}`;
  const cells = [];
  for (let i = 0; i < WEEKS * 7; i++) {
    const day = addDays(start, i);
    const d = parseYmd(day);
    const on = !!h.log[day];
    const cls = on ? 'on' : day > today ? 'future' : day < created ? 'before' : '';
    const label = `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}: ${on ? 'done' : day > today ? 'upcoming' : 'not done'}`;
    cells.push(`<i class="${cls}${day === today ? ' now' : ''}" title="${label}"></i>`);
  }
  return `<div class="hb-grid" role="img" aria-label="${esc(h.title)}: last ${WEEKS} weeks, ${Object.keys(h.log).filter((k) => k >= start).length} days done">${cells.join('')}</div>`;
}

function card(h, today) {
  const { cur, best } = store.habitStreak(h, today);
  const done = !!h.log[today];
  const title = h.title.trim() ? esc(h.title) : '<span class="muted">untitled</span>';
  return `<section class="hb-card" data-hid="${esc(h.id)}">
    <div class="task habit ${done ? 'done' : ''}" data-hid="${esc(h.id)}">
      <button type="button" class="check p0" data-act="hcheck" role="checkbox" aria-checked="${done}" aria-label="${esc(h.title.trim() || 'untitled')}: today">${done ? icon('check', 15) : ''}</button>
      <button type="button" class="t-main" data-act="hopen"><span class="t-title">${title}</span><span class="t-meta"><span class="m">${icon('fire', 13)}${cur} day streak</span><span class="m">best ${best}</span></span></button>
    </div>
    ${squares(h, today)}
  </section>`;
}

export function render(root) {
  const st = store.get();
  const today = todayStr();
  const doneToday = st.habits.filter((h) => h.log[today]).length;
  root.innerHTML = `
    <header class="top"><div><div class="eyebrow">${st.habits.length ? `${doneToday} of ${st.habits.length} done today` : 'every day'}</div><h1>Habits</h1></div></header>
    ${st.habits.map((h) => card(h, today)).join('')}
    ${st.habits.length ? '' : `<div class="empty">${icon('habits', 34)}<p>no habits yet.</p><small>add something you want to do every day. it shows up on Today until you do it, and every day you do it fills a square here.</small></div>`}
    <div class="composer"><form class="qa-form hb-add" autocomplete="off">
      <input class="qa-input" data-keep="habit" type="text" enterkeyhint="done" placeholder="add a daily habit…" aria-label="new habit" maxlength="300">
      <button class="qa-send" type="submit" aria-label="add habit">${icon('plus', 22)}</button>
    </form></div>`;

  const form = root.querySelector('.hb-add');
  const input = form.querySelector('input');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const t = input.value.trim();
    if (!t) return input.focus();
    input.value = '';
    haptic(8);
    store.addHabit(t);
    root.querySelector('[data-keep=habit]')?.focus();
  });
  root.onclick = (e) => {
    handleHabitClick(e);
  };
}
