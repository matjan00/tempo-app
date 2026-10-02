// Quick-add: "call mom tomorrow !1 #family @work every week *2" → structured task fields.
import { todayStr, addDays, parseYmd, ymd } from './util.js';

const DOW = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 };

function nextWeekday(dow, strictlyAfterToday = true) {
  const t = todayStr();
  const cur = parseYmd(t).getDay();
  let add = (dow - cur + 7) % 7;
  if (add === 0 && strictlyAfterToday) add = 7;
  return addDays(t, add);
}

export function parseQuick(input, projects = []) {
  const original = input.trim();
  const r = { title: '', due: null, prio: 0, tags: [], project: null, repeat: null, est: 0 };
  if (!original) return r;
  let s = ` ${original} `;
  const take = (re, fn) => {
    s = s.replace(re, (...m) => {
      const out = fn(...m);
      return out === false ? m[0] : ' ';
    });
  };

  take(/\s(?:every|each)\s+(day|weekday|weekdays|week|month)(?=\s)/i, (m, w) => {
    r.repeat = { day: 'daily', weekday: 'weekdays', weekdays: 'weekdays', week: 'weekly', month: 'monthly' }[w.toLowerCase()];
  });
  take(/\s(daily|weekly|monthly)(?=\s)/i, (m, w) => {
    r.repeat = w.toLowerCase();
  });
  take(/\s!([1-3])(?=\s)/, (m, n) => {
    r.prio = 4 - Number(n); // !1 = high
  });
  take(/\s\*(\d{1,2})(?=\s)/, (m, n) => {
    r.est = Math.min(20, Number(n));
  });
  take(/\s#([\p{L}\d_-]+)(?=\s)/gu, (m, tag) => {
    r.tags.push(tag.toLowerCase());
  });
  take(/\s@([\p{L}\d_-]+)(?=\s)/gu, (m, name) => {
    const n = name.toLowerCase();
    const p =
      projects.find((p) => p.name.toLowerCase().replace(/\s+/g, '-') === n) ||
      projects.find((p) => p.name.toLowerCase().startsWith(n));
    if (!p) return false;
    r.project = p.id;
  });

  // dates (first match wins)
  const dateRules = [
    [/\s(\d{4}-\d{2}-\d{2})(?=\s)/, (m, d) => (r.due = d)],
    [/\sin\s+(\d{1,3})\s+(day|days|week|weeks)(?=\s)/i, (m, n, u) => (r.due = addDays(todayStr(), Number(n) * (u.toLowerCase().startsWith('w') ? 7 : 1)))],
    [/\snext\s+week(?=\s)/i, () => (r.due = nextWeekday(1))],
    [/\snext\s+([a-z]+)(?=\s)/i, (m, d) => (DOW[d.toLowerCase()] === undefined ? false : (r.due = nextWeekday(DOW[d.toLowerCase()])))],
    [/\s(today|tod)(?=\s)/i, () => (r.due = todayStr())],
    [/\s(tomorrow|tmr|tom)(?=\s)/i, () => (r.due = addDays(todayStr(), 1))],
    [/\s(sun|sunday|mon|monday|tue|tues|tuesday|wed|weds|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday)(?=\s)/i, (m, d) => (r.due = nextWeekday(DOW[d.toLowerCase()]))],
  ];
  for (const [re, fn] of dateRules) {
    if (r.due) break;
    const before = s;
    take(re, fn);
    if (before === s) r.due = null;
  }

  r.title = s.replace(/\s+/g, ' ').trim();
  if (!r.title) {
    // The user only typed tokens (e.g. just "tomorrow") — keep it as the title instead.
    return { title: original, due: null, prio: 0, tags: [], project: null, repeat: null, est: 0 };
  }
  return r;
}
