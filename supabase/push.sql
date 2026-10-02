-- Tempo push timers. Run once (secret is substituted at run time, never committed).
create table if not exists public.tempo_push_timers (
  endpoint text primary key,
  p256dh text not null,
  auth text not null,
  fire_at timestamptz not null,
  title text not null default 'Tempo',
  body text not null default ''
);
alter table public.tempo_push_timers enable row level security; -- no policies: only the edge function (service role) can touch it
create index if not exists tempo_push_timers_fire_at on public.tempo_push_timers (fire_at);

create extension if not exists pg_net;
create extension if not exists pg_cron;

select cron.unschedule('tempo-push-due') where exists (select 1 from cron.job where jobname = 'tempo-push-due');
-- every 10 seconds: only call the function when something is actually due
select cron.schedule('tempo-push-due', '10 seconds', $job$
  select net.http_post(
    url := 'https://txhcnqwrdazgaxjwabln.supabase.co/functions/v1/tempo-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '__CRON_SECRET__'),
    body := '{"action":"send-due"}'::jsonb
  )
  where exists (select 1 from public.tempo_push_timers where fire_at <= now());
$job$);
