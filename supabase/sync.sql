-- to-do sync: one row per record (task, habit, note page, focus session, settings, day plan).
-- Safe to re-run (idempotent). Run through scripts/setup-sync.cjs.
--
-- Only the tempo-sync edge function (service role) can touch this table: row-level security is on
-- with no policies, and the anon/authenticated roles have no grants. The function checks the sync key.
create sequence if not exists public.tempo_records_seq;

create table if not exists public.tempo_records (
  kind text not null,
  id text not null,
  data jsonb,                                  -- null when deleted
  deleted boolean not null default false,      -- kept as a tombstone so other devices learn about the delete
  mt bigint not null default 0,                -- when the change was made (ms since epoch, writer's clock)
  seq bigint not null default nextval('public.tempo_records_seq'), -- grows on every write: devices pull "everything after seq N"
  updated_at timestamptz not null default now(),
  primary key (kind, id)
);
alter table public.tempo_records enable row level security;
revoke all on public.tempo_records from anon, authenticated;
revoke all on sequence public.tempo_records_seq from anon, authenticated;
create index if not exists tempo_records_seq_idx on public.tempo_records (seq);

-- Write a batch of records. Each record carries `base` (the seq the writer last saw for it) and `mt`.
-- If someone else changed the record since `base` AND that change is newer than this one, the record
-- is rejected and the current server copy is returned, so the writer can take it instead.
create or replace function public.tempo_sync_write(recs jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
  cur public.tempo_records;
  acc jsonb := '[]'::jsonb;
  rej jsonb := '[]'::jsonb;
  s bigint;
  del boolean;
begin
  for r in select * from jsonb_array_elements(recs) loop
    select * into cur from public.tempo_records where kind = r->>'kind' and id = r->>'id' for update;
    if found and cur.seq > coalesce((r->>'base')::bigint, 0) and cur.mt > coalesce((r->>'mt')::bigint, 0) then
      rej := rej || jsonb_build_array(jsonb_build_object('kind', cur.kind, 'id', cur.id, 'data', cur.data, 'deleted', cur.deleted, 'mt', cur.mt, 'seq', cur.seq));
      continue;
    end if;
    del := coalesce((r->>'deleted')::boolean, false);
    s := nextval('public.tempo_records_seq');
    insert into public.tempo_records (kind, id, data, deleted, mt, seq, updated_at)
    values (r->>'kind', r->>'id', case when del then null else r->'data' end, del, coalesce((r->>'mt')::bigint, 0), s, now())
    on conflict (kind, id) do update
      set data = excluded.data, deleted = excluded.deleted, mt = excluded.mt, seq = excluded.seq, updated_at = now();
    acc := acc || jsonb_build_array(jsonb_build_object('kind', r->>'kind', 'id', r->>'id', 'seq', s));
  end loop;
  return jsonb_build_object('accepted', acc, 'rejected', rej);
end
$$;
revoke all on function public.tempo_sync_write(jsonb) from public, anon, authenticated;
