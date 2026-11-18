# Morning brief

Runs Mon–Fri at 07:45 Europe/Warsaw as a Claude cloud routine. Same rules as `routines/evening-review.md`
(times, calendars, what you may touch, scripts and `SYNC_KEY`).

## 1. Catch late calendar changes
Read today's meetings from the primary calendar (same filters as the evening review, step 2) and compare
them with the meetings in today's plan (`node scripts/sync.cjs pull plan`, the plan whose `date` is today).
- No plan for today: build it (evening review steps 2–4, for today).
- Meetings changed and nothing in today's plan is ticked or missed yet: rebuild it the same way.
- Otherwise leave the plan alone.

## 2. Email the brief
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
