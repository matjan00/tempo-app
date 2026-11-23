// Checks for the day-plan logic in docs/js/plan.js:  node scripts/test-plan.mjs
import * as P from '../docs/js/plan.js';
const B = (id, start, end, kind, extra = {}) => ({ id, start, end, kind, title: id, status: 'planned', ...extra });
const plan = P.cleanPlan({ id: 'd20261119', date: '2026-11-19', blocks: [
  B('deep', '08:00', '09:40', 'task', { area: 'work' }),
  B('prep', '09:50', '10:00', 'prep'), B('standup', '10:00', '10:30', 'meeting'),
  B('report', '10:30', '11:20', 'task', { area: 'work' }),
  B('mail', '13:00', '13:25', 'task', { area: 'work' }),
  B('lunch', '14:00', '14:30', 'lunch'),
  B('review', '14:30', '15:45', 'task', { area: 'work' }),
  B('gym', '17:00', '18:00', 'personal'), B('read', '21:00', '21:30', 'habit'),
]});
let failed = 0;
const assert = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) failed++; };
assert(P.score(plan).pct === 0 && P.score(plan).planned === 340, 'score counts scored minutes only: ' + P.score(plan).planned);
plan.blocks.find((b) => b.id === 'deep').status = 'done';
assert(P.score(plan, P.toMin('11:00')).pct === 100, 'score during the day only counts blocks that are due');
let r = P.missBlock(plan, 'report', 'slack fire', P.toMin('11:20'));
assert(r.moved === '11:20', 'missed block moves to the next free slot: ' + r.moved);
assert(r.plan.blocks.filter((b) => b.copyOf === 'report').length === 1 && P.score(r.plan).planned === P.score(plan).planned, 'the copy is not scored');
assert(r.plan.blocks.find((b) => b.id === 'report').reason === 'slack fire', 'reason is kept');
r = P.missBlock(plan, 'review', '', P.toMin('15:46'));
assert(r.moved === 'tomorrow', 'work missed after hours goes to tomorrow: ' + r.moved);
r = P.missBlock(plan, 'gym', '', P.toMin('18:00'));
assert(r.moved === '18:00', 'personal blocks can move later in the evening: ' + r.moved);
r = P.missBlock({ ...plan, blocks: plan.blocks.map((b) => (b.id === 'gym' ? { ...b, start: '16:30', end: '17:30' } : b)) }, 'gym', '', P.toMin('10:00'));
assert(r.moved === '16:00', 'an evening block missed early stays after work: ' + r.moved);
const rp = P.replanFrom(plan, P.toMin('12:00'));
assert(rp.plan.blocks.find((b) => b.copyOf === 'report')?.start === '12:00', 'replan: an unticked past block gets a copy from now');
assert(rp.plan.blocks.find((b) => b.id === 'mail').start === '13:00', 'replan: a later block that still fits keeps its time');
assert(rp.plan.blocks.find((b) => b.id === 'gym').start === '17:00', 'replan: evening blocks are never pulled into work hours');
const crowd = P.replanFrom({ ...plan, blocks: plan.blocks.map((b) => (b.id === 'mail' ? { ...b, start: '12:20', end: '13:10' } : b)) }, P.toMin('12:00'));
assert(crowd.plan.blocks.find((b) => b.id === 'mail').start === '12:50', 'replan: a block the copy now overlaps is pushed later: ' + crowd.plan.blocks.find((b) => b.id === 'mail').start);
const live = rp.plan.blocks.filter((b) => b.status !== 'missed');
assert(live.every((b, i) => !i || P.toMin(live[i - 1].end) <= P.toMin(b.start)), 'replan: no overlaps');
const late = P.replanFrom(plan, P.toMin('15:30'));
assert(late.tomorrow.map((b) => b.id).sort().join() === 'mail,report', 'late replan sends what no longer fits to tomorrow and leaves the block in progress: ' + late.tomorrow.map((b) => b.id));
const mk = (date, done) => ({ date, blocks: [B('a', '08:00', '09:40', 'task', { status: done ? 'done' : 'planned' })] });
const plans = [mk('2026-11-12', false), mk('2026-11-13', true), mk('2026-11-16', true), mk('2026-11-17', true)];
assert(P.streak(plans, '2026-11-18') === 3, 'streak skips weekends and days without a plan: ' + P.streak(plans, '2026-11-18'));
// adding a task during the day
let pb = P.placeBlock(plan, { id: 'new', kind: 'task', area: 'work', title: 'new work' }, 30, P.toMin('10:40'));
assert(pb?.start === '11:20' && pb.plan.blocks.find((b) => b.id === 'new').cal === false, 'new work task goes in the next free work slot, marked not in calendar: ' + pb?.start);
pb = P.placeBlock(plan, { id: 'new', kind: 'personal', area: 'personal', title: 'call mom' }, 30, P.toMin('10:40'));
assert(pb?.start === '16:00', 'a personal task added during work waits until after work: ' + pb?.start);
pb = P.placeBlock(plan, { id: 'new', kind: 'task', area: 'work', title: 'too late' }, 30, P.toMin('15:50'));
assert(pb === null, 'no work slot left: nothing placed');
pb = P.placeBlock(plan, { id: 'new', kind: 'task', area: 'work', title: 'big' }, 200, P.toMin('08:00'));
assert(pb === null, 'a block longer than any free gap is not placed');
assert(P.replanFrom(plan, P.toMin('12:00')).plan.blocks.find((b) => b.copyOf === 'report').cal === false, 'replan copies are marked not in calendar');
assert(P.missBlock(plan, 'report', '', P.toMin('11:20')).plan.blocks.find((b) => b.copyOf === 'report').cal === false, 'missed copies are marked not in calendar');
process.exitCode = failed ? 1 : 0;

