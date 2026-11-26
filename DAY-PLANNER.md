# Day planner: detailed plan

Status: Phases 1–5 built (2026-11-18). Phase 6, the test week, is next.

## What you get, in one picture

```
Your work calendar --(you copy meetings)--> Personal Google Calendar
                                                   |
21:00 Sun–Thu (cloud, PC can be off): Claude reads today's results, tomorrow's
meetings and your tasks (synced from the app), then messages you on your phone
                                                   |
evening review in the Claude app: what got done, reasons for misses, tweaks
                                                   |
                 builds tomorrow's plan, writes it to BOTH:
                 - a "Plan" calendar in Google Calendar (blocks around your meetings)
                 - a Day timeline in the to-do app (what you tick off)
                                                   |
07:45  morning brief email: the day + top 3 must-dos
08:00–22:00  lock-screen alarm at each block start and end ("done?")
missed block -> moves to the next free slot or tomorrow, you give a one-line reason
no reply by 22:00 -> the draft plan is locked in as is, so tomorrow always has a plan
Fri 21:00  weekly report · Sun 21:00  Monday's plan
```

## Your rules (from your answers)

| Rule | Value |
|---|---|
| Work days | Mon–Fri, remote |
| Day frame | wake 7:30 · work 8:00–16:00 · personal 16:00–22:00 · phone down 22:00 · sleep ~23:00 |
| Lunch | about 14:00, 30 min, protected (slides a little if a meeting sits on it) |
| Phone | Android: alarms have Done / Missed buttons right in the notification |
| Evening review | on your phone, in the Claude app, 21:00 |
| Morning (work days) | breakfast 8:00–8:30 · focus 8:30–10:00 · lighter 10:00–10:30 · focus 10:30–12:00 (meetings win; focus is what they leave free) |
| Meetings | 10 min prep block before each one |
| How full | about 70% of free time planned; the rest is slack |
| Breakfast | your own wins: a task or calendar event called "śniadanie" (e.g. "8:30 śniadanie") replaces the planner's 8:00 one |
| Personal | personal tasks planned after 16:00, nothing after 22:00 |
| Habits | take up no time, you just tick them; only timed ones ("8:00 żelazo") get a reminder at that time, on top of whatever is there |
| Chess | every day 2 × 20 min, wherever there is room 8:00–22:00 (work hours or evening), never in the focus blocks, an hour apart |
| Missed block | moves to next free slot (or tomorrow), counts against the score, one-line reason |
| Accountability | block alarms, evening review 21:00, daily score + streak, morning brief email |
| Today screen | the daily score + streak replaces the current "x of y done" progress line |

## How the planner fills a day

1. Fixed first: meetings from your personal calendar, breakfast 8:00–8:30 (right after a meeting if one sits there; skipped when you added your own "śniadanie" task or event, which stays at its time), 10 min prep before each meeting, lunch around 14:00.
2. Free gaps are listed for 8:00–16:00 and 16:00–22:00.
3. Capacity = 70% of each gap's minutes. The rest stays empty on purpose.
4. Work tasks are ranked: missed yesterday → overdue → due that day → no date → due later, then priority → older.
   - Important ones (!1 / !2, or 50 min and longer) go first, into the focus blocks 8:30–10:00 and 10:30–12:00, earliest free first.
     A task too long for one focus block goes into the biggest gap before 11:00.
   - Lighter work goes into the half hour 10:00–10:30, then outside the focus blocks. If nothing light takes it, it shows as "Luźniej".
   - Block length follows the task's estimate in pomodoros (1 = 25 min, 2 = 50 min…), so each block can be run with the app's focus timer.
5. Chess: two 20-minute sessions in the first free slots from 08:00 (the light half hour, after 12:00, the evening…),
   never inside the focus blocks, an hour apart. A "Chess"/"Szachy" task for the day becomes one of them.
6. Habits take no time: they're ticked on Today / Habits. A timed one ("8:00 żelazo") is a 5-minute reminder at exactly its time,
   even on top of a meal or a task.
7. Personal tasks go after 16:00, in the same order of priority. The evening is capped at 2 hours,
   but a personal task due that day (or overdue) still goes in if there is a free slot.
   - A task with "rano" / "morning" in its name is a 5-minute reminder from 07:50 (unless it has a duration).
   - A task whose name starts with a time ("13:00 Spacer z psem") goes at that time, like timed habits.
   - **Day off** (an all-day "wolne"/"urlop" event in your calendar, or you tell the evening review; `plan-day.mjs --off`):
     no prep, breakfast after the morning reminders, personal tasks fill the day from 08:00 (70% of free time),
     work tasks wait and are listed.
8. Anything that doesn't fit stays in the list with a "didn't fit" tag, so you see the overflow and can cut or move it in the review.
9. "Replan from now" button in the app: if a meeting moves during the day, the rest of the day is rebuilt from the current time.

## Daily score and streak

- Score = minutes of task blocks done ÷ minutes of task blocks planned (meetings and prep don't count; you can't fail a meeting someone else cancelled).
- Shown on the Today screen in place of the progress line: `Today 64% · streak 3`.
- Streak = consecutive work days at 80% or more. Weekends don't break it.
- Weekly report: score per day, most common miss reasons, which hours you skip most, and one change I suggest for next week.

