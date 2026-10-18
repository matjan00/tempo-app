# to-do
Tasks, Notion-style notes and a Pomodoro timer in one minimal phone app (PWA).

## Your data
Tasks, notes and settings are stored on the device only (browser storage). There is no account and no sync.

The one exception is the optional **locked-phone alarm** (Settings → alerts). If you turn it on, then each time a timer starts the app sends this to the push server (a Supabase edge function):
- the browser's push subscription (endpoint URL and keys, which identify that browser to its push service),
- when the timer ends, plus the notification title and text (for example the task name),
- a random per-install token that stops other people from cancelling or overwriting your timer.

The server keeps that row only until the alarm has been sent (or an hour after it was due), then deletes it. Nothing else leaves the device. Turn alerts off in Settings and the app unsubscribes and asks the server to drop your timer. If you never configure push, nothing is sent anywhere.

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
