# Evening review + tomorrow's plan

Runs Sun–Thu at 20:45 Europe/Warsaw as a Claude cloud routine. The user reads your final message on their
phone (Claude app) at 21:00 and may reply in this same session. Be brief: they read it on a phone.

## Rules
- Times and dates are Europe/Warsaw. Get them with `TZ=Europe/Warsaw date +%F` / `+%H:%M`.
- Meetings come only from the user's **primary** Google calendar. Plan blocks go only into the calendar named
  **Plan**. In Plan, only ever change or delete events whose description starts with `to-do plan`.
- Never delete tasks, never send email or messages, never edit anything outside what's described here.
- Data goes through the scripts (they need the `SYNC_KEY` environment variable). If
  `node scripts/sync.cjs pull settings` fails, stop and tell the user what failed (missing key, network blocked).
- Language: English for your messages; keep task titles exactly as written (they may be Polish).

## 1. How did today go (skip on Sunday, or if there is no plan for today)
`node scripts/review.mjs day <today>` gives the score, done, missed (with reasons) and "notTicked" blocks.

## 2. Tomorrow's meetings
List events on the primary calendar for tomorrow 00:00–24:00. Skip all-day events, events the user declined,
and anything whose description starts with `to-do plan`. Write them to `m.json` as
`[{"title": "...", "start": "HH:MM", "end": "HH:MM"}]` (local time; clip anything crossing midnight).

## 3. Build and save the plan
`node scripts/plan-day.mjs --date <tomorrow> --meetings m.json --write --events e.json`
If it refuses because tomorrow already has ticked blocks, don't force it: say so in your message.

## 4. Write the Plan calendar
Find the calendar named "Plan" (list calendars). List its events for tomorrow and delete the ones whose
description starts with `to-do plan`. Then create one event per entry in `e.json` on Plan: same summary,
start/end, colorId and description, a popup reminder at 0 minutes, and no notifications to anyone
(notificationLevel NONE).

## 5. Your message (this is the review)
```
Today: 72% (2 h 10 min of 3 h) · streak 3
Missed / not ticked:
 1. 10:30 Review pull requests: no reason yet
 2. 15:00 Answer emails: not ticked
Reply with a reason for each ("1 meeting ran over, 2 too tired") or "done 2" if you did it.

Tomorrow (Thu 19 Nov):
08:00 Write report (50 min)
11:50 Prep: Denise 1:1
12:00 Denise 1:1
...
Didn't fit: X, Y
Reply "ok", or tell me what to change ("move X to 15:00", "drop Y", "add Z 30 min").
```
Leave out sections that are empty. If tomorrow is Saturday or Sunday, skip steps 2–4 and say so.

## 6. When the user replies in this session
- Reasons: `node scripts/review.mjs reason <today> <blockId> "<reason>"` for each (block ids come from step 1).
- "done N": `node scripts/review.mjs done <today> <blockId>`.
- Changes to tomorrow: `node scripts/sync.cjs pull plan`, take tomorrow's plan, edit its `blocks` (keep the
  block format described at the top of `docs/js/plan.js`; no overlaps; nothing after 22:00), save it with
  `node scripts/sync.cjs put plan <id> file.json`. Then redo step 4 using
  `node scripts/review.mjs events <tomorrow> > e.json`.
- A new task: add it as a task record (`node scripts/sync.cjs put task <12 hex chars> file.json` with at least
  `title`, `area` ("work" or "personal"), `due`, `created` (ms), `done: false`), then place it like a change.
- Reply with a one-line confirmation and the changed times only.
