-- ─────────────────────────────────────────────────────────────────────────
-- VSDR import_runs table
-- Audit trail for /api/ingest-contacts (CSV / Manual / Bulk uploads).
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.import_runs (
  id                       uuid primary key default gen_random_uuid(),
  started_at               timestamptz not null default now(),
  finished_at              timestamptz,
  source                   text not null check (source in ('csv','manual','bulk')),
  triggered_by             text,                                   -- email of the user who clicked
  status                   text not null default 'running'
                             check (status in ('running','success','partial','error')),
  -- Counters
  rows_attempted           int not null default 0,                 -- raw input row count
  rows_inserted            int not null default 0,                 -- net-new contacts created in Supabase
  rows_skipped_duplicate   int not null default 0,                 -- matched an existing email/linkedin
  rows_skipped_invalid     int not null default 0,                 -- failed validation (no email, bad format, etc.)
  rows_failed              int not null default 0,                 -- write errored
  rows_pushed_to_airtable  int not null default 0,                 -- of the inserted, how many also got an airtable_id
  error_log                jsonb not null default '[]'::jsonb,     -- [{row_index, type, error, email?}, …]
  notes                    text                                     -- free-form summary
);

create index if not exists idx_import_runs_started_at_desc
  on public.import_runs (started_at desc);

-- ─── RLS ──────────────────────────────────────────────────────────────────
-- Public reads so ingestion.html can render the import history with the
-- publishable (anon) key. Writes happen server-side with the service-role
-- key, which bypasses RLS — no insert/update/delete policy needed.
alter table public.import_runs enable row level security;

drop policy if exists "import_runs read for everyone" on public.import_runs;
create policy "import_runs read for everyone"
  on public.import_runs
  for select
  using (true);
