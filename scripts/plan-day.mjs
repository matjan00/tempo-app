// Day planner: builds one day's plan from the meetings + your synced tasks and habits.
//
//   node scripts/plan-day.mjs --date 2026-11-19 --meetings meetings.json   preview (changes nothing)
//   node scripts/plan-day.mjs --date 2026-11-19 --meetings - --write        save it to the app (via sync)
//   add --events events.json to also write the calendar events (for the "Plan" Google calendar) to a file
//   add --force to replace a plan that already has ticked blocks, or one marked manual: true (made by hand)
//
// meetings.json: [{ "title": "Standup", "start": "10:00", "end": "10:30" }, ...]  (local times, that day)
//
// Rules (DAY-PLANNER.md): meetings first, 10 min prep before each, lunch around 14:00, about 70% of the
// free work time filled, hardest work in the biggest gaps before 11:00, personal things and habits after
// 16:00 (capped so evenings stay light), nothing after 22:00. What doesn't fit is listed as overflow.
// Exception: short breaks like chess (WORK_BREAKS in docs/js/plan.js) go inside work hours after 11:00.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DAY, toMin, fromMin, freeSlots, cleanPlan, planId, planFor, isWorkBreak, WORK_BREAKS_FROM } from '../docs/js/plan.js';

export const RULES = {
  fill: 0.7, // share of free time to plan
  prep: 10, // minutes before each meeting
  lunch: { at: '14:00', len: 30, from: '12:30', to: '15:30' },
  deepBefore: '11:00', // hardest work should start before this
  gap: 5, // minutes left between two task blocks
  eveningFrom: '16:30', // personal blocks start after a short break after work
  eveningMax: 120, // at most this many minutes of personal tasks + habits per evening
  habitLen: 15,
  defaultWork: 50, // minutes for a work task without an estimate
  defaultPersonal: 25,
  maxBlock: 120, // longest guessed block
  maxDur: 240, // longest block for a task with its own duration
};

