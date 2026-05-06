-- ============================================================================
-- Seed week-of-2026-05-04 (Mon-Sun) schedule — additional 10 Interstate
-- drivers (sheet pasted 2026-05-05).
--
-- Decisions baked in:
--   * "CISCO" #505 is assumed to be Francisco Vazquez (Cisco = Francisco).
--     This migration updates Francisco's irh_driver_number from '500' to '505',
--     which also resolves the prior duplicate-#500 conflict with James Mayo.
--     If Cisco is actually a different person, this update needs to be reverted
--     and a new driver row created instead.
--   * Truck numbers stored in `notes` ("TR 632", "T410", etc.).
--   * "4 PM - 12 AM" stored as 16:00 -> 00:00 (treated as overnight ending at
--     the next day's start; the cell will render the +1d badge).
--   * OFF days kept as off_reason = 'unavailable'.
--   * Idempotent: re-running upserts the same rows.
-- ============================================================================


-- 1. Reassign Francisco Vazquez (Cisco) from #500 to #505 to resolve the
--    duplicate IRH#. James Mayo keeps his #500.
UPDATE drivers
   SET irh_driver_number = '505'
 WHERE name = 'Francisco Vazquez'
   AND irh_driver_number = '500';


-- 2. Schedule entries for the 10 drivers across Mon 5/4 -> Sun 5/10.

INSERT INTO scheduler_driver_schedule
  (driver_id, schedule_date, entry_type, start_time, end_time, off_reason, notes)
SELECT d.id, ne.sd, ne.t, ne.st, ne.et, ne.reason, ne.notes
FROM (VALUES
  -- ---- 153 Daniel Potter ----
  ('153', '2026-05-04'::date, 'shift'::text, '06:00'::time, '17:00'::time, NULL::text, 'TR 632'::text),
  ('153', '2026-05-05', 'shift', '06:00', '17:00', NULL,          'TR 632'),
  ('153', '2026-05-06', 'shift', '06:00', '17:00', NULL,          'TR 632'),
  ('153', '2026-05-07', 'shift', '06:00', '17:00', NULL,          'TR 632'),
  ('153', '2026-05-08', 'shift', '06:00', '17:00', NULL,          'TR 632'),
  ('153', '2026-05-09', 'off',   NULL,    NULL,    'unavailable', 'TR 632'),
  ('153', '2026-05-10', 'off',   NULL,    NULL,    'unavailable', 'TR 632'),

  -- ---- 397 Aj Misischia Jr ----
  ('397', '2026-05-04', 'shift', '15:00', '23:00', NULL,          'TR 4440'),
  ('397', '2026-05-05', 'shift', '15:00', '23:00', NULL,          'TR 4440'),
  ('397', '2026-05-06', 'shift', '15:00', '23:00', NULL,          'TR 4440'),
  ('397', '2026-05-07', 'shift', '15:00', '23:00', NULL,          'TR 4440'),
  ('397', '2026-05-08', 'shift', '15:00', '23:00', NULL,          'TR 4440'),
  ('397', '2026-05-09', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('397', '2026-05-10', 'off',   NULL,    NULL,    'unavailable', NULL),

  -- ---- 398 Kyle Procon ----
  ('398', '2026-05-04', 'shift', '09:00', '19:00', NULL,          'TR 648'),
  ('398', '2026-05-05', 'shift', '09:00', '19:00', NULL,          'TR 648'),
  ('398', '2026-05-06', 'shift', '09:00', '19:00', NULL,          'TR 648'),
  ('398', '2026-05-07', 'shift', '12:00', '20:00', NULL,          'TR 648'),
  ('398', '2026-05-08', 'shift', '12:00', '20:00', NULL,          'TR 648'),
  ('398', '2026-05-09', 'off',   NULL,    NULL,    'unavailable', 'TR 642'),
  ('398', '2026-05-10', 'off',   NULL,    NULL,    'unavailable', 'TR 642'),

  -- ---- 448 Tyler Posusky (mostly overnights) ----
  ('448', '2026-05-04', 'shift', '23:00', '07:00', NULL,          'TR 4438 (overnight)'),
  ('448', '2026-05-05', 'shift', '22:00', '07:00', NULL,          'TR 4438 (overnight)'),
  ('448', '2026-05-06', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('448', '2026-05-07', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('448', '2026-05-08', 'shift', '21:00', '08:00', NULL,          'TR 4438 (overnight)'),
  ('448', '2026-05-09', 'shift', '20:00', '08:00', NULL,          'overnight'),
  ('448', '2026-05-10', 'shift', '20:00', '07:00', NULL,          'overnight'),

  -- ---- 500 James Mayo ----
  ('500', '2026-05-04', 'shift', '09:00', '19:00', NULL,          'TR 4436'),
  ('500', '2026-05-05', 'shift', '09:00', '19:00', NULL,          'TR 4436'),
  ('500', '2026-05-06', 'shift', '07:00', '15:00', NULL,          'TR 4436'),
  ('500', '2026-05-07', 'off',   NULL,    NULL,    'unavailable', 'TR 4436'),
  ('500', '2026-05-08', 'shift', '07:00', '17:00', NULL,          'TR 4436'),
  ('500', '2026-05-09', 'off',   NULL,    NULL,    'unavailable', 'TR 4436'),
  ('500', '2026-05-10', 'off',   NULL,    NULL,    'unavailable', 'TR 4436'),

  -- ---- 505 Francisco "Cisco" Vazquez (renumbered from #500 above) ----
  ('505', '2026-05-04', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('505', '2026-05-05', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('505', '2026-05-06', 'shift', '09:00', '19:00', NULL,          'TR 4432'),
  ('505', '2026-05-07', 'shift', '09:00', '19:00', NULL,          'TR 4432'),
  ('505', '2026-05-08', 'shift', '10:00', '21:00', NULL,          'TR 4432'),
  ('505', '2026-05-09', 'shift', '09:00', '21:00', NULL,          'TR 4432'),
  ('505', '2026-05-10', 'shift', '09:00', '21:00', NULL,          'TR 4432'),

  -- ---- 542 Tristan Wilhelm ----
  ('542', '2026-05-04', 'shift', '07:00', '17:00', NULL,          'TR 4438'),
  ('542', '2026-05-05', 'shift', '07:00', '17:00', NULL,          'TR 4438'),
  ('542', '2026-05-06', 'off',   NULL,    NULL,    'unavailable', 'TR 4438'),
  ('542', '2026-05-07', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('542', '2026-05-08', 'shift', '07:00', '17:00', NULL,          'TR 4438'),
  ('542', '2026-05-09', 'shift', '07:00', '19:00', NULL,          'TR 4438'),
  ('542', '2026-05-10', 'shift', '07:00', '19:00', NULL,          'TR 4438'),

  -- ---- 554 Zachary Dill (all overnights) ----
  ('554', '2026-05-04', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('554', '2026-05-05', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('554', '2026-05-06', 'shift', '20:00', '06:00', NULL,          'overnight'),
  ('554', '2026-05-07', 'shift', '20:00', '06:00', NULL,          'overnight'),
  ('554', '2026-05-08', 'shift', '20:00', '08:00', NULL,          'overnight'),
  ('554', '2026-05-09', 'shift', '20:00', '08:00', NULL,          'overnight'),
  ('554', '2026-05-10', 'shift', '20:00', '06:00', NULL,          'overnight'),

  -- ---- 582 Blake Green ----
  ('582', '2026-05-04', 'shift', '16:00', '00:00', NULL,          'ends at midnight'),
  ('582', '2026-05-05', 'shift', '16:00', '00:00', NULL,          'ends at midnight'),
  ('582', '2026-05-06', 'shift', '16:00', '00:00', NULL,          'ends at midnight'),
  ('582', '2026-05-07', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('582', '2026-05-08', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('582', '2026-05-09', 'shift', '06:00', '15:00', NULL,          NULL),
  ('582', '2026-05-10', 'shift', '06:00', '15:00', NULL,          NULL),

  -- ---- 584 Joseph Caputo ----
  ('584', '2026-05-04', 'shift', '15:00', '23:00', NULL,          'T397'),
  ('584', '2026-05-05', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('584', '2026-05-06', 'shift', '22:00', '07:00', NULL,          'T410 (overnight)'),
  ('584', '2026-05-07', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('584', '2026-05-08', 'shift', '21:00', '08:00', NULL,          'overnight'),
  ('584', '2026-05-09', 'shift', '20:00', '07:00', NULL,          'overnight'),
  ('584', '2026-05-10', 'shift', '20:00', '07:00', NULL,          'overnight')
) AS ne(irh, sd, t, st, et, reason, notes)
JOIN drivers d ON d.irh_driver_number = ne.irh
ON CONFLICT (driver_id, schedule_date) DO UPDATE SET
  entry_type = EXCLUDED.entry_type,
  start_time = EXCLUDED.start_time,
  end_time   = EXCLUDED.end_time,
  off_reason = EXCLUDED.off_reason,
  notes      = EXCLUDED.notes,
  updated_at = now();


-- Sanity check — total entries for the week (this seed + part 1).
SELECT
  COUNT(*) FILTER (WHERE entry_type = 'shift') AS shifts,
  COUNT(*) FILTER (WHERE entry_type = 'off')   AS offs,
  COUNT(*)                                     AS total
FROM scheduler_driver_schedule
WHERE schedule_date BETWEEN '2026-05-04' AND '2026-05-10';
