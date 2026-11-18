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
