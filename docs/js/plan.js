// Day plans: pure functions only (no screen, no storage), so the planner script can use them too.
//
// A plan is one record per date:
//   { id: 'd20261119', date: '2026-11-19', made: <ms>, blocks: [block, ...] }
// A block:
//   { id, start: '08:00', end: '08:50', kind, title, area?, taskId?, habitId?, status, reason?, moved?, copyOf? }
//   kind:   meeting | prep | lunch | break   (fixed: never moved, never scored)
//           task | habit | personal          (scored: count towards the day's score)
//   status: planned | done | missed
//   moved:  'HH:MM' (moved to later today) or 'tomorrow', set on a missed block
//   copyOf: id of the missed block this one replaces. Copies are a second chance, not part of the score.
//   cal:    false when the block is not (or no longer) at this time in the Plan Google calendar (added or moved
//           in the app), so the push server announces its start instead of the calendar.

export const FIXED = ['meeting', 'prep', 'lunch', 'break'];
export const SCORED = ['task', 'habit', 'personal'];
export const DAY = { wake: '07:30', workStart: '08:00', workEnd: '16:00', end: '22:00' };
export const STREAK_PCT = 80;
// Personal things that belong inside work hours (short breaks): placed after the morning focus time
// (from WORK_BREAKS_FROM), spread apart, and only after work when no slot fits.
export const WORK_BREAKS = [/\bchess\b/i, /\bszach/i];
export const WORK_BREAKS_FROM = '11:00';
export const isWorkBreak = (title) => WORK_BREAKS.some((re) => re.test(String(title || '')));

const pad = (n) => String(n).padStart(2, '0');
export const toMin = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
export const fromMin = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
export const nowMin = (d = new Date()) => d.getHours() * 60 + d.getMinutes();
export const planId = (date) => 'd' + String(date).replace(/-/g, '');
export const dur = (b) => toMin(b.end) - toMin(b.start);

const isWorkBlock = (b) => b.area === 'work' || (b.kind === 'task' && b.area !== 'personal');
const scoredBlock = (b) => SCORED.includes(b.kind) && !b.copyOf;

// Make sure a plan from anywhere (sync, planner) has the shape the screens expect.
export function cleanPlan(p) {
  const blocks = (Array.isArray(p?.blocks) ? p.blocks : [])
    .filter((b) => b && typeof b === 'object' && !Number.isNaN(toMin(b.start)) && toMin(b.end) > toMin(b.start))
    .map((b, i) => ({
      ...b,
      id: typeof b.id === 'string' && /^[\w-]+$/.test(b.id) ? b.id : `b${i}`,
      kind: [...FIXED, ...SCORED].includes(b.kind) ? b.kind : 'task',
      title: String(b.title ?? ''),
      status: ['planned', 'done', 'missed'].includes(b.status) ? b.status : 'planned',
    }))
    .sort((a, b) => toMin(a.start) - toMin(b.start));
  return { ...p, blocks };
}

export const planFor = (plans, date) => (plans || []).find((p) => p && p.date === date) || null;

// Minutes planned vs done for scored blocks. Missed blocks count as planned, not done.
// Blocks still ahead of `upTo` (minutes; default: the whole day) are left out, so the score
// during the day reflects only what was due so far.
export function score(plan, upTo = Infinity) {
  let planned = 0;
  let done = 0;
  for (const b of plan?.blocks || []) {
    if (!scoredBlock(b)) continue;
    if (b.status !== 'done' && toMin(b.end) > upTo) continue;
    const m = dur(b);
    planned += m;
    if (b.status === 'done') done += m;
  }
  return { planned, done, pct: planned ? Math.round((done / planned) * 100) : null };
}

