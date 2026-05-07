-- ─────────────────────────────────────────────────────────────────────────
-- VSDR sync_runs — chunked-execution columns (additive migration)
-- Run AFTER migration-sync-runs.sql. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────

-- Resumable state. The engine processes one chunk per HTTP call and saves
-- progress here so the next call can continue from where the last one stopped.

alter table public.sync_runs
  add column if not exists phase text not null default 'pulling'
    check (phase in ('pulling','archiving','pushing','done'));

-- Airtable's opaque pagination cursor. NULL means "start from the beginning";
-- 'DONE' is the sentinel we set when Airtable has no more pages.
alter table public.sync_runs
  add column if not exists airtable_offset text;

-- Every Airtable record id we have processed in this run. Used to compute
-- which Supabase rows to soft-archive once the pull phase completes.
alter table public.sync_runs
  add column if not exists airtable_seen_ids jsonb not null default '[]'::jsonb;

-- Cursors for the archiving and pushing phases (Supabase pagination).
alter table public.sync_runs
  add column if not exists archive_offset int not null default 0;
alter table public.sync_runs
  add column if not exists push_offset int not null default 0;

-- A coarse total used for progress UI; written once Airtable's first page
-- response includes a hint or computed at the end of the pulling phase.
alter table public.sync_runs
  add column if not exists progress_hint int;

-- Clear any stuck row from the previous monolithic run (one-shot housekeeping).
update public.sync_runs
  set status = 'error',
      finished_at = coalesce(finished_at, now()),
      notes = coalesce(notes, '') || ' [auto-cleared by chunked migration]'
  where status = 'running';
