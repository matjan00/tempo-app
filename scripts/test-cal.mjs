// Checks for the Plan-calendar mirror logic (supabase/functions/tempo-cal/lib.ts):  node scripts/test-cal.mjs
import { wanted, diff, zonedToUtc, eventBody } from '../supabase/functions/tempo-cal/lib.ts';

let failed = 0;
const assert = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) failed++; };
const B = (id, start, end, kind, title, x = {}) => ({ id, start, end, kind, title, status: 'planned', ...x });

const plan = { date: '2026-11-19', blocks: [
  B('h1', '08:00', '08:05', 'habit', '8:00 żelazo'),
  B('t1', '08:05', '08:35', 'task', 'Long term plany', { status: 'done' }),
  B('t2', '08:40', '09:10', 'task', 'Plan PO', { status: 'missed', moved: '15:00' }),
  B('t2b', '15:00', '15:30', 'task', 'Plan PO', { copyOf: 't2', cal: false }),
  B('m1', '12:00', '12:30', 'meeting', 'Denise 1:1'),
  B('l', '14:30', '15:00', 'lunch', 'Lunch'),
] };
const w = wanted(plan);
const keys = w.map((x) => x.key);
assert(!keys.includes('m1'), 'meetings are not copied into Plan');
assert(!keys.includes('t2') && keys.includes('t2b'), 'a missed block is dropped, its second try is written');
assert(keys.includes('t1'), 'done blocks stay (a record of the day)');
const brief = w.find((x) => x.key === 'brief');
assert(brief && brief.start === '07:45' && brief.summary === 'Top 2: Long term plany · Plan PO', 'brief at 07:45 with the top tasks: ' + brief?.summary);
assert(w.find((x) => x.key === 'l').colorId === '5', 'lunch keeps its colour');

// diff against what is in the calendar
const have = [
  { id: 'e1', key: 'h1', ours: true, summary: '8:00 żelazo', start: '08:00', end: '08:05', colorId: '2' }, // unchanged
  { id: 'e2', key: 't2', ours: true, summary: 'Plan PO', start: '08:40', end: '09:10', colorId: '9' }, // missed now
  { id: 'e3', key: null, ours: true, summary: 'Lunch', start: '14:00', end: '14:30', colorId: '5' }, // old planner event, no key
  { id: 'e4', key: 't1', ours: true, summary: 'Long term plany', start: '08:05', end: '08:55', colorId: '9' }, // time changed
  { id: 'e5', key: null, ours: false, summary: 'Evening review', start: '21:00', end: '21:15' }, // not ours
  { id: 'e6', key: 'h1', ours: true, summary: '8:00 żelazo', start: '08:00', end: '08:05', colorId: '2' }, // duplicate
];
const d = diff(w, have);
assert(!d.remove.includes('e1') && !d.update.some((u) => u.id === 'e1'), 'an unchanged event is left alone');
assert(d.remove.includes('e2'), 'the missed block\'s event is removed');
assert(d.remove.includes('e3'), 'an old event without a key is replaced');
assert(d.update.some((u) => u.id === 'e4' && u.w.end === '08:35'), 'a moved block is updated in place');
assert(!d.remove.includes('e5') && !d.update.some((u) => u.id === 'e5'), 'events that are not ours are never touched');
assert(d.remove.includes('e6'), 'a duplicate of our own event is removed');
assert(d.insert.some((x) => x.key === 't2b') && d.insert.some((x) => x.key === 'brief') && d.insert.some((x) => x.key === 'l'), 'new blocks, the brief and the re-keyed lunch are inserted');
// running again on the result changes nothing
const after = w.map((x, i) => ({ id: 'n' + i, key: x.key, ours: true, summary: x.summary, start: x.start, end: x.end, colorId: x.colorId }));
const d2 = diff(w, after);
assert(!d2.insert.length && !d2.update.length && !d2.remove.length, 'a second run is a no-op');
// an empty / deleted plan clears our events only
const d3 = diff(wanted({ date: '2026-11-19', blocks: [] }), have);
assert(d3.remove.length === 5 && !d3.remove.includes('e5'), 'an empty plan removes all of ours and nothing else');

// time zone: Warsaw is UTC+1 in winter, UTC+2 in summer, and the DST days work
assert(zonedToUtc('2026-11-19', '00:00', 'Europe/Warsaw').toISOString() === '2026-11-18T23:00:00.000Z', 'winter midnight in Warsaw');
assert(zonedToUtc('2026-07-01', '08:00', 'Europe/Warsaw').toISOString() === '2026-07-01T06:00:00.000Z', 'summer time');
assert(zonedToUtc('2027-03-28', '08:00', 'Europe/Warsaw').toISOString() === '2027-03-28T06:00:00.000Z', 'the morning after the clocks go forward');
const body = eventBody('2026-11-19', brief, 'Europe/Warsaw');
assert(body.reminders.useDefault === true && body.extendedProperties.private.key === 'brief' && body.start.dateTime === '2026-11-19T07:45:00', 'event body: the calendar default alert (the user own), our key, local time');
process.exitCode = failed ? 1 : 0;
