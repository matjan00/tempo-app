# Weekly report

Runs Fridays at 21:00 Europe/Warsaw as a Claude cloud routine. Same rules as `routines/evening-review.md`.
There is no Saturday plan; Monday is planned by Sunday's evening review.

1. First do the evening review's step 1 for today (Friday) and include it at the top.
2. `node scripts/review.mjs week <today>`: average score, score per day, streak, miss reasons and the hours
   where blocks were missed most.
3. Your message, short enough for a phone:
```
Week 16–20 Nov: average 74% · streak 3
Mon 80 · Tue 65 · Wed 90 · Thu 70 · Fri 66
Most missed: 15:00–16:00 (4×)
Top reasons: meeting ran over (3), too tired (2)
Next week: <one concrete change, e.g. "no deep work after 15:00, shorter afternoon blocks">
```
   Base the suggestion on the data (repeated reasons, the hours missed most). If a planner rule should change
   (block length, the 70% fill, lunch time), say which one; the user can ask for it in this session.
4. If the user replies with a change to the rules, edit `RULES` in `scripts/plan-day.mjs`, run
   `node scripts/test-plan.mjs`, commit on a new branch and open a pull request. Don't merge it.
