-- ============================================================================
-- Seed dispatch schedule for week of 2026-05-11 (Mon) -> 2026-05-17 (Sun).
-- Source: dispatcher's spreadsheet pasted 2026-05-05.
--
-- Decisions baked in:
--   * Karl Hosnander gets irh_driver_number = '563' (was previously NULL).
--   * Nicole #586 is a new dispatcher — inserted with id=586. The user only
--     gave a first name; update her last name in Supabase Table Editor when
--     known.
--   * Amanda's Tuesday is stored as TWO shifts (12 PM-5 PM W + 5 PM-9 PM C),
--     enabled by migration 20260505000006 dropping the per-day UNIQUE.
--   * Stephanie's "4 PM - 12 AM" stored as 16:00 -> 00:00 (overnight ending
--     at midnight; the cell will render the +1d badge).
--   * OFF days kept as off_reason = 'unavailable'.
--   * Idempotent via delete-then-insert (replaces all dispatch-week entries
--     for the 14 listed drivers).
-- ============================================================================


-- 1. Assign Karl his IRH driver number.
UPDATE drivers
   SET irh_driver_number = '563'
 WHERE name = 'Karl Hosnander'
   AND (irh_driver_number IS NULL OR irh_driver_number = '');


-- 2. Insert Nicole as a new dispatcher (skip if id 586 already exists).
INSERT INTO drivers
  (id,  name,     "function",  yard,         "Company",    irh_driver_number, irh_yard_number, active)
VALUES
  (586, 'Nicole', 'Dispatch',  'Interstate', 'Interstate', '586',             'dispatch',      true)
ON CONFLICT (id) DO NOTHING;


-- 3. Idempotency: clear out this week's existing entries for these dispatchers
--    before re-inserting. Required because the per-day UNIQUE constraint was
--    dropped in migration 20260505000006, so ON CONFLICT (driver_id, schedule_date)
--    no longer works.
DELETE FROM scheduler_driver_schedule s
USING drivers d
WHERE s.driver_id = d.id
  AND d.irh_driver_number IN
       ('272','320','406','438','447','449','513','520','534','563','564','569','575','586')
  AND s.schedule_date BETWEEN '2026-05-11' AND '2026-05-17';


-- 4. Insert dispatch schedule rows.

INSERT INTO scheduler_driver_schedule
  (driver_id, schedule_date, entry_type, start_time, end_time, off_reason, notes)
