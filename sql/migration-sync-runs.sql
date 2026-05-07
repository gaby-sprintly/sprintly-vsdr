-- ─────────────────────────────────────────────────────────────────────────
-- VSDR sync_runs table
-- Audit trail + lock for the full Airtable ↔ Supabase contact sync.
-- Safe to re-run: every statement is IF NOT EXISTS / OR REPLACE.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.sync_runs (
  id              uuid primary key default gen_random_uuid(),
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  trigger         text not null check (trigger in ('manual','scheduled','api')),
  triggered_by    text,                                        -- email or 'cron'
  status          text not null default 'running'
                    check (status in ('running','success','partial','error')),
  -- counters (running totals, updated as the engine progresses)
  airtable_total  int not null default 0,
  supabase_total  int not null default 0,
  inserted        int not null default 0,                      -- new Supabase rows from Airtable
  updated         int not null default 0,                      -- existing Supabase rows patched
  archived        int not null default 0,                      -- Supabase rows soft-archived
  pushed          int not null default 0,                      -- new Airtable rows from Supabase
  failed          int not null default 0,                      -- per-record write failures
  error_log       jsonb not null default '[]'::jsonb,          -- [{requestId, type, recordId, error}, …]
  notes           text                                          -- free-form summary written at end
);

-- Lookup the latest run quickly (for the settings page table).
create index if not exists idx_sync_runs_started_at_desc
  on public.sync_runs (started_at desc);

-- Lock semantics: only ONE run with status='running' at a time.
-- Engine attempts INSERT and falls back to "already running" if this throws unique violation.
create unique index if not exists idx_sync_runs_one_running
  on public.sync_runs (status)
  where status = 'running';

-- Helper: how old is the current running lock? (used to break stale locks > N min)
create or replace function public.sync_run_lock_age_seconds()
  returns int
  language sql
  stable
as $$
  select coalesce(extract(epoch from (now() - started_at))::int, 0)
  from public.sync_runs
  where status = 'running'
  order by started_at desc
  limit 1;
$$;

-- ─── RLS ──────────────────────────────────────────────────────────────────
-- Public reads (so settings.html can render the log with the publishable key).
-- Writes are server-side only (Vercel function uses service-role key).
alter table public.sync_runs enable row level security;

drop policy if exists "sync_runs read for everyone" on public.sync_runs;
create policy "sync_runs read for everyone"
  on public.sync_runs
  for select
  using (true);

-- No insert/update/delete policies — service role bypasses RLS, so the
-- absence of a policy is exactly what we want for write protection.

-- ─── Sanity seed (only if empty) ─────────────────────────────────────────
-- Drop the localStorage-seeded sample rows by leaving the table empty;
-- the first real run will populate it.
