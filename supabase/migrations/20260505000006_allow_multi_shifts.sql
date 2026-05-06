-- ============================================================================
-- Allow multiple shifts per driver per day.
--
-- Drops the UNIQUE(driver_id, schedule_date) constraint that previously
-- enforced one entry per day. After this:
--   * Drivers can have any number of shifts on the same date.
--   * Off-day exclusivity is enforced in the app, not the DB.
--   * Older seed migrations that used `ON CONFLICT (driver_id, schedule_date)`
--     are no longer re-runnable as-is. New migrations use delete-then-insert.
--
-- Also: replace Amanda Martin's Tuesday combined 12 PM-9 PM shift with the
-- actual two-shift split that was bunched together when the schema only
-- allowed one entry per day:
--    12 PM - 5 PM (W)
--    5 PM  - 9 PM (C)
-- ============================================================================


-- 1. Drop the constraint
ALTER TABLE scheduler_driver_schedule
  DROP CONSTRAINT IF EXISTS one_entry_per_driver_per_day;


-- 2. Fix Amanda Martin's Tuesday entry — split into the two real shifts
DELETE FROM scheduler_driver_schedule
 WHERE driver_id = (SELECT id FROM drivers WHERE name = 'Amanda Martin')
   AND schedule_date = '2026-05-12';

INSERT INTO scheduler_driver_schedule
  (driver_id, schedule_date, entry_type, start_time, end_time, off_reason, notes)
SELECT id, '2026-05-12'::date, 'shift', '12:00'::time, '17:00'::time, NULL, 'W'
  FROM drivers WHERE name = 'Amanda Martin'
UNION ALL
SELECT id, '2026-05-12'::date, 'shift', '17:00'::time, '21:00'::time, NULL, 'C'
  FROM drivers WHERE name = 'Amanda Martin';
