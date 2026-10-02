// Stats tab: summary cards, focus chart, heatmap, per-project bars.
import * as store from './store.js';
import { icon } from './icons.js';
import { esc, ymd, addDays, parseYmd, fmtMin, MONTHS } from './util.js';
import { openSettings } from './settings.js';

let range = 'week'; // week | month
const WD = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const mondayOf = (s) => {
  const d = parseYmd(s);
  return addDays(s, -((d.getDay() + 6) % 7));
};

function collect() {
  const st = store.get();
  const byDay = {};
  const byProject = {};
  for (const s of st.sessions) {
    const k = ymd(new Date(s.end));
    byDay[k] = (byDay[k] || 0) + (s.min || 0);
    const p = s.project || '';
    byProject[p] = (byProject[p] || 0) + (s.min || 0);
  }
  return { st, byDay, byProject };
}

function streak(byDay, today) {
  let d = byDay[today] ? today : addDays(today, -1);
  let n = 0;
  while (byDay[d]) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

function barChart(days, byDay, today) {
  const W = 340, H = 170, padL = 4, padR = 4, top = 14, bot = 22;
  const vals = days.map((d) => byDay[d] || 0);
  const rawMax = Math.max(...vals, 30);
  const step = rawMax <= 60 ? 15 : rawMax <= 180 ? 30 : rawMax <= 480 ? 60 : 120;
  const max = Math.ceil(rawMax / step) * step;
  const ch = H - top - bot;
  const n = days.length;
  const slot = (W - padL - padR) / n;
  const bw = Math.min(slot * 0.62, 30);
  let g = '';
  for (let v = 0; v <= max; v += max / 2) {
    const y = top + ch - (v / max) * ch;
    g += `<line x1="0" x2="${W}" y1="${y}" y2="${y}" class="stat-grid"/><text x="${W}" y="${y - 3}" text-anchor="end" class="stat-ax">${v ? fmtMin(v) : ''}</text>`;
  }
  let bars = '';
  days.forEach((d, i) => {
    const v = vals[i];
    const x = padL + slot * i + (slot - bw) / 2;
    const h = v ? Math.max((v / max) * ch, 3) : 0;
    const y = top + ch - h;
    const isT = d === today;
    const future = d > today;
    if (v) bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" class="stat-bar ${isT ? 'today' : ''}"><title>${esc(d)}: ${fmtMin(v)}</title></rect>`;
    else if (!future) bars += `<rect x="${x.toFixed(1)}" y="${top + ch - 3}" width="${bw.toFixed(1)}" height="3" class="stat-bar nil"/>`;
    const dt = parseYmd(d);
    let label = '';
    if (range === 'week') label = WD[(dt.getDay() + 6) % 7];
    else if (i % 5 === 0 || d === today) label = String(dt.getDate());
    if (label) bars += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle" class="stat-ax ${isT ? 'today' : ''}">${label}</text>`;
  });
  return `<svg class="stat-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Focus minutes per day">${g}${bars}</svg>`;
}

function heatmap(byDay, today) {
  const weeks = 15;
  const start = addDays(mondayOf(today), -7 * (weeks - 1));
  const max = Math.max(30, ...Object.values(byDay));
  let cols = '';
  let months = '';
  let lastM = -1;
  for (let w = 0; w < weeks; w++) {
    const ws = addDays(start, w * 7);
    const m = parseYmd(ws).getMonth();
    months += `<span>${m !== lastM ? MONTHS[m] : ''}</span>`;
    lastM = m;
    let cells = '';
    for (let r = 0; r < 7; r++) {
      const d = addDays(ws, r);
      if (d > today) {
        cells += '<i class="stat-cell off"></i>';
        continue;
      }
      const v = byDay[d] || 0;
      const o = v ? 0.25 + 0.75 * Math.min(1, v / max) : 0;
      // (no style attribute at all on empty days: `.stat-cell[style]` would otherwise make them invisible)
      cells += `<i class="stat-cell ${d === today ? 'now' : ''}"${v ? ` style="--o:${o.toFixed(2)}"` : ''} title="${esc(d)}: ${fmtMin(v)}"></i>`;
    }
    cols += `<div class="stat-col">${cells}</div>`;
  }
  return `<div class="stat-heat" role="img" aria-label="focus minutes per day, last 15 weeks"><div class="stat-months">${months}</div><div class="stat-cols">${cols}</div></div>`;
}

function projects(byProject, st) {
  const rows = Object.entries(byProject)
    .filter(([, v]) => v > 0)
    .map(([id, v]) => {
      const p = st.projects.find((x) => x.id === id);
      return { name: p ? p.name : 'No project', color: p ? p.color : null, v };
    })
    .sort((a, b) => b.v - a.v);
  if (!rows.length) return '<p class="stat-note">Focus on a task in a project to see where your time goes.</p>';
  const max = rows[0].v;
  return rows
    .map(
      (r) => `<div class="stat-prow"><div class="stat-pname"><span class="stat-dot" style="background:${esc(r.color || 'var(--muted)')}"></span>${esc(r.name)}<b>${fmtMin(r.v)}</b></div>
      <div class="stat-ptrack"><div class="stat-pfill" style="width:${Math.max(3, (r.v / max) * 100).toFixed(1)}%;background:${esc(r.color || 'var(--muted)')}"></div></div></div>`
    )
    .join('');
}

export function render(root) {
  const { st, byDay, byProject } = collect();
  const today = ymd();
  const wk = mondayOf(today);
  let weekMin = 0;
  for (let i = 0; i < 7; i++) weekMin += byDay[addDays(wk, i)] || 0;
  const wkStart = parseYmd(wk).getTime();
  const tasksWeek = st.tasks.filter((t) => t.done && t.doneAt && t.doneAt >= wkStart).length;
  const sk = streak(byDay, today);

  let days;
  if (range === 'week') days = Array.from({ length: 7 }, (_, i) => addDays(wk, i));
  else days = Array.from({ length: 30 }, (_, i) => addDays(today, i - 29));

  const goal = st.settings.goal || 0;
  const hasData = st.sessions.length > 0;
  const nToday = st.sessions.filter((x) => ymd(new Date(x.end)) === today).length;
  const cards = [
    ['Focus today', fmtMin(byDay[today] || 0), goal ? `${nToday}/${goal} sessions${nToday >= goal ? ' · goal reached' : ''}` : `${nToday} sessions`],
    ['This week', fmtMin(weekMin), 'Mon to Sun'],
    ['Day streak', String(sk), sk ? (byDay[today] ? (sk === 1 ? 'day' : 'days in a row') : 'focus today to keep it') : 'focus to start one'],
    ['Tasks done', String(tasksWeek), 'this week'],
  ]
    .map(([l, v, s]) => `<div class="stat-card"><span class="stat-l">${l}</span><b class="stat-v">${v}</b><span class="stat-s">${s}</span></div>`)
    .join('');

  root.innerHTML = `<header class="top"><div><div class="eyebrow">Your progress</div><h1>Stats</h1></div>
      <button class="icon-btn" data-act="settings" aria-label="settings">${icon('sliders', 22)}</button></header>
    <div class="stat-wrap">
      <div class="stat-cards">${cards}</div>
      ${hasData ? '' : `<div class="stat-empty">${icon('timer', 34)}<h3>Nothing to chart yet</h3><p>Finish a focus session and your minutes, streak and habits will show up here.</p></div>`}
      <section class="stat-box">
        <div class="stat-boxhead"><h3>Focus minutes</h3>
          <div class="stat-seg" role="group" aria-label="chart range"><button data-range="week" class="${range === 'week' ? 'on' : ''}" aria-pressed="${range === 'week'}">Week</button><button data-range="month" class="${range === 'month' ? 'on' : ''}" aria-pressed="${range === 'month'}">30 days</button></div></div>
        ${barChart(days, byDay, today)}
      </section>
      <section class="stat-box"><div class="stat-boxhead"><h3>Last 15 weeks</h3></div>${heatmap(byDay, today)}</section>
      <section class="stat-box"><div class="stat-boxhead"><h3>Focus by project</h3></div>${projects(byProject, st)}</section>
    </div>`;

  root.onclick = (e) => {
    const r = e.target.closest('[data-range]');
    if (r) {
      range = r.dataset.range;
      render(root);
      return;
    }
    if (e.target.closest('[data-act="settings"]')) openSettings();
  };
}
