# to-do
Tasks, Notion-style notes and a Pomodoro timer in one minimal phone app (PWA).

## Your data
Tasks, notes and settings are stored on the device (browser storage). There is no account. Two optional features send data to your own Supabase project:

**Sync** (Settings → Sync, off until you paste a sync key). When it's on, every task, habit, note page, focus session, day plan and setting (except the alarm on/off switch) is copied to the `tempo_records` table, and changes made elsewhere (another device, or the day planner through `scripts/sync.cjs`) come back down. Deleted items stay on the server as empty "deleted" markers so other devices learn about the delete. The table can only be reached through the `tempo-sync` function, which needs the sync key; only a hash of the key is stored on the server. Disconnecting stops syncing on that device but leaves the server copy; "reset everything" disconnects first, so it never wipes the server.

The other is the optional **locked-phone alarm** (Settings → alerts). If you turn it on, then each time a timer starts the app sends this to the push server (a Supabase edge function):
- the browser's push subscription (endpoint URL and keys, which identify that browser to its push service),
- when the timer ends, plus the notification title and text (for example the task name),
- a random per-install token that stops other people from cancelling or overwriting your timer.

The server keeps that row only until the alarm has been sent (or an hour after it was due), then deletes it. With sync off, nothing else leaves the device.

**Block alerts** (Settings → Sync → "Ask done? when a block ends", needs sync): the phone's push subscription, a per-install token hash and its time zone are kept in `tempo_push_devices` until you turn it off (or the push service drops the subscription). The push function reads today's plan from `tempo_records` and sends a "Done?" notification with Done / Missed buttons when an open block ends. Turn alerts off in Settings and the app unsubscribes and asks the server to drop your timer. If you never configure push, nothing is sent anywhere.

## Commands
- Preview locally: `node scripts/serve.cjs` then open http://localhost:5195 (set `PORT` to change it)
- Before every publish: `node scripts/release.cjs`
  - Rebuilds the offline file list in `docs/sw.js` and bumps the cache version (`tempo-vN`) and `docs/js/version.js`, so phones replace their saved copy.
  - It only bumps if a cached file was added, removed or changed since the last release (a content hash is stored in `sw.js`). `--force` bumps anyway.
  - `node scripts/release.cjs --check` changes nothing and exits non-zero if `sw.js` is stale. Handy before pushing.
  - Only html, css, js, webmanifest, png, svg, ico and json files are cached; dotfiles, `.map` and `Thumbs.db` are skipped.
- Icons: `node scripts/make-icons.cjs`

## Locked-phone alarm (Supabase)
Files: `supabase/functions/tempo-push/index.ts` (function), `supabase/push.sql` (table, cron job, vault secret), `scripts/setup-push.cjs` (installer), `docs/js/push.js` and `docs/js/push-config.js` (app side).

One-time setup (needs `npx supabase login` first):
```
node scripts/setup-push.cjs --subject=mailto:you@example.com
```
This creates the table and a 10-second cron job, stores the secrets, deploys the function and writes `docs/js/push-config.js` (public values only). Re-running is safe: existing VAPID keys are kept unless you pass `--rotate` (which invalidates every phone's subscription). `push.sql` is idempotent, so after changing it you can re-run the script, or re-run just the function deploy with `npx supabase functions deploy tempo-push --no-verify-jwt`.

Function secrets: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `CRON_SECRET`, `VAPID_SUBJECT` (contact `mailto:`/`https:` URL; a placeholder is used if missing), and optionally `ALLOW_LOCAL=1` to accept calls from `http://localhost:5195` during development. The cron secret is kept in Supabase Vault for the cron job. Browser calls are only accepted from the published site's origin.

## Day plans
One plan per date (`plans` in the saved data, `plan` records in sync), shown as a timeline on Today with a score and streak. Shape and rules are documented at the top of `docs/js/plan.js`. Tests: `node scripts/test-plan.mjs`.

## Sync (Supabase)
Files: `supabase/functions/tempo-sync/index.ts` (function), `supabase/sync.sql` (table + `tempo_sync_write` function), `scripts/setup-sync.cjs` (installer), `scripts/sync.cjs` (read/write from scripts), `docs/js/sync.js` (app side).

One-time setup (needs `npx supabase login` first):
```
node scripts/setup-sync.cjs
```
It creates the table, stores the hash of a new sync key as the `SYNC_KEY_HASH` function secret, deploys the function and writes `SYNC_KEY` and `SYNC_URL` to `.env` (gitignored). It prints the key: paste it into the app under Settings → Sync. Re-running keeps the key; `--rotate` makes a new one (every device must reconnect).

Scripts:
- `node scripts/sync.cjs pull [kind]` prints the live records (`task`, `habit`, `page`, `session`, `settings`, `plan`).
- `node scripts/sync.cjs put <kind> <id> <file|->`, `put-many <file|->`, `delete <kind> <id>` write records. Writes are stamped with the current time: they beat older edits on the phone and lose to newer ones.

How conflicts are settled: each record has a server version number. A device sends the version it last saw plus the time of its edit; if someone else changed the record in between and their edit is newer, the server keeps theirs and the device takes it.
