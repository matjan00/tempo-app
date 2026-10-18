-- to-do push timers. Safe to re-run (idempotent).
-- Run through scripts/setup-push.cjs, which substitutes __CRON_SECRET__ at run time (never committed).
-- If you paste this into the SQL editor yourself, replace __CRON_SECRET__ with the same value as the
-- CRON_SECRET function secret. Left unreplaced, the existing vault secret is kept untouched.
create table if not exists public.tempo_push_timers (
  endpoint text primary key,
  p256dh text not null,
  auth text not null,
  fire_at timestamptz not null,
  title text not null default 'to-do',
  body text not null default ''
);
alter table public.tempo_push_timers add column if not exists token text;                       -- sha-256 of the install's token
alter table public.tempo_push_timers add column if not exists attempts int not null default 0;  -- delivery retries
alter table public.tempo_push_timers alter column title set default 'to-do';
alter table public.tempo_push_timers enable row level security; -- no policies: only the edge function (service role) can touch it
revoke all on public.tempo_push_timers from anon, authenticated;
create index if not exists tempo_push_timers_fire_at on public.tempo_push_timers (fire_at);

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- The cron secret lives in Supabase Vault, not in the cron job's SQL text.
do $vault$
declare sid uuid;
begin
  if '__CRON_SECRET__' <> '__CRON' || '_SECRET__' then
    select id into sid from vault.secrets where name = 'tempo_cron_secret';
    if sid is null then
      perform vault.create_secret('__CRON_SECRET__', 'tempo_cron_secret');
    else
      perform vault.update_secret(sid, '__CRON_SECRET__');
    end if;
  end if;
end
$vault$;

select cron.unschedule('tempo-push-due') where exists (select 1 from cron.job where jobname = 'tempo-push-due');
-- every 10 seconds: only call the function when something is actually due
select cron.schedule('tempo-push-due', '10 seconds', $job$
  select net.http_post(
    url := 'https://txhcnqwrdazgaxjwabln.supabase.co/functions/v1/tempo-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'tempo_cron_secret')
    ),
    body := '{"action":"send-due"}'::jsonb
  )
  where exists (select 1 from public.tempo_push_timers where fire_at <= now());
$job$);

-- the 10-second job would otherwise fill cron.job_run_details forever
select cron.unschedule('tempo-push-purge') where exists (select 1 from cron.job where jobname = 'tempo-push-purge');
select cron.schedule('tempo-push-purge', '17 4 * * *', $purge$
  delete from cron.job_run_details where end_time < now() - interval '1 day';
$purge$);
