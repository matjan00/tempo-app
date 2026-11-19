// Pure parts of the Plan-calendar mirror (no network), so they can be tested with plain Node / Deno.
//
// A plan's blocks become events in the user's "Plan" Google calendar. Every event we own carries
// extendedProperties.private = { todo: '1', key: <block id | 'brief'> } and a description starting with
// "to-do plan". Events without that (meetings, the user's own) are never touched.

export type Block = {
  id: string;
  start: string;
  end: string;
  kind: string;
  title?: string;
  status?: string;
  taskId?: string;
};
export type Plan = { date: string; blocks: Block[] };
export type Wanted = {
  key: string;
  summary: string;
  start: string; // HH:MM local
  end: string;
  colorId: string;
  description: string;
};
export type Existing = { id: string; key: string | null; summary: string; start: string; end: string; colorId?: string; ours: boolean };

export const BRIEF_AT = '07:45';
// Google colorIds per block kind (same as scripts/plan-day.mjs)
const COLOR: Record<string, string> = { task: '9', personal: '10', habit: '2', prep: '8', lunch: '5', break: '8' };

const toMin = (s: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? ''));
  return m ? +m[1] * 60 + +m[2] : NaN;
};
const fromMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// What the Plan calendar should hold for this plan. Meetings live in the primary calendar; missed blocks are
// not happening any more, so they are left out (their second try, if any, is its own block).
export function wanted(plan: Plan): Wanted[] {
  const blocks = (plan.blocks || []).filter(
    (b) => b && b.kind !== 'meeting' && b.status !== 'missed' && !Number.isNaN(toMin(b.start)) && toMin(b.end) > toMin(b.start),
  );
  const out: Wanted[] = blocks.map((b) => ({
    key: String(b.id),
    summary: String(b.title || 'block').slice(0, 200),
    start: b.start,
    end: b.end,
    colorId: COLOR[b.kind] || '8',
    description: `to-do plan · ${b.kind}${b.taskId ? ' · task ' + b.taskId : ''}`,
  }));
  // the morning brief: a 07:45 alert whose title is the top 3
  const tasks = blocks.filter((b) => b.kind === 'task');
  const pick = (tasks.length ? tasks : blocks.filter((b) => b.kind === 'personal' || b.kind === 'habit')).slice(0, 3);
  if (pick.length) {
    const meetings = (plan.blocks || []).filter((b) => b && b.kind === 'meeting').length;
    out.push({
      key: 'brief',
      summary: `Top ${pick.length}: ${pick.map((b) => b.title || 'block').join(' · ')}`.slice(0, 250),
      start: BRIEF_AT,
      end: fromMin(toMin(BRIEF_AT) + 5),
      colorId: '11',
      description:
        `to-do plan · brief\n${meetings} meeting${meetings === 1 ? '' : 's'} today\n\n` +
        (plan.blocks || []).filter((b) => b && b.status !== 'missed').map((b) => `${b.start} ${b.title || ''}`).join('\n'),
    });
  }
  return out;
}

// The changes that make `have` (events on that day) match `want`. Only our own events are changed.
export function diff(want: Wanted[], have: Existing[]) {
  const ours = have.filter((e) => e.ours);
  const byKey = new Map<string, Existing>();
  const remove: string[] = [];
  for (const e of ours) {
    if (e.key && !byKey.has(e.key)) byKey.set(e.key, e);
    else remove.push(e.id); // no key (made by an older planner) or a duplicate: replace it
  }
  const insert: Wanted[] = [];
  const update: { id: string; w: Wanted }[] = [];
  const keep = new Set<string>();
  for (const w of want) {
    const e = byKey.get(w.key);
    if (!e) {
      insert.push(w);
      continue;
    }
    keep.add(w.key);
    if (e.summary !== w.summary || e.start !== w.start || e.end !== w.end || (e.colorId || '') !== w.colorId) update.push({ id: e.id, w });
  }
  for (const [k, e] of byKey) if (!keep.has(k)) remove.push(e.id);
  return { insert, update, remove };
}

// UTC instant of a local wall-clock time in a time zone (handles DST by correcting with the zone's offset).
export function zonedToUtc(date: string, hhmm: string, tz: string): Date {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const offset = (t: number) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
        .formatToParts(new Date(t))
        .map((x) => [x.type, x.value]),
    );
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - t;
  };
  let t = guess - offset(guess);
  t = guess - offset(t); // second pass lands right on DST days
  return new Date(t);
}

// Event JSON for the Calendar API
export const eventBody = (date: string, w: Wanted, tz: string) => ({
  summary: w.summary,
  description: w.description,
  start: { dateTime: `${date}T${w.start}:00`, timeZone: tz },
  end: { dateTime: `${date}T${w.end}:00`, timeZone: tz },
  colorId: w.colorId,
  // Alerts in Google Calendar are per person: overrides set here would only alert the service account. Using
  // the calendar's default makes the user's own default for Plan (a popup at 0 minutes) the start alert.
  reminders: { useDefault: true },
  extendedProperties: { private: { todo: '1', key: w.key } },
});
