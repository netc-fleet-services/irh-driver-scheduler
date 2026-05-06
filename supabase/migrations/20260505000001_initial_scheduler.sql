-- ============================================================================
-- Interstate Driver Scheduler — initial schema migration
-- Date: 2026-05-05
--
-- This migration:
--   1. Adds three new columns to the existing `drivers` table (additive only).
--   2. Creates one new table owned by this project: `scheduler_driver_schedule`.
--   3. Sets up indexes, an updated_at trigger, RLS policies, and Realtime.
--
-- It does NOT modify, update, or delete any existing data, and does NOT touch
-- any other existing tables (jobs, compliance_events, dvir_logs, etc.).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Additive changes to existing `drivers` table
-- ----------------------------------------------------------------------------
-- All existing rows get active = true automatically via the DEFAULT.
-- Other apps reading/writing this table are unaffected: SELECT * still works,
-- and INSERTs that omit these columns still work because of the defaults.

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS active           boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS inactive_reason  text,
  ADD COLUMN IF NOT EXISTS inactive_since   date;

COMMENT ON COLUMN public.drivers.active IS
  'Active in the scheduler. Defaults true; flip to false when a driver leaves. History is preserved in scheduler_driver_schedule.';
COMMENT ON COLUMN public.drivers.inactive_reason IS
  'Optional: terminated / quit / transferred / other.';
COMMENT ON COLUMN public.drivers.inactive_since IS
  'Optional: date the driver became inactive.';


-- ----------------------------------------------------------------------------
-- 2. New table: scheduler_driver_schedule
--    One row = one driver's entry for one date (either a shift OR an off-day).
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.scheduler_driver_schedule (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id       integer     NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  schedule_date   date        NOT NULL,
  entry_type      text        NOT NULL,
  start_time      time,
  end_time        time,
  off_reason      text,
  notes           text,
  created_by      uuid        REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  -- One entry per driver per day (prevents shift + off-day collisions automatically)
  CONSTRAINT one_entry_per_driver_per_day UNIQUE (driver_id, schedule_date),

  -- entry_type must be one of two values
  CONSTRAINT entry_type_valid CHECK (entry_type IN ('shift', 'off')),

  -- off_reason only valid for off-days, and must be one of the allowed values
  CONSTRAINT off_reason_valid CHECK (
    off_reason IS NULL
    OR off_reason IN ('PTO', 'sick', 'unavailable', 'other')
  ),

  -- Field combinations must match entry_type:
  --   shift  → start_time + end_time required, off_reason must be null
  --   off    → start_time + end_time must be null
  CONSTRAINT entry_fields_match_type CHECK (
    (entry_type = 'shift'
       AND start_time IS NOT NULL
       AND end_time   IS NOT NULL
       AND off_reason IS NULL)
    OR
    (entry_type = 'off'
       AND start_time IS NULL
       AND end_time   IS NULL)
  )
);

COMMENT ON TABLE public.scheduler_driver_schedule IS
  'Driver schedule entries. One row per driver per date. entry_type=shift uses start_time/end_time (end_time<start_time means rolls into next day). entry_type=off uses off_reason.';

-- Indexes for the common queries (week view = filter by date range)
CREATE INDEX IF NOT EXISTS idx_sched_schedule_date
  ON public.scheduler_driver_schedule (schedule_date);
CREATE INDEX IF NOT EXISTS idx_sched_driver_id
  ON public.scheduler_driver_schedule (driver_id);


-- ----------------------------------------------------------------------------
-- 3. Auto-update `updated_at` on every row change
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.scheduler_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sched_updated_at ON public.scheduler_driver_schedule;
CREATE TRIGGER trg_sched_updated_at
  BEFORE UPDATE ON public.scheduler_driver_schedule
  FOR EACH ROW
  EXECUTE FUNCTION public.scheduler_set_updated_at();


-- ----------------------------------------------------------------------------
-- 4. Row-Level Security
--    Internal tool, 3-5 dispatchers. Any logged-in user can read & write.
--    The publishable/anon key alone (no login) gets nothing.
-- ----------------------------------------------------------------------------

ALTER TABLE public.scheduler_driver_schedule ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authed read"   ON public.scheduler_driver_schedule;
DROP POLICY IF EXISTS "authed insert" ON public.scheduler_driver_schedule;
DROP POLICY IF EXISTS "authed update" ON public.scheduler_driver_schedule;
DROP POLICY IF EXISTS "authed delete" ON public.scheduler_driver_schedule;

CREATE POLICY "authed read"
  ON public.scheduler_driver_schedule
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "authed insert"
  ON public.scheduler_driver_schedule
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "authed update"
  ON public.scheduler_driver_schedule
  FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "authed delete"
  ON public.scheduler_driver_schedule
  FOR DELETE TO authenticated
  USING (true);


-- ----------------------------------------------------------------------------
-- 5. Realtime: broadcast changes so all logged-in dispatchers see live updates
-- ----------------------------------------------------------------------------

-- Add to the default Supabase realtime publication. Wrapped in a DO block so
-- re-running the migration is idempotent (publication-add errors otherwise).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'scheduler_driver_schedule'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.scheduler_driver_schedule';
  END IF;
END
$$;
