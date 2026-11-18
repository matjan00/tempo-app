# Day planner: detailed plan

Status: Phases 1–2 built; Phase 3 planner built and first used for 2026-11-19. Phases 4–6 to do.

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
| Hardest work | 8:00–11:00, in the biggest gaps between meetings |
| Meetings | 10 min prep block before each one |
| How full | about 70% of free time planned; the rest is slack |
| Personal | personal tasks and habits planned after 16:00, nothing after 22:00 |
| Missed block | moves to next free slot (or tomorrow), counts against the score, one-line reason |
| Accountability | block alarms, evening review 21:00, daily score + streak, morning brief email |
| Today screen | the daily score + streak replaces the current "x of y done" progress line |

## How the planner fills a day

1. Fixed first: meetings from your personal calendar, then 10 min prep before each, then lunch around 14:00.
2. Free gaps are listed for 8:00–16:00 and 16:00–22:00.
3. Capacity = 70% of each gap's minutes. The rest stays empty on purpose.
4. Work tasks are ranked: overdue / missed yesterday → due tomorrow → priority → older.
   - The top-ranked (hardest) ones go into the largest gaps that start before 11:00.
   - Lighter work (admin, short tasks) goes into short gaps and after 11:00.
   - Block length follows the task's estimate in pomodoros (1 = 25 min, 2 = 50 min…), so each block can be run with the app's focus timer.
5. Habits and personal tasks go after 16:00, in the same order of priority.
6. Anything that doesn't fit stays in the list with a "didn't fit" tag, so you see the overflow and can cut or move it in the review.
7. "Replan from now" button in the app: if a meeting moves during the day, the rest of the day is rebuilt from the current time.

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
- `scripts/plan-day.mjs` builds a day from the meetings + synced tasks and habits, saves it to the app (`--write`) and exports the calendar events (`--events`).
- Meetings live in the personal calendar; only planned blocks go into the "Plan" calendar, each with an alert at its start.
- Habits whose name starts with a time ("8:00 żelazo") become 5-minute reminders at that time. No prep before meetings outside work hours.
- You connect the Google Calendar connector for your personal account (Claude settings → Connectors). I can't do that part for you.
- I make a separate calendar called "Plan" for the blocks, so redoing a plan never touches your meetings, and you can hide it with one tap.
- Colours: deep work, light work, prep, personal and habits each get their own colour.

### Phase 4: alarms
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
