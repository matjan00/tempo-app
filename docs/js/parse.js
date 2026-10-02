// Quick-add: "call mom tomorrow !1 #family @work every week *2" → structured task fields.
// `ignore` is a Set of token kinds the user tapped away in the preview chips ('due', 'prio', 'est',
// 'repeat', 'project', 'tag:<name>'); those words then stay in the title as plain text.
import { todayStr, addDays, parseYmd, ymd } from './util.js';

const DOW = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 };
const DOW_RE = 'sun|sunday|mon|monday|tue|tues|tuesday|wed|weds|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday';

function nextWeekday(dow, strictlyAfterToday = true) {
  const t = todayStr();
  const cur = parseYmd(t).getDay();
  let add = (dow - cur + 7) % 7;
  if (add === 0 && strictlyAfterToday) add = 7;
  return addDays(t, add);
}

const empty = () => ({ title: '', due: null, prio: 0, tags: [], project: null, repeat: null, est: 0 });

export function parseQuick(input, projects = [], ignore = new Set()) {
  const original = String(input || '').trim();
  const r = empty();
  if (!original) return r;
  let s = ` ${original} `;
  const take = (re, fn) => {
    s = s.replace(re, (...m) => {
      const out = fn(...m);
      return out === false ? m[0] : ' ';
    });
  };
  const on = (kind) => !ignore.has(kind);

  if (on('repeat')) {
    // "every monday" = weekly, starting on the next Monday (today if it is Monday)
    take(new RegExp(`\\s(?:every|each)\\s+(${DOW_RE})(?=\\s)`, 'i'), (m, d) => {
      if (r.repeat) return false;
      r.repeat = 'weekly';
      if (on('due') && !r.due) r.due = nextWeekday(DOW[d.toLowerCase()], false);
    });
    take(/\s(?:every|each)\s+(day|weekday|weekdays|week|month)(?=\s)/i, (m, w) => {
      if (r.repeat) return false;
      r.repeat = { day: 'daily', weekday: 'weekdays', weekdays: 'weekdays', week: 'weekly', month: 'monthly' }[w.toLowerCase()];
    });
    take(/\s(daily|weekly|monthly)(?=\s)/i, (m, w) => {
      if (r.repeat) return false;
      r.repeat = w.toLowerCase();
    });
  }
  if (on('prio'))
    take(/\s!([1-3])(?=\s)/, (m, n) => {
      if (r.prio) return false;
      r.prio = 4 - Number(n); // !1 = high
    });
  if (on('est'))
    take(/\s\*(\d{1,2})(?=\s)/, (m, n) => {
      if (r.est) return false;
      r.est = Math.min(20, Number(n));
    });
  take(/\s#([\p{L}\d_-]+)(?=\s)/gu, (m, tag) => {
    const t = tag.toLowerCase();
    if (!on(`tag:${t}`)) return false;
    if (!r.tags.includes(t)) r.tags.push(t);
  });
  if (on('project'))
    take(/\s@([\p{L}\d_-]+)(?=\s)/gu, (m, name) => {
      if (r.project) return false;
      const n = name.toLowerCase();
      const p =
        projects.find((p) => p.name.toLowerCase().replace(/\s+/g, '-') === n) ||
        projects.find((p) => p.name.toLowerCase().startsWith(n));
      if (!p) return false;
      r.project = p.id;
    });

  // dates (first match wins)
  if (on('due') && !r.due) {
    const dateRules = [
      [/\s(\d{4}-\d{2}-\d{2})(?=\s)/, (m, d) => (ymd(parseYmd(d)) !== d ? false : (r.due = d))],
      [/\sin\s+(\d{1,3})\s+(day|days|week|weeks)(?=\s)/i, (m, n, u) => (r.due = addDays(todayStr(), Number(n) * (u.toLowerCase().startsWith('w') ? 7 : 1)))],
      [/\snext\s+week(?=\s)/i, () => (r.due = nextWeekday(1))],
      [/\snext\s+([a-z]+)(?=\s)/i, (m, d) => (DOW[d.toLowerCase()] === undefined ? false : (r.due = nextWeekday(DOW[d.toLowerCase()])))],
      [/\s(today|tonight)(?=\s)/i, () => (r.due = todayStr())],
      [/\s(tomorrow|tmr|tmrw)(?=\s)/i, () => (r.due = addDays(todayStr(), 1))],
      [new RegExp(`\\s(${DOW_RE})(?=\\s)`, 'i'), (m, d) => (r.due = nextWeekday(DOW[d.toLowerCase()]))],
    ];
    for (const [re, fn] of dateRules) {
      if (r.due) break;
      take(re, fn);
    }
  }

  // A repeating task needs a first date: today (or the next weekday for "every weekday").
  if (r.repeat && !r.due && on('due')) {
    const dow = parseYmd(todayStr()).getDay();
    r.due = r.repeat === 'weekdays' && (dow === 0 || dow === 6) ? nextWeekday(1) : todayStr();
  }

  r.title = s.replace(/\s+/g, ' ').trim();
  if (!r.title) {
    // The user only typed tokens (e.g. just "tomorrow") — keep it as the title instead.
    return { ...empty(), title: original };
  }
  return r;
}