const ceil5 = (m) => Math.ceil(m / 5) * 5;
const addDays = (date, n) => {
  const d = new Date(date + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

function taskLength(t, focus) {
  if (Number(t.dur) > 0) return Math.min(RULES.maxDur, ceil5(Number(t.dur))); // the user's own choice wins
  const est = Number(t.est) || 0;
  const raw = est > 0 ? est * focus + (est - 1) * 5 : t.area === 'work' ? RULES.defaultWork : RULES.defaultPersonal;
  return Math.min(RULES.maxBlock, ceil5(raw));
}

// Lower sorts first: missed yesterday, overdue, due that day, undated, due later; then priority, then oldest.
function rank(t, date, missed) {
  const when = missed.has(t.id) ? 0 : t.due && t.due < date ? 1 : t.due === date ? 2 : !t.due ? 3 : 4;
  return [when, -(t.prio || 0), t.created || 0];
}
const byRank = (date, missed) => (a, b) => {
  const x = rank(a, date, missed), y = rank(b, date, missed);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};

export function buildPlan({ date, meetings = [], tasks = [], habits = [], prevPlan = null, focus = 25 }) {
  habits = [...habits];
  const notes = [];
  const blocks = [];
  const plan = () => ({ blocks });
  const free = (lo, hi) => freeSlots(plan(), toMin(lo), toMin(hi));

  // 1. meetings
  const ms = meetings
    .map((m, i) => ({ id: `m${i + 1}`, kind: 'meeting', title: String(m.title || 'Meeting'), start: m.start, end: m.end, status: 'planned' }))
    .filter((m) => toMin(m.end) > toMin(m.start))
    .sort((a, b) => toMin(a.start) - toMin(b.start));
  blocks.push(...ms);

  // 2. prep before each work-hours meeting, where the 10 minutes are free (a haircut needs none)
  for (const m of ms) {
    if (toMin(m.start) < toMin(DAY.workStart) || toMin(m.start) >= toMin(DAY.workEnd)) continue;
    const s = toMin(m.start) - RULES.prep;
    if (s < toMin(DAY.wake)) continue;
    const ok = free(fromMin(s), m.start).some(([a, b]) => a <= s && b >= toMin(m.start));
    if (ok) blocks.push({ id: `p${m.id.slice(1)}`, kind: 'prep', title: `Prep: ${m.title}`, start: fromMin(s), end: m.start, status: 'planned' });
    else notes.push(`no time for prep before "${m.title}" (back-to-back)`);
  }

  // 3. lunch: the free half hour nearest to 14:00
  {
    const want = toMin(RULES.lunch.at), len = RULES.lunch.len;
    let best = null;
    for (const [a, b] of free(RULES.lunch.from, RULES.lunch.to))
      for (let s = a; s + len <= b; s += 5) if (best === null || Math.abs(s - want) < Math.abs(best - want)) best = s;
    if (best !== null) blocks.push({ id: 'lunch', kind: 'lunch', title: 'Lunch', start: fromMin(best), end: fromMin(best + len), status: 'planned' });
    else notes.push('no free half hour for lunch between 12:30 and 15:30');
  }

  // 4. habits whose name starts with a time ("8:00 iron") go at that time as a 5-minute reminder,
  //    or right after whatever is on at that time
  const timed = [];
  habits = habits.filter((h) => {
    const m = /^(\d{1,2})[:.](\d{2})\s+/.exec(h?.title || '');
    if (!m || +m[1] > 23 || +m[2] > 59) return true;
    timed.push({ h, at: +m[1] * 60 + +m[2] });
    return false;
  });
  for (const { h, at } of timed) {
    const len = 5;
    const slot = freeSlots(plan(), at, toMin('23:59')).find(([a, b]) => b - a >= len);
    if (!slot) continue;
    blocks.push({ id: `h-${h.id}`, kind: 'habit', title: h.title, habitId: h.id, start: fromMin(slot[0]), end: fromMin(slot[0] + len), status: 'planned' });
  }

  // 5. work tasks into 70% of the free work time
  const missed = new Set((prevPlan?.blocks || []).filter((b) => b.status === 'missed' && b.moved === 'tomorrow' && b.taskId).map((b) => b.taskId));
  const open = tasks.filter((t) => t && !t.done && t.title?.trim() && (!t.due || t.due <= date || missed.has(t.id)));
  const work = open.filter((t) => t.area === 'work').sort(byRank(date, missed));
  const personal = open.filter((t) => t.area !== 'work').sort(byRank(date, missed));
  const overflow = [];

  const freeWork = free(DAY.workStart, DAY.workEnd).reduce((n, [a, b]) => n + b - a, 0);
  const capWork = Math.round(freeWork * RULES.fill);
  let usedWork = 0;
  // A task block needs `gap` minutes clear after it (except right before a fixed block or the end of the window).
  const place = (len, lo, hi, prefer) => {
    const slots = free(lo, hi).map(([a, b]) => [ceil5(a), b]).filter(([a, b]) => b - a >= len);
    if (!slots.length) return null;
    if (prefer === 'deep') {
      const early = slots.filter(([a]) => a < toMin(RULES.deepBefore)).sort((x, y) => y[1] - y[0] - (x[1] - x[0]));
      if (early.length) return early[0][0];
    }
    return slots[0][0];
  };
  const reserve = (start, len) => blocks.push({ id: `gap${blocks.length}`, kind: 'break', title: '', start: fromMin(start + len), end: fromMin(start + len + RULES.gap), status: 'planned', _gap: true });

  for (const t of work) {
    const len = taskLength(t, focus);
    if (usedWork + len > capWork && usedWork > 0) {
      overflow.push({ task: t, why: 'over the 70% limit' });
      continue;
    }
    const deep = (t.prio || 0) >= 3 || len >= 50;
    const s = place(len, DAY.workStart, DAY.workEnd, deep ? 'deep' : 'any');
    if (s === null) {
      overflow.push({ task: t, why: 'no free slot long enough' });
      continue;
    }
    blocks.push({ id: `t-${t.id}`, kind: 'task', area: 'work', title: t.title, taskId: t.id, start: fromMin(s), end: fromMin(s + len), status: 'planned' });
    reserve(s, len);
    usedWork += len;
  }

  // 6. work-hour breaks (chess): personal, but they belong in work hours, after the morning focus time,
  //    at least an hour apart and 5 minutes clear of other blocks; they don't count towards the 70%.
  //    No slot left: they go to the evening like any personal task.
  const breaks = personal.filter((t) => isWorkBreak(t.title));
  for (const t of breaks) {
    const len = taskLength(t, focus);
    const spaced = blocks.filter((b) => isWorkBreak(b.title)).map((b) => ({ ...b, start: fromMin(toMin(b.start) - 60), end: fromMin(toMin(b.end) + 60) }));
    const padded = blocks.filter((b) => !b._gap).map((b) => (b.kind === 'meeting' || b.kind === 'lunch' ? b : { ...b, start: fromMin(toMin(b.start) - RULES.gap), end: fromMin(toMin(b.end) + RULES.gap) }));
    const slot = freeSlots({ blocks: [...padded, ...spaced, ...blocks.filter((b) => b._gap)] }, toMin(WORK_BREAKS_FROM), toMin(DAY.workEnd))
      .map(([a, b]) => [ceil5(a), b])
      .find(([a, b]) => b - a >= len);
    if (!slot) continue; // stays in `personal`: placed in the evening below
    blocks.push({ id: `t-${t.id}`, kind: 'personal', area: 'personal', title: t.title, taskId: t.id, start: fromMin(slot[0]), end: fromMin(slot[0] + len), status: 'planned' });
    personal.splice(personal.indexOf(t), 1);
  }

  // 7. evening: personal tasks first, then habits
  const freeEve = free(RULES.eveningFrom, DAY.end).reduce((n, [a, b]) => n + b - a, 0);
  const capEve = Math.min(RULES.eveningMax, Math.round(freeEve * RULES.fill));
  let usedEve = 0;
  const evening = [
    ...personal.map((t) => ({ len: taskLength(t, focus), block: { id: `t-${t.id}`, kind: 'personal', area: 'personal', title: t.title, taskId: t.id }, task: t })),
    ...habits.filter((h) => h && h.title?.trim()).map((h) => ({ len: RULES.habitLen, block: { id: `h-${h.id}`, kind: 'habit', title: h.title, habitId: h.id } })),
  ];
  for (const e of evening) {
    if (usedEve + e.len > capEve) {
      if (e.task) overflow.push({ task: e.task, why: 'evening already full' });
      else notes.push(`habit "${e.block.title}" not given a time (evening full); it still shows under Habits`);
      continue;
    }
    const s = place(e.len, RULES.eveningFrom, DAY.end, 'any');
    if (s === null) {
      if (e.task) overflow.push({ task: e.task, why: 'no free slot in the evening' });
      continue;
    }
    blocks.push({ ...e.block, start: fromMin(s), end: fromMin(s + e.len), status: 'planned' });
    reserve(s, e.len);
    usedEve += e.len;
  }

  // every block goes into the Plan calendar (meetings are already in the primary one): starts are announced there
  const final = blocks.filter((b) => !b._gap).map((b) => ({ ...b, cal: true }));
  return {
    plan: cleanPlan({ id: planId(date), date, made: Date.now(), blocks: final }),
    overflow,
    notes,
    stats: { freeWork, capWork, usedWork, capEve, usedEve },
  };
}

// Calendar events for the "Plan" calendar: everything except the meetings (those are already there).
const COLOR = { task: '9', personal: '10', habit: '2', prep: '8', lunch: '5', break: '8' }; // Google colorIds
export const BRIEF_AT = '07:45';
export function calendarEvents(plan, timeZone = 'Europe/Warsaw') {
  const events = plan.blocks
    .filter((b) => b.kind !== 'meeting')
    .map((b) => ({
      summary: b.title,
      start: { dateTime: `${plan.date}T${b.start}:00`, timeZone },
      end: { dateTime: `${plan.date}T${b.end}:00`, timeZone },
      colorId: COLOR[b.kind],
      description: `to-do plan · ${b.kind}${b.taskId ? ' · task ' + b.taskId : ''}`,
      overrideReminders: [{ method: 'popup', minutes: 0 }], // the start alert on the locked phone (the app sends the end alerts)
    }));
  // The morning brief as a calendar alert: Gmail never notifies about mail you send yourself, but a Plan
  // calendar popup shows on the locked screen. Title = the top 3; description = the whole day.
  const top = plan.blocks.filter((b) => b.kind === 'task').slice(0, 3);
  const pick = top.length ? top : plan.blocks.filter((b) => ['personal', 'habit'].includes(b.kind)).slice(0, 3);
  if (pick.length) {
    const meetings = plan.blocks.filter((b) => b.kind === 'meeting').length;
    const end = fromMin(toMin(BRIEF_AT) + 5);
    events.push({
      summary: `Top ${pick.length}: ${pick.map((b) => b.title).join(' · ')}`,
      start: { dateTime: `${plan.date}T${BRIEF_AT}:00`, timeZone },
      end: { dateTime: `${plan.date}T${end}:00`, timeZone },
      colorId: '11',
      description: `to-do plan · brief\n${meetings} meeting${meetings === 1 ? '' : 's'} today\n\n` + plan.blocks.map((b) => `${b.start} ${b.title}`).join('\n'),
      overrideReminders: [{ method: 'popup', minutes: 0 }],
    });
  }
  return events;
}

export function summary({ plan, overflow, notes, stats }) {
  const lines = [`Plan for ${plan.date}`];
  for (const b of plan.blocks) lines.push(`  ${b.start}–${b.end}  ${b.kind.padEnd(8)} ${b.title}`);
  lines.push(`  work: ${stats.usedWork} of ${stats.capWork} min planned (70% of ${stats.freeWork} free) · evening: ${stats.usedEve} of ${stats.capEve} min`);
  for (const o of overflow) lines.push(`  didn't fit: ${o.task.title} (${o.why})`);
  for (const n of notes) lines.push(`  note: ${n}`);
  return lines.join('\n');
}

// ---------- command line ----------
const here = path.dirname(fileURLToPath(import.meta.url));
const syncCli = path.join(here, 'sync.cjs');
const run = (args, input) => execFileSync(process.execPath, [syncCli, ...args], { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'inherit'] });

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k) => {
    const i = process.argv.indexOf('--' + k);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const has = (k) => process.argv.includes('--' + k);
  try {
    const date = arg('date');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('--date YYYY-MM-DD is required');
    const mFile = arg('meetings');
    const meetings = mFile ? JSON.parse(fs.readFileSync(mFile === '-' ? 0 : mFile, 'utf8')) : [];
    if (!Array.isArray(meetings) || meetings.some((m) => isNaN(toMin(m.start)) || isNaN(toMin(m.end)))) throw new Error('meetings must be [{ title, start: "HH:MM", end: "HH:MM" }]');
    const recs = JSON.parse(run(['pull']));
    const of = (k) => recs.filter((r) => r.kind === k).map((r) => ({ ...r.data, id: r.id }));
    const plans = of('plan');
    const existing = planFor(plans, date);
    if (existing?.manual && !has('force')) throw new Error(`${date} has a plan the user made by hand (manual: true, e.g. a day off). Edit it instead, or use --force to replace it.`);
    if (existing && existing.blocks?.some((b) => b.status !== 'planned') && !has('force')) throw new Error(`${date} already has a plan with ticked or missed blocks. Use --force to replace it.`);
    const result = buildPlan({
      date,
      meetings,
      tasks: of('task'),
      habits: of('habit'),
      prevPlan: planFor(plans, addDays(date, -1)),
      // focus stays 25: the focus timer (and its length setting) is gone; "*2" in the app means 2 x 25 min
    });
    console.log(summary(result));
    if (arg('events')) fs.writeFileSync(arg('events'), JSON.stringify(calendarEvents(result.plan), null, 2));
    if (has('write')) {
      const tmp = path.join(os.tmpdir(), `plan-${date}.json`);
      fs.writeFileSync(tmp, JSON.stringify(result.plan));
      try {
        console.log(run(['put', 'plan', result.plan.id, tmp]).trim());
      } finally {
        fs.rmSync(tmp, { force: true });
      }
      console.log('saved: the app shows it after its next sync');
    } else console.log('(preview only: add --write to save it to the app)');
  } catch (e) {
    console.error('plan-day: ' + e.message);
    process.exitCode = 1;
  }
}