## Build phases

### Phase 1: sync the app to Supabase (so I can read and write your tasks)
- Your Supabase project already runs the alarm function. Add tables for tasks, habits and day plans, locked to your account (Supabase sign-in by email code, row-level security: only you can read your rows).
- App keeps working offline; it syncs when online. Local data stays the source if a sync fails.
- I read and write through a key kept in a local `.env` file that's never committed.
- The README's "nothing leaves the device" section gets rewritten to say what's synced now.

### Phase 2: Day timeline in the app (done)
- Built: `docs/js/plan.js` (plan logic, also usable from scripts; tests in `scripts/test-plan.mjs`), `docs/js/day.js` + `docs/css/day.css` (timeline on Today).
- A block whose end passed without a tick shows "Not ticked" and counts as not done, but is only moved when you tap Missed (or Replan). Auto-moving would create duplicates whenever you simply forgot to tick; Phase 4's end-of-block alarm asks Done / Missed instead.
- A missed block's copy ("second try") gives the task another slot but does not count towards the score, so a miss still costs points.
- New block list for each date: time, title, type (meeting, prep, task, habit, personal), status (planned, done, missed, moved), miss reason.
- Today screen: timeline with a "now" line, tap a block to mark it done, start the focus timer on it, or mark it missed with a reason.
- Score + streak replace the progress line. "Replan from now" button.

### Phase 3: Google Calendar (planner built)
- Since 2026-11-19 the server mirrors every saved plan into the Plan calendar (Replan, Missed, add to plan included), so the calendar always shows the real times. See README "Plan calendar mirror".
- `scripts/plan-day.mjs` builds a day from the meetings + synced tasks and habits, saves it to the app (`--write`) and exports the calendar events (`--events`).
- Meetings live in the personal calendar; only planned blocks go into the "Plan" calendar, each with an alert at its start.
- Habits whose name starts with a time ("8:00 żelazo") become 5-minute reminders at that time. No prep before meetings outside work hours.
- You connect the Google Calendar connector for your personal account (Claude settings → Connectors). I can't do that part for you.
- I make a separate calendar called "Plan" for the blocks, so redoing a plan never touches your meetings, and you can hide it with one tap.
- Colours: deep work, light work, prep, personal and habits each get their own colour.

### Phase 4: alarms (done)
- Settings → Sync → "Ask done? when a block ends" registers the phone. The push server reads today's plan from the sync table and, when a still-open task/habit/personal block ends, sends a notification with **Done** and **Missed** buttons (works with the app closed, and follows plans the routines write). Done ticks the block; Missed opens the reason sheet.
- Block *start* alerts come from the Plan calendar (popup at 0 min), which lights up a locked phone best. Blocks the calendar doesn't know about (added or moved in the app, `cal: false`) get their start alert from the push server.
- Tasks have a "how long" (task sheet, or type `30m` / `1h` / `1h30` in quick-add); the planner uses it. Without one it guesses (50 min work, 25 min personal, or the focus estimate).
- A task added for today while today has a plan goes straight into the next free slot (work within 8–16, personal after 16:00, nothing after 22:00). "Also due today" rows have an "add to plan" button.
- The alarm server currently holds one timer per phone. Extend it to hold a day of alarms: block start ("Now: write report until 9:50") and block end ("Done?" with **Done** and **Missed** buttons in the notification).
- Missed (button, or end passed and not ticked): the block moves to the next free slot or tomorrow, and the reason is asked in the evening review.
- Nothing after 22:00.

### Phase 5: scheduled runs (in the cloud, since your PC is off)
- These run as Claude cloud routines from your GitHub repo (matjan00/tempo-app), so they work with the PC off. The Supabase key is stored as a secret in the cloud environment, never in the repo.
- 21:00 Sun–Thu, evening review in the Claude app on your phone:
  1. I send a push: "Review ready".
  2. In the Claude app I show today's score, the blocks you missed (you give a one-line reason for each) and a draft of tomorrow.
  3. You say "ok" or ask for changes ("move gym to 18:00", "drop X"). I then write the plan to the calendar and the app.
  4. If you don't reply by 22:00, the draft is locked in as is, and the review counts as skipped in the weekly report.
- 21:00 Fri: weekly report (no Saturday plan).
- 07:45 Mon–Fri: morning brief email to your own Gmail: the timeline, top 3 must-dos, yesterday's score.

### Phase 6: test week
- Run it for a week, then tune: block lengths, the 70%, alarm wording, the score threshold.

## Things you'll do yourself

- Connect Google Calendar (personal account) in Claude's settings → Connectors. Gmail is already connected.
- Each evening before 21:00, copy tomorrow's work meetings into your personal calendar.
- Sign in once in the to-do app with an email code to turn on sync.
- Keep the Claude app on your phone with notifications on, for the review.

## Assumed unless you say otherwise

- The score replaces only the "x of y done" progress line on Today. Everything else stays.
