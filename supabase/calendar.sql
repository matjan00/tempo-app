-- to-do Plan-calendar mirror. Safe to re-run (idempotent). Run through scripts/setup-calendar.cjs.
-- Needs supabase/sync.sql (tempo_records) and supabase/push.sql (vault secret tempo_cron_secret) first.

-- Days whose plan changed and must be written to the Plan calendar. A burst of saves (a replan syncs several
-- records) collapses into one job per day, run a few seconds after the last save.
create table if not exists public.tempo_cal_jobs (
  date text primary key,
  due_at timestamptz not null default now(),
  attempts int not null default 0
);
alter table public.tempo_cal_jobs enable row level security; -- no policies: only the edge function
revoke all on public.tempo_cal_jobs from anon, authenticated;

create or replace function public.tempo_plan_to_cal() returns trigger language plpgsql security definer set search_path = public as $f$
begin
  if new.data ? 'date' then
    insert into public.tempo_cal_jobs (date, due_at, attempts) values (new.data->>'date', now() + interval '4 seconds', 0)
    on conflict (date) do update set due_at = excluded.due_at, attempts = 0;
  end if;
  return null;
end
$f$;
drop trigger if exists tempo_plan_to_cal on public.tempo_records;
create trigger tempo_plan_to_cal after insert or update on public.tempo_records
  for each row when (new.kind = 'plan' and not new.deleted) execute function public.tempo_plan_to_cal();

-- every 10 seconds: call the mirror only when a day is due
select cron.unschedule('tempo-cal-due') where exists (select 1 from cron.job where jobname = 'tempo-cal-due');
select cron.schedule('tempo-cal-due', '10 seconds', $job$
  select net.http_post(
    url := 'https://txhcnqwrdazgaxjwabln.supabase.co/functions/v1/tempo-cal',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'tempo_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000 -- a day can take a few seconds (Google sign-in + one call per event)
  )
  where exists (select 1 from public.tempo_cal_jobs where due_at <= now());
$job$);
