# Morning brief

Runs Mon–Fri at 07:30 Europe/Warsaw as a Claude cloud routine (before the 07:45 brief alert). Same rules as `routines/evening-review.md`
(times, calendars, what you may touch, scripts and `SYNC_KEY`).

## 1. Catch late calendar changes
Read today's meetings from the primary calendar (same filters as the evening review, step 2) and compare
them with the meetings in today's plan (`node scripts/sync.cjs pull plan`, the plan whose `date` is today).
- Today's plan has `manual: true` (the user planned the day by hand, e.g. a day off): never rebuild it, even
  if meetings changed; mention a changed meeting in the email instead.
- No plan for today: build it (evening review steps 2–4, for today).
- Meetings changed and nothing in today's plan is ticked or missed yet: rebuild it the same way.
- Otherwise leave the plan alone.

The plan's calendar events include a "Top 3: …" event at 07:45 (description `to-do plan · brief`): that popup
is the brief the user actually sees on the locked phone (Gmail never notifies about mail sent to yourself).
When you rebuild, the server rewrites the Plan calendar (and that event) by itself: just check it as in evening
review step 4.

## 2. Email the brief (a full copy for reference)
Send one plain-text email with Gmail to the user's own address (given in the routine prompt), nothing else.

Subject: `Plan for <Thu 19 Nov>: <n> meetings, top 3 inside`

Body:
```
Top 3 today
1. <first work task block> (08:05, 50 min)
2. ...
3. ...

Timeline
08:00 8:00 żelazo
08:05 Przygotować Long term plany
...

Yesterday: <score>% · streak <n>
```
Top 3 = the first three work-task blocks in the plan; fewer if there are fewer. Leave out "Yesterday" when
yesterday had no plan (`node scripts/review.mjs day <yesterday>`). Mention in one line if you rebuilt the plan
because meetings changed.