// chess goes inside work hours (after 11:00, an hour apart), else after work
{
  const base = { blocks: [B('m', '12:00', '12:30', 'meeting'), B('l', '14:00', '14:30', 'lunch')] };
  let r1 = P.placeBlock(base, { id: 'c1', kind: 'personal', area: 'personal', title: 'Chess' }, 20, P.toMin('09:00'));
  assert(r1?.start === '11:00', 'chess added in the morning goes to 11:00, not the evening: ' + r1?.start);
  const r2 = P.placeBlock(r1.plan, { id: 'c2', kind: 'personal', area: 'personal', title: 'Chess' }, 20, P.toMin('09:00'));
  assert(r2?.start === '12:30' || P.toMin(r2?.start) >= P.toMin('12:20'), 'a second chess block keeps an hour from the first: ' + r2?.start);
  const late = P.placeBlock(base, { id: 'c3', kind: 'personal', area: 'personal', title: 'Chess' }, 20, P.toMin('15:50'));
  assert(late?.start === '16:00', 'chess with no work slot left goes after work: ' + late?.start);
  const other = P.placeBlock(base, { id: 'p', kind: 'personal', area: 'personal', title: 'Call mom' }, 20, P.toMin('09:00'));
  assert(other?.start === '16:00', 'other personal tasks still wait until after work: ' + other?.start);
  process.exitCode = failed ? 1 : 0;
}

