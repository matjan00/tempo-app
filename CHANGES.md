# Changes: polish pass

Storage keys (`tempo.v1`, `tempo.theme`, `tempo.tab`, `tempo.hideInstall`) are unchanged. Old saves and old backups still load. `migrate()` only fills in missing fields. No new files or dependencies. `supabase/`, `scripts/setup-push.cjs` and `docs/js/push-config.js` were not touched.

## Bugs fixed
- **"Reset everything" did nothing.** The app saved its data again while the page reloaded, so the old data came back. `store.resetAll()` now stops saving first.
- **Undo after finishing a repeating task** left a duplicate behind and stopped the task repeating. Undo now removes the new copy and turns repeat back on.
- **Board "move to done"** skipped the repeat logic, so no next copy was made. It now uses the same path as the checkbox, including undo.
- **Repeat dates**
  - A monthly task on the 31st jumped to the 3rd of the next-but-one month. It now uses the last day of the month and goes back to the 31st when the month has one.
  - A weekly task finished late moved to a different weekday. It now keeps its weekday.
- **Task sheet**
  - Tags typed and then closed with Back or a backdrop tap were lost. They are now saved as you type.
  - A subtask typed but not yet added is now saved when the sheet closes.
  - Clearing a task's name left a task with no name. The old name comes back on close.
- **Deleted-task undo** put the task back at the top of the list. It now goes back to where it was. The same applies to projects and pages, which can now also be undone.
- **Notes editor**
  - Pressing Enter at the start of a heading or list item turned its text into a plain paragraph. It now opens an empty line above instead.
  - A page with several blank lines was never thrown away on close. It now is, and a toast says so.
  - A line break pasted into the page title stayed visible.
  - Esc closed the whole page instead of just the slash menu.
- **Timer**
  - Changing the focus length in Settings during a paused session broke the ring and logged the wrong minutes. A session now keeps the length it started with.
  - Switching to focus by hand after skipping the long break made the next break long again and left the cycle dots wrong. The cycle now wraps.
  - Tapping ▶ on a task during a running focus session reset the timer. It now just switches the task.
- **Stats**
  - Empty days in the 15-week heatmap were invisible because of an empty `style=""` that matched `.stat-cell[style]`.
  - Bars were still rounded.
- **Quick add**
  - "tom" and "tod" were read as dates, which hit names like "fix tom bug". They are no longer dates; "tmrw" and "tonight" were added.
  - Invalid dates such as `2026-02-30` were accepted.
  - A repeating task with no date went to "no date". It now starts today, or on Monday for "every weekday" typed at the weekend.
- **Today screen** did not move to the next day if the app stayed open past midnight.
- **Composer** covered the last task in a list. The list now has enough space at the bottom.
- **Imported backups** with missing fields (no `sub`, `tags`, `blocks`…) crashed the screens. They are now normalised on load.
- **Leftover uppercase**: placeholders, "Choose a task", "Untitled", "Empty" and the slash-menu placeholders. Toasts and notification strings are now lowercase in the source. The remaining "Tempo" strings now say "to-do".
- **Leftover rounded or soft styling**: note checkboxes, note icons, slash menu, toolbar buttons, the empty stats box, the timer controls (now square) and the dots in the stats project list.

## UX / UI improvements
- **Press and hold a task** (or right-click it) to open a quick-actions sheet: today, tomorrow, next week, no date, done, focus, open, delete. Each action has undo. A new seed task explains this.
- **Quick-add preview chips can be tapped away.** If a word was picked up by mistake (like "sat" or "daily" in a title), tap its chip and the word stays in the title.
- "every monday" (or any weekday) now creates a weekly task starting on that day.
- **Undo everywhere instead of "are you sure?"**: delete task, project, page or note block, complete a task, reschedule, "do today", and timer reset / skip / mode switch. Toasts with an action stay up for 5 seconds, and at most 3 show at once.
- **Focus screen**
  - The time is bigger and bold.
  - The mode is shown inside the dial.
  - The header says "session 2 of 4" or "up next…".
  - The current dot is highlighted.
  - The chosen task shows as a chip; with no task, a dashed "choose a task" button shows.
  - The progress line reads "2/4 sessions today · 50m · goal reached".
  - The dial scales with screen height so the whole screen fits without scrolling.
- **Completion feedback**: a repeating task's toast says when the next copy is due. A newly added task briefly highlights and scrolls into view. If it lands on a different screen, a toast says where it went.
- **Each tab remembers its scroll position** when you switch tabs.
- **Tap targets are at least 44px** (icon buttons, chips, steppers, swatches, toolbar). Small checkboxes get an invisible larger hit area.
- **Pressed states** follow the ink style: shadowed things press in, flat things invert. Task rows show feedback while held.
- **Keyboard focus** gets a thick accent outline (`:focus-visible` only). Sheets take focus when they open.
- **Screen-reader labels**: aria labels, pressed and current-page states, a timer role and a checkbox role in notes.
- **Contrast**: small red text (overdue, today, active tab) uses a deeper shade of the accent on light grey, about 5.7:1. Dark mode keeps the bright accent.
- **Empty and first-run states** are clearer on Today, Tasks (per project / inbox / all done), Notes search and Stats. The streak card says "focus today to keep it".
- **Small phones (≤360px)**: tighter gutters, a smaller install banner, and the settings swatches fit on one row.
- **Keyboard**: the viewport uses `interactive-widget=resizes-content`, so on Android Chrome the quick-add bar and notes toolbar sit right above the keyboard.
- Stats bars are solid ink with today in the accent colour. The range toggle now says "30 days", which is what it shows.

## Known leftovers / not verified
- White text on the red accent (buttons, the play icon) is 3.7:1. That is fine for large or bold UI but below 4.5:1 for normal text. Switching red's `ink` to `#111` in `theme.js` would fix it, but that is a design call.
- Needs a real phone to confirm:
  - The keyboard-open layout.
  - Long-press timing with Android's own long-press and haptics.
  - Backspace at the start of an empty note block with Gboard, which may only send a `beforeinput` event.
  - Locked-phone alarms.
- `sw.js` VERSION was not bumped. Run `scripts/release.cjs` before publishing, or phones will keep the old cached files.
- Subtask deletion inside the task sheet still has no undo (it is a small, local edit).
