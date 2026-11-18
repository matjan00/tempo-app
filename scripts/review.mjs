// Helpers for the evening review and weekly report (used by the cloud routines, see routines/).
//
//   node scripts/review.mjs day 2026-11-19          how the day went: score, done, missed (with reasons), not ticked
//   node scripts/review.mjs week 2026-11-20         Mon–Fri of that week: score per day, streak, miss reasons, skipped hours
//   node scripts/review.mjs reason 2026-11-19 <blockId> "meeting ran over"   store a reason on a block (marks it missed)
//   node scripts/review.mjs done 2026-11-19 <blockId>     mark a block done (did it, forgot to tick)
//   node scripts/review.mjs events 2026-11-19             calendar events for the saved plan (after editing it)
//
// Needs SYNC_KEY (environment or .env), like scripts/sync.cjs.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { score, streak, planFor, SCORED } from '../docs/js/plan.js';
import { calendarEvents } from './plan-day.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const sync = (args) => execFileSync(process.execPath, [path.join(here, 'sync.cjs'), ...args], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'] });
const plans = () => JSON.parse(sync(['pull', 'plan'])).map((r) => ({ ...r.data, id: r.id }));
const addDays = (date, n) => {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

function day(date, all = plans()) {
  const p = planFor(all, date);
  if (!p) return { date, plan: false };
  const s = score(p);
  const scored = p.blocks.filter((b) => SCORED.includes(b.kind) && !b.copyOf);
  const line = (b) => ({ id: b.id, time: `${b.start}–${b.end}`, title: b.title, kind: b.kind, ...(b.reason ? { reason: b.reason } : {}), ...(b.moved ? { moved: b.moved } : {}) });
  return {
    date,
    plan: true,
    score: s.pct,
    doneMinutes: s.done,
    plannedMinutes: s.planned,
    streak: streak(all, date),
    done: scored.filter((b) => b.status === 'done').map(line),
    missed: scored.filter((b) => b.status === 'missed').map(line),
    notTicked: scored.filter((b) => b.status === 'planned').map(line),
    secondTries: p.blocks.filter((b) => b.copyOf).map((b) => ({ ...line(b), status: b.status })),
    meetings: p.blocks.filter((b) => b.kind === 'meeting').map(line),
  };
}

function week(date) {
  const all = plans();
  const d = new Date(date + 'T12:00:00Z');
  const monday = addDays(date, -((d.getUTCDay() + 6) % 7));
  const days = [0, 1, 2, 3, 4].map((i) => day(addDays(monday, i), all));
  const reasons = {};
  const missedHours = {};
  for (const x of days.filter((x) => x.plan))
    for (const b of [...x.missed, ...x.notTicked]) {
      const r = (b.reason || (x.notTicked.includes(b) ? 'not ticked' : 'no reason given')).toLowerCase();
      reasons[r] = (reasons[r] || 0) + 1;
      const h = b.time.slice(0, 2) + ':00';
      missedHours[h] = (missedHours[h] || 0) + 1;
    }
  const withPlan = days.filter((x) => x.plan && x.plannedMinutes);
  const avg = withPlan.length ? Math.round(withPlan.reduce((n, x) => n + x.score, 0) / withPlan.length) : null;
  return {
    week: `${monday} – ${addDays(monday, 4)}`,
    averageScore: avg,
    streak: streak(all, addDays(monday, 4)),
    days: days.map((x) => ({ date: x.date, score: x.plan ? x.score : null, done: x.doneMinutes ?? 0, planned: x.plannedMinutes ?? 0 })),
    missReasons: Object.entries(reasons).sort((a, b) => b[1] - a[1]),
    missedByHour: Object.entries(missedHours).sort((a, b) => b[1] - a[1]),
  };
}

function editBlock(date, blockId, fn) {
  const p = planFor(plans(), date);
  if (!p) throw new Error(`no plan for ${date}`);
  const b = p.blocks.find((x) => x.id === blockId);
  if (!b) throw new Error(`no block ${blockId} on ${date}`);
  fn(b);
  const tmp = path.join(os.tmpdir(), `plan-${date}-reason.json`);
  fs.writeFileSync(tmp, JSON.stringify(p));
  try {
    return sync(['put', 'plan', p.id, tmp]).trim();
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

// a reason given in the review means it wasn't done
const reason = (date, id, text) => editBlock(date, id, (b) => {
  b.reason = String(text).slice(0, 300);
  if (b.status === 'planned') b.status = 'missed';
});
const done = (date, id) => editBlock(date, id, (b) => {
  b.status = 'done';
  b.doneAt = Date.now();
  delete b.reason;
});

try {
  const [cmd, a, b, c] = process.argv.slice(2);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a || '')) throw new Error('usage: day <date> | week <date> | reason <date> <blockId> "<text>" | done <date> <blockId> | events <date>');
  if (cmd === 'day') console.log(JSON.stringify(day(a), null, 2));
  else if (cmd === 'week') console.log(JSON.stringify(week(a), null, 2));
  else if (cmd === 'reason') console.log(reason(a, b, c));
  else if (cmd === 'done') console.log(done(a, b));
  else if (cmd === 'events') {
    const p = planFor(plans(), a);
    if (!p) throw new Error(`no plan for ${a}`);
    console.log(JSON.stringify(calendarEvents(p), null, 2));
  }
  else throw new Error('usage: day <date> | week <date> | reason <date> <blockId> "<text>" | done <date> <blockId> | events <date>');
} catch (e) {
  console.error('review: ' + e.message);
  process.exitCode = 1;
}