// the cloud planner (buildPlan; nothing is read from or written to the server here)
{
  const { buildPlan } = await import('./plan-day.mjs');
  const date = '2026-11-19';
  const T = (id, title, area, extra = {}) => ({ id, title, area, done: false, prio: 0, created: 1, due: date, ...extra });
  const overlaps = (p) => p.blocks.some((a, i) => p.blocks.some((b, j) => j > i && P.toMin(a.start) < P.toMin(b.end) && P.toMin(b.start) < P.toMin(a.end)));
  const empty = buildPlan({ date });
  assert(empty.plan.blocks.length === 1 && empty.plan.blocks[0].kind === 'lunch', 'a day with nothing in it gets just lunch');
  const b2b = buildPlan({ date, meetings: [{ title: 'A', start: '09:00', end: '10:00' }, { title: 'B', start: '10:00', end: '11:00' }, { title: 'Long', start: '12:30', end: '15:00' }], tasks: [T('huge', 'Huge', 'work', { dur: 240 }), T('s', 'Small', 'work', { dur: 30 })] });
  assert(!overlaps(b2b.plan), 'back-to-back meetings: nothing overlaps');
  assert(b2b.plan.blocks.find((b) => b.kind === 'lunch')?.start === '15:00', 'lunch slides past a meeting that sits on it: ' + b2b.plan.blocks.find((b) => b.kind === 'lunch')?.start);
  assert(b2b.overflow.some((o) => o.task.id === 'huge'), 'a task longer than any gap is listed as overflow');
  assert(!b2b.plan.blocks.some((b) => b.id === 'p2'), 'no prep squeezed between back-to-back meetings');
  const chess = buildPlan({ date, tasks: [T('c', 'Chess', 'personal', { dur: 20 }), T('w', 'Report', 'work', { prio: 3 })] });
  const cb = chess.plan.blocks.find((b) => b.taskId === 'c');
  assert(cb && P.toMin(cb.start) >= P.toMin('11:00') && P.toMin(cb.end) <= P.toMin('16:00') && !overlaps(chess.plan), 'chess goes inside work hours after 11:00: ' + cb?.start);
  assert(chess.plan.blocks.every((b) => b.cal === true), 'every planned block is marked as in the calendar');
  // personal tasks due that day are never cut by the evening limit (the dog walk went missing on 2026-11-24)
  const eve = buildPlan({ date, tasks: [T('v', 'Vinted', 'personal', { dur: 60 }), T('p', 'Plan', 'personal', { dur: 30 }), T('d', 'Spacer z psem', 'personal', { dur: 60 }), T('s', 'Sprzątanie', 'personal', { dur: 30 }), T('later', 'Someday', 'personal', { dur: 30, due: null })] });
  assert(['v', 'p', 'd', 's'].every((id) => eve.plan.blocks.some((b) => b.taskId === id)) && !overlaps(eve.plan), 'every personal task due that day gets a block, even over the evening limit');
  assert(eve.overflow.some((o) => o.task.id === 'later'), 'an undated task still respects the evening limit');
  const morning = buildPlan({ date, tasks: [T('m', 'Wyciągnąć rano mięso', 'personal')], habits: [{ id: 'fe', title: '8:00 żelazo' }] });
  const mb = morning.plan.blocks.find((b) => b.taskId === 'm');
  assert(mb?.start === '07:50' && mb.end === '07:55', 'a "rano" task is a 5-minute reminder before 08:00: ' + mb?.start + '–' + mb?.end);
  // a day off
  const off = buildPlan({ date, off: true, meetings: [{ title: 'Fryzjer', start: '11:00', end: '11:45' }], tasks: [T('m', 'Wyciągnąć rano mięso', 'personal'), T('w', 'Report', 'work', { dur: 60 }), T('d', '13:00 Spacer z psem', 'personal', { dur: 60 }), T('v', 'Vinted', 'personal', { dur: 60 })], habits: [{ id: 'fe', title: '8:00 żelazo' }] });
  const ob = (id) => off.plan.blocks.find((b) => b.taskId === id || b.id === id);
  assert(off.plan.off === true && !overlaps(off.plan), 'day off: plan is marked off, nothing overlaps');
  assert(ob('breakfast')?.start === '08:05', 'day off: breakfast right after the morning things: ' + ob('breakfast')?.start);
  assert(ob('d')?.start === '13:00', 'a task with a time in its title goes at that time: ' + ob('d')?.start);
  assert(P.toMin(ob('v')?.start) < P.toMin('12:00'), 'day off: personal tasks go in the morning, not after 16:30: ' + ob('v')?.start);
  assert(!ob('w') && off.overflow.some((o) => o.task.id === 'w' && o.why === 'day off'), 'day off: work tasks wait and are listed');
  assert(!off.plan.blocks.some((b) => b.kind === 'prep'), 'day off: no prep before meetings');
}

// quick-add durations (docs/js/parse.js)
{
  const { parseQuick } = await import('../docs/js/parse.js');
  const q = (s) => parseQuick(s);
  assert(q('read 1h30').dur === 90 && q('read 1h 30').dur === 90 && q('read 1h 30m').dur === 90, '1h30 / 1h 30 / 1h 30m are 90 minutes');
  assert(q('buy 1h 5 tickets').dur === 60 && q('buy 1h 5 tickets').title === 'buy 5 tickets', 'a small count after the hours stays in the title: ' + JSON.stringify(q('buy 1h 5 tickets')));
  assert(q('gym 45m tomorrow').dur === 45 && q('gym 45m tomorrow').title === 'gym', '45m is picked up');
  process.exitCode = failed ? 1 : 0;
}