const isWeekday = (date) => {
  const d = new Date(date + 'T12:00:00').getDay();
  return d !== 0 && d !== 6;
};
const prevDay = (date) => {
  const d = new Date(date + 'T12:00:00');
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// Work days in a row at STREAK_PCT or better, counted back from yesterday (today joins once it is
// already good enough). Weekends and days without a plan are skipped, they never break the streak.
export function streak(plans, today) {
  let n = 0;
  const t = planFor(plans, today);
  if (t && isWeekday(today) && (score(t).pct ?? 0) >= STREAK_PCT) n++;
  let d = prevDay(today);
  for (let i = 0; i < 400; i++, d = prevDay(d)) {
    if (!isWeekday(d)) continue;
    const p = planFor(plans, d);
    if (!p || score(p).planned === 0) continue;
    if ((score(p).pct ?? 0) >= STREAK_PCT) n++;
    else break;
  }
  return n;
}

// The block happening now (or null).
export const currentBlock = (plan, at = nowMin()) =>
  (plan?.blocks || []).find((b) => b.status !== 'missed' && toMin(b.start) <= at && at < toMin(b.end)) || null;

// Free time between `from` and `to` (minutes), around every block that still takes up time
// (anything not missed, minus the ones listed in `ignore`).
export function freeSlots(plan, from, to, ignore = new Set()) {
  const busy = (plan?.blocks || [])
    .filter((b) => b.status !== 'missed' && !ignore.has(b.id))
    .map((b) => [toMin(b.start), toMin(b.end)])
    .sort((a, b) => a[0] - b[0]);
  const out = [];
  let cur = from;
  for (const [s, e] of busy) {
    if (e <= cur) continue;
    if (s > cur) out.push([cur, Math.min(s, to)]);
    cur = Math.max(cur, e);
    if (cur >= to) break;
  }
  if (cur < to) out.push([cur, to]);
  return out.filter(([s, e]) => e > s);
}

// The window a block may move within: work stays inside work hours; personal things planned for after
// work stay after work; anything else may go anywhere before the day ends.
function windowFor(b) {
  if (isWorkBlock(b)) return [toMin(DAY.workStart), toMin(DAY.workEnd)];
  if (toMin(b.start) >= toMin(DAY.workEnd)) return [toMin(DAY.workEnd), toMin(DAY.end)];
  return [toMin(DAY.wake), toMin(DAY.end)];
}

// Round up to the next 5 minutes, so moved blocks start at tidy times.
const ceil5 = (m) => Math.ceil(m / 5) * 5;

// Find a slot for `length` minutes for block `b`, starting no earlier than `at`.
function findSlot(plan, b, length, at, ignore) {
  const [lo, hi] = windowFor(b);
  for (const [s, e] of freeSlots(plan, Math.max(lo, ceil5(at)), hi, ignore)) if (e - s >= length) return s;
  return null;
}

let seq = 0;
const newId = () => 'b' + Date.now().toString(36) + (seq++).toString(36);

// Mark a block missed and put a copy in the next free slot today, or send it to tomorrow.
// Returns { plan, moved: 'HH:MM' | 'tomorrow' }. Does not touch the original plan object.
export function missBlock(plan, blockId, reason = '', at = nowMin()) {
  const p = structuredClone(plan);
  const b = p.blocks.find((x) => x.id === blockId);
  if (!b) return { plan: p, moved: null };
  b.status = 'missed';
  if (reason) b.reason = String(reason).slice(0, 300);
  if (FIXED.includes(b.kind)) return { plan: p, moved: null }; // a skipped meeting just stays skipped
  const slot = findSlot(p, b, dur(b), at, new Set([b.id]));
  if (slot === null) {
    b.moved = 'tomorrow';
    return { plan: p, moved: 'tomorrow' };
  }
  b.moved = fromMin(slot);
  const { reason: _r, moved: _m, status: _s, ...rest } = b;
  p.blocks.push({ ...rest, id: newId(), start: fromMin(slot), end: fromMin(slot + dur(b)), status: 'planned', copyOf: b.copyOf || b.id, cal: false });
  p.blocks.sort((x, y) => toMin(x.start) - toMin(y.start));
  return { plan: p, moved: b.moved };
}

// Add a block (without times) in the first free slot from `at`: work inside work hours, anything else
// after work (or from now, once work is over). Returns { plan, start } or null when nothing fits.
export function placeBlock(plan, block, length, at = nowMin()) {
  // chess & co: try work hours first (after the morning focus time, an hour away from another one), else after work
  if (block.kind !== 'task' && isWorkBreak(block.title)) {
    const others = plan.blocks.filter((b) => b.status !== 'missed' && isWorkBreak(b.title)).map((b) => ({ ...b, start: fromMin(Math.max(0, toMin(b.start) - 60)), end: fromMin(toMin(b.end) + 60) }));
    const lo = Math.max(toMin(WORK_BREAKS_FROM), ceil5(at));
    for (const [s, e] of freeSlots({ blocks: [...plan.blocks, ...others] }, lo, toMin(DAY.workEnd))) {
      if (e - s < length) continue;
      const p = structuredClone(plan);
      p.blocks.push({ status: 'planned', ...block, start: fromMin(s), end: fromMin(s + length), cal: false });
      p.blocks.sort((x, y) => toMin(x.start) - toMin(y.start));
      return { plan: p, start: fromMin(s) };
    }
  }
  const work = block.kind === 'task' && block.area !== 'personal';
  const lo = work ? toMin(DAY.workStart) : Math.max(toMin(DAY.workEnd), at);
  const hi = work ? toMin(DAY.workEnd) : toMin(DAY.end);
  for (const [s, e] of freeSlots(plan, Math.max(lo, ceil5(at)), hi)) {
    if (e - s < length) continue;
    const p = structuredClone(plan);
    p.blocks.push({ status: 'planned', ...block, start: fromMin(s), end: fromMin(s + length), cal: false });
    p.blocks.sort((x, y) => toMin(x.start) - toMin(y.start));
    return { plan: p, start: fromMin(s) };
  }
  return null;
}

// Rebuild the rest of the day from `at`:
// - unticked blocks that already ended become missed ("not done before replanning") and get a copy;
// - planned blocks still ahead keep their time unless something now overlaps them; then they are pushed
//   later (never earlier), in their original order;
// - fixed blocks (meetings, prep, lunch) and the block in progress stay where they are;
// - whatever doesn't fit is marked missed and moved to tomorrow.
// Returns { plan, tomorrow: [blocks sent to tomorrow] }.
export function replanFrom(plan, at = nowMin()) {
  const p = structuredClone(plan);
  const queue = [];
  for (const b of p.blocks) {
    if (FIXED.includes(b.kind) || b.status !== 'planned') continue;
    const s = toMin(b.start), e = toMin(b.end);
    if (s <= at && at < e) continue; // in progress: leave it
    if (e <= at) {
      b.status = 'missed';
      b.reason ||= 'not done before replanning';
      const { reason: _r, status: _s, ...rest } = b;
      queue.push({ ...rest, id: newId(), copyOf: b.copyOf || b.id, cal: false, from: b });
    } else queue.push({ ...b, from: b, keep: true });
  }
  const ignore = new Set(queue.filter((q) => q.keep).map((q) => q.id));
  // the blocks being repacked no longer hold their old times
  const tomorrow = [];
  const placed = [];
  for (const q of queue) {
    const { from, keep, ...b } = q;
    const temp = { ...p, blocks: [...p.blocks.filter((x) => !ignore.has(x.id)), ...placed] };
    const slot = findSlot(temp, b, dur(b), keep ? Math.max(at, toMin(b.start)) : at, new Set());
    if (slot === null) {
      if (keep) {
        from.status = 'missed';
        from.reason ||= 'no time left after replanning';
      }
      from.moved = 'tomorrow';
      tomorrow.push(from);
      continue;
    }
    const nb = { ...b, start: fromMin(slot), end: fromMin(slot + dur(b)) };
    if (nb.start !== b.start) nb.cal = false; // moved: the calendar still shows the old time
    placed.push(nb);
    if (!keep) from.moved = nb.start;
  }
  p.blocks = [...p.blocks.filter((x) => !ignore.has(x.id) || tomorrow.includes(x)), ...placed].sort((x, y) => toMin(x.start) - toMin(y.start));
  return { plan: p, tomorrow };
}