SELECT d.id, ne.sd, ne.t, ne.st, ne.et, ne.reason, ne.notes
FROM (VALUES
  -- ---- 272 Daniel Mason — all OFF ----
  ('272', '2026-05-11'::date, 'off'::text, NULL::time, NULL::time, 'unavailable'::text, NULL::text),
  ('272', '2026-05-12', 'off', NULL, NULL, 'unavailable', NULL),
  ('272', '2026-05-13', 'off', NULL, NULL, 'unavailable', NULL),
  ('272', '2026-05-14', 'off', NULL, NULL, 'unavailable', NULL),
  ('272', '2026-05-15', 'off', NULL, NULL, 'unavailable', NULL),
  ('272', '2026-05-16', 'off', NULL, NULL, 'unavailable', NULL),
  ('272', '2026-05-17', 'off', NULL, NULL, 'unavailable', NULL),

  -- ---- 320 Keenan O'Reilly ----
  ('320', '2026-05-11', 'shift', '08:00', '17:00', NULL,          NULL),
  ('320', '2026-05-12', 'shift', '08:00', '17:00', NULL,          NULL),
  ('320', '2026-05-13', 'shift', '08:00', '17:00', NULL,          NULL),
  ('320', '2026-05-14', 'shift', '08:00', '13:00', NULL,          NULL),
  ('320', '2026-05-15', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('320', '2026-05-16', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('320', '2026-05-17', 'off',   NULL,    NULL,    'unavailable', NULL),

  -- ---- 406 Jessica Monett ----
  ('406', '2026-05-11', 'shift', '08:00', '17:00', NULL,          NULL),
  ('406', '2026-05-12', 'shift', '08:00', '15:30', NULL,          NULL),
  ('406', '2026-05-13', 'shift', '13:00', '17:00', NULL,          NULL),
  ('406', '2026-05-14', 'shift', '08:00', '17:00', NULL,          NULL),
  ('406', '2026-05-15', 'shift', '08:00', '15:30', NULL,          NULL),
  ('406', '2026-05-16', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('406', '2026-05-17', 'off',   NULL,    NULL,    'unavailable', NULL),

  -- ---- 438 Deanna Blair ----
  ('438', '2026-05-11', 'shift', '06:30', '14:30', NULL,          NULL),
  ('438', '2026-05-12', 'shift', '06:30', '14:30', NULL,          NULL),
  ('438', '2026-05-13', 'shift', '06:30', '14:30', NULL,          NULL),
  ('438', '2026-05-14', 'shift', '06:30', '14:30', NULL,          NULL),
  ('438', '2026-05-15', 'shift', '06:00', '13:00', NULL,          NULL),
  ('438', '2026-05-16', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('438', '2026-05-17', 'off',   NULL,    NULL,    'unavailable', NULL),

  -- ---- 447 Desiree Roda (overnights) ----
  ('447', '2026-05-11', 'shift', '22:30', '06:30', NULL,          'overnight'),
  ('447', '2026-05-12', 'shift', '22:30', '06:30', NULL,          'overnight'),
  ('447', '2026-05-13', 'shift', '21:00', '06:30', NULL,          'overnight'),
  ('447', '2026-05-14', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('447', '2026-05-15', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('447', '2026-05-16', 'shift', '23:00', '08:00', NULL,          'overnight'),
  ('447', '2026-05-17', 'shift', '20:00', '06:30', NULL,          'overnight'),

  -- ---- 449 Heidi Fiske ----
  ('449', '2026-05-11', 'shift', '09:00', '18:00', NULL,          NULL),
  ('449', '2026-05-12', 'shift', '09:00', '18:00', NULL,          NULL),
  ('449', '2026-05-13', 'shift', '09:00', '18:00', NULL,          NULL),
  ('449', '2026-05-14', 'shift', '09:00', '15:00', NULL,          NULL),
  ('449', '2026-05-15', 'shift', '09:00', '18:00', NULL,          NULL),
  ('449', '2026-05-16', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('449', '2026-05-17', 'off',   NULL,    NULL,    'unavailable', NULL),

  -- ---- 513 Courtney Philpott ----
  ('513', '2026-05-11', 'shift', '11:30', '19:00', NULL,          NULL),
  ('513', '2026-05-12', 'shift', '11:30', '19:00', NULL,          NULL),
  ('513', '2026-05-13', 'shift', '11:30', '19:00', NULL,          NULL),
  ('513', '2026-05-14', 'shift', '12:00', '20:00', NULL,          NULL),
  ('513', '2026-05-15', 'shift', '09:00', '17:00', NULL,          NULL),
  ('513', '2026-05-16', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('513', '2026-05-17', 'off',   NULL,    NULL,    'unavailable', NULL),

  -- ---- 520 Abigail "Abby" White ----
  ('520', '2026-05-11', 'shift', '14:30', '22:30', NULL,          NULL),
  ('520', '2026-05-12', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('520', '2026-05-13', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('520', '2026-05-14', 'shift', '13:00', '21:00', NULL,          NULL),
  ('520', '2026-05-15', 'shift', '13:00', '21:00', NULL,          NULL),
  ('520', '2026-05-16', 'shift', '08:00', '16:00', NULL,          NULL),
  ('520', '2026-05-17', 'shift', '08:00', '18:00', NULL,          NULL),

  -- ---- 534 Jillian Champagne — all OFF ----
  ('534', '2026-05-11', 'off', NULL, NULL, 'unavailable', NULL),
  ('534', '2026-05-12', 'off', NULL, NULL, 'unavailable', NULL),
  ('534', '2026-05-13', 'off', NULL, NULL, 'unavailable', NULL),
  ('534', '2026-05-14', 'off', NULL, NULL, 'unavailable', NULL),
  ('534', '2026-05-15', 'off', NULL, NULL, 'unavailable', NULL),
  ('534', '2026-05-16', 'off', NULL, NULL, 'unavailable', NULL),
  ('534', '2026-05-17', 'off', NULL, NULL, 'unavailable', NULL),

  -- ---- 563 Karl Hosnander ----
  ('563', '2026-05-11', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('563', '2026-05-12', 'shift', '15:00', '23:00', NULL,          NULL),
  ('563', '2026-05-13', 'shift', '15:00', '23:00', NULL,          NULL),
  ('563', '2026-05-14', 'shift', '15:00', '23:00', NULL,          NULL),
  ('563', '2026-05-15', 'shift', '08:00', '20:00', NULL,          NULL),
  ('563', '2026-05-16', 'shift', '09:00', '17:00', NULL,          NULL),
  ('563', '2026-05-17', 'off',   NULL,    NULL,    'unavailable', NULL),

  -- ---- 564 Amanda Martin (Tuesday is two shifts) ----
  ('564', '2026-05-11', 'shift', '13:00', '21:00', NULL,          NULL),
  ('564', '2026-05-12', 'shift', '12:00', '17:00', NULL,          'W'),
  ('564', '2026-05-12', 'shift', '17:00', '21:00', NULL,          'C'),
  ('564', '2026-05-13', 'shift', '09:00', '14:30', NULL,          'W'),
  ('564', '2026-05-14', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('564', '2026-05-15', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('564', '2026-05-16', 'shift', '08:00', '18:00', NULL,          NULL),
  ('564', '2026-05-17', 'shift', '09:00', '18:00', NULL,          NULL),

  -- ---- 569 Pierce Canty (overnights mid-week) ----
  ('569', '2026-05-11', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('569', '2026-05-12', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('569', '2026-05-13', 'shift', '14:30', '21:00', NULL,          NULL),
  ('569', '2026-05-14', 'shift', '21:00', '06:00', NULL,          'overnight'),
  ('569', '2026-05-15', 'shift', '21:00', '08:00', NULL,          'overnight'),
  ('569', '2026-05-16', 'shift', '17:00', '23:00', NULL,          NULL),
  ('569', '2026-05-17', 'shift', '12:00', '20:00', NULL,          NULL),

  -- ---- 575 Stephanie Pierce ----
  ('575', '2026-05-11', 'shift', '16:00', '00:00', NULL,          'ends at midnight'),
  ('575', '2026-05-12', 'shift', '16:00', '00:00', NULL,          'ends at midnight'),
  ('575', '2026-05-13', 'shift', '16:00', '00:00', NULL,          'ends at midnight'),
  ('575', '2026-05-14', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('575', '2026-05-15', 'shift', '16:00', '23:00', NULL,          NULL),
  ('575', '2026-05-16', 'shift', '15:00', '23:00', NULL,          NULL),
  ('575', '2026-05-17', 'shift', '15:00', '23:00', NULL,          NULL),

  -- ---- 586 Nicole (new) ----
  ('586', '2026-05-11', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('586', '2026-05-12', 'shift', '09:00', '17:00', NULL,          NULL),
  ('586', '2026-05-13', 'shift', '09:00', '17:00', NULL,          NULL),
  ('586', '2026-05-14', 'shift', '09:00', '17:00', NULL,          NULL),
  ('586', '2026-05-15', 'shift', '09:00', '17:00', NULL,          NULL),
  ('586', '2026-05-16', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('586', '2026-05-17', 'off',   NULL,    NULL,    'unavailable', NULL)
) AS ne(irh, sd, t, st, et, reason, notes)
JOIN drivers d ON d.irh_driver_number = ne.irh;


-- Sanity check — entries for the dispatch week.
SELECT
  COUNT(*) FILTER (WHERE entry_type = 'shift') AS shifts,
  COUNT(*) FILTER (WHERE entry_type = 'off')   AS offs,
  COUNT(*)                                     AS total
FROM scheduler_driver_schedule
WHERE schedule_date BETWEEN '2026-05-11' AND '2026-05-17';
