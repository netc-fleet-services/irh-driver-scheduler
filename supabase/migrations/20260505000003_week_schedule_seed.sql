-- ============================================================================
-- Seed week-of-2026-05-04 (Mon-Sun) schedule for Interstate drivers.
-- Source: dispatcher's spreadsheet (Excel screenshot).
--
-- Notes:
--   * Drivers matched by irh_driver_number; missing matches are silently skipped.
--   * Entries are upserted on (driver_id, schedule_date) — re-running this
--     overwrites any manual entries you made for this week.
--   * UFP-only entries (no times listed) default to 07:00-17:00 with notes 'UFP'.
--   * Truck numbers from the "TR" column are stored in `notes` as 'TR ####'.
--   * Special markers (W / C / SB) are kept in notes too.
--   * Crosses-midnight: end_time < start_time is supported (e.g. 22:00-07:00).
--   * Two ambiguous Peter Morales entries flagged in notes:
--       Sat "9 AM - 9 AM"  -> stored as 09:00-21:00 (9 AM-9 PM, assumed typo)
--       Sun "8 PM - 6 PM"  -> stored as 20:00-06:00 (overnight, assumed typo)
--   * Richard Bertrand (FMLA all week) skipped: he's marked inactive and has
--     no irh_driver_number, so the JOIN drops him.
-- ============================================================================

INSERT INTO scheduler_driver_schedule
  (driver_id, schedule_date, entry_type, start_time, end_time, off_reason, notes)
SELECT d.id, ne.sd, ne.t, ne.st, ne.et, ne.reason, ne.notes
FROM (VALUES
  -- ---- 34 Jeffrey Procon ----
  ('34', '2026-05-04'::date, 'shift'::text, '06:00'::time, '15:00'::time, NULL::text, 'TR 634'::text),
  ('34', '2026-05-05', 'shift', '06:00', '15:00', NULL,          'TR 634'),
  ('34', '2026-05-06', 'shift', '06:00', '15:00', NULL,          'TR 634'),
  ('34', '2026-05-07', 'shift', '06:00', '15:00', NULL,          'TR 634'),
  ('34', '2026-05-08', 'off',   NULL,    NULL,    'unavailable', 'TR 634'),
  ('34', '2026-05-09', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('34', '2026-05-10', 'off',   NULL,    NULL,    'unavailable', NULL),

  -- ---- 43 Raymond Rivet (UFP) ----
  ('43', '2026-05-04', 'shift', '07:00', '17:00', NULL,          'UFP - TR 850'),
  ('43', '2026-05-05', 'shift', '07:00', '17:00', NULL,          'UFP - TR 850'),
  ('43', '2026-05-06', 'shift', '07:00', '17:00', NULL,          'UFP - TR 850'),
  ('43', '2026-05-07', 'shift', '07:00', '17:00', NULL,          'UFP - TR 850'),
  ('43', '2026-05-08', 'shift', '07:00', '17:00', NULL,          'UFP - TR 850'),
  ('43', '2026-05-09', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('43', '2026-05-10', 'off',   NULL,    NULL,    'unavailable', NULL),

  -- ---- 53 James Dufresne ----
  ('53', '2026-05-04', 'shift', '10:00', '19:00', NULL,          'TR 636'),
  ('53', '2026-05-05', 'shift', '10:00', '19:00', NULL,          'TR 636'),
  ('53', '2026-05-06', 'shift', '09:00', '18:00', NULL,          'TR 636'),
  ('53', '2026-05-07', 'shift', '09:00', '18:00', NULL,          'TR 636'),
  ('53', '2026-05-08', 'shift', '08:00', '17:00', NULL,          'TR 636'),
  ('53', '2026-05-09', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('53', '2026-05-10', 'off',   NULL,    NULL,    'unavailable', NULL),

  -- ---- 95 Daniel Heroux (overnights) ----
  ('95', '2026-05-04', 'shift', '22:00', '06:00', NULL,          'TR 4416 (overnight)'),
  ('95', '2026-05-05', 'shift', '22:00', '06:00', NULL,          'TR 4416 (overnight)'),
  ('95', '2026-05-06', 'shift', '22:00', '06:00', NULL,          'TR 4416 (overnight)'),
  ('95', '2026-05-07', 'shift', '22:00', '06:00', NULL,          'TR 4416 (overnight)'),
  ('95', '2026-05-08', 'shift', '22:00', '08:00', NULL,          'overnight'),
  ('95', '2026-05-09', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('95', '2026-05-10', 'off',   NULL,    NULL,    'unavailable', NULL),

  -- ---- 112 Brian McNally (off all week) ----
  ('112', '2026-05-04', 'off', NULL, NULL, 'unavailable', NULL),
  ('112', '2026-05-05', 'off', NULL, NULL, 'unavailable', NULL),
  ('112', '2026-05-06', 'off', NULL, NULL, 'unavailable', NULL),
  ('112', '2026-05-07', 'off', NULL, NULL, 'unavailable', NULL),
  ('112', '2026-05-08', 'off', NULL, NULL, 'unavailable', NULL),
  ('112', '2026-05-09', 'off', NULL, NULL, 'unavailable', NULL),
  ('112', '2026-05-10', 'off', NULL, NULL, 'unavailable', NULL),

  -- ---- 114 Jeremy Proulx ----
  ('114', '2026-05-04', 'shift', '07:00', '16:00', NULL,          'TR 4414, W'),
  ('114', '2026-05-05', 'shift', '08:00', '16:00', NULL,          'TR 4414'),
  ('114', '2026-05-06', 'off',   NULL,    NULL,    'unavailable', 'TR 4414'),
  ('114', '2026-05-07', 'shift', '08:00', '16:00', NULL,          'TR 4418'),
  ('114', '2026-05-08', 'shift', '08:00', '16:00', NULL,          'TR 4418'),
  ('114', '2026-05-09', 'off',   NULL,    NULL,    'unavailable', 'TR 4418'),
  ('114', '2026-05-10', 'off',   NULL,    NULL,    'unavailable', NULL),

  -- ---- 203 Rhyan Huber ----
  ('203', '2026-05-04', 'shift', '07:00', '15:00', NULL,          NULL),
  ('203', '2026-05-05', 'shift', '07:00', '15:00', NULL,          NULL),
  ('203', '2026-05-06', 'shift', '07:00', '15:00', NULL,          NULL),
  ('203', '2026-05-07', 'shift', '07:00', '15:00', NULL,          NULL),
  ('203', '2026-05-08', 'shift', '06:00', '15:00', NULL,          NULL),
  ('203', '2026-05-09', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('203', '2026-05-10', 'off',   NULL,    NULL,    'unavailable', NULL),

  -- ---- 210 Ryan Allard ----
  ('210', '2026-05-04', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('210', '2026-05-05', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('210', '2026-05-06', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('210', '2026-05-07', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('210', '2026-05-08', 'shift', '07:00', '14:00', NULL,          NULL),
  ('210', '2026-05-09', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('210', '2026-05-10', 'off',   NULL,    NULL,    'unavailable', NULL),

  -- ---- 266 Randy Purinton ----
  ('266', '2026-05-04', 'shift', '12:00', '22:00', NULL,          'TR 646'),
  ('266', '2026-05-05', 'shift', '12:00', '22:00', NULL,          'TR 646'),
  ('266', '2026-05-06', 'shift', '12:00', '22:00', NULL,          'TR 646'),
  ('266', '2026-05-07', 'shift', '12:00', '22:00', NULL,          'TR 646'),
  ('266', '2026-05-08', 'shift', '12:00', '22:00', NULL,          'TR 646'),
  ('266', '2026-05-09', 'off',   NULL,    NULL,    'unavailable', 'TR 646'),
  ('266', '2026-05-10', 'off',   NULL,    NULL,    'unavailable', 'TR 646'),

  -- ---- 306 Chris Hernandez (UFP) ----
  ('306', '2026-05-04', 'shift', '07:00', '17:00', NULL,          'UFP - TR 848'),
  ('306', '2026-05-05', 'shift', '07:00', '17:00', NULL,          'UFP - TR 848'),
  ('306', '2026-05-06', 'shift', '07:00', '17:00', NULL,          'UFP - TR 848'),
  ('306', '2026-05-07', 'shift', '07:00', '17:00', NULL,          'UFP - TR 848'),
  ('306', '2026-05-08', 'shift', '07:00', '17:00', NULL,          'UFP - TR 848'),
  ('306', '2026-05-09', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('306', '2026-05-10', 'off',   NULL,    NULL,    'unavailable', NULL),

  -- ---- 307 Dakota Nadle (UFP) ----
  ('307', '2026-05-04', 'shift', '07:00', '17:00', NULL,          'UFP - TR 842'),
  ('307', '2026-05-05', 'shift', '07:00', '17:00', NULL,          'UFP - TR 842'),
  ('307', '2026-05-06', 'shift', '07:00', '17:00', NULL,          'UFP - TR 842'),
  ('307', '2026-05-07', 'shift', '07:00', '17:00', NULL,          'UFP - TR 842'),
  ('307', '2026-05-08', 'shift', '07:00', '17:00', NULL,          'UFP - TR 842'),
  ('307', '2026-05-09', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('307', '2026-05-10', 'off',   NULL,    NULL,    'unavailable', NULL),

  -- ---- 322 Harry Gilmartin ----
  ('322', '2026-05-04', 'shift', '08:00', '18:00', NULL,          NULL),
  ('322', '2026-05-05', 'shift', '08:00', '16:00', NULL,          NULL),
  ('322', '2026-05-06', 'shift', '08:00', '18:00', NULL,          NULL),
  ('322', '2026-05-07', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('322', '2026-05-08', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('322', '2026-05-09', 'shift', '08:00', '20:00', NULL,          'TR 4416'),
  ('322', '2026-05-10', 'shift', '08:00', '20:00', NULL,          'TR 4416'),

  -- ---- 328 Matthew West ----
  ('328', '2026-05-04', 'off',   NULL,    NULL,    'unavailable', 'TR 4414'),
  ('328', '2026-05-05', 'shift', '08:00', '17:00', NULL,          'TR 4414'),
  ('328', '2026-05-06', 'shift', '08:00', '17:00', NULL,          'TR 4414'),
  ('328', '2026-05-07', 'shift', '08:00', '17:00', NULL,          'TR 4414'),
  ('328', '2026-05-08', 'shift', '08:00', '16:00', NULL,          'TR 4414'),
  ('328', '2026-05-09', 'shift', '07:00', '16:00', NULL,          'TR 4414'),
  ('328', '2026-05-10', 'off',   NULL,    NULL,    'unavailable', 'TR 4406'),

  -- ---- 351 Mark Cummings ----
  ('351', '2026-05-04', 'shift', '08:30', '17:00', NULL,          'TR 4426'),
  ('351', '2026-05-05', 'shift', '08:30', '17:00', NULL,          'TR 4426'),
  ('351', '2026-05-06', 'shift', '08:30', '17:00', NULL,          'TR 4426'),
  ('351', '2026-05-07', 'shift', '08:30', '17:00', NULL,          'TR 4426'),
  ('351', '2026-05-08', 'shift', '08:30', '17:00', NULL,          'TR 4426'),
  ('351', '2026-05-09', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('351', '2026-05-10', 'off',   NULL,    NULL,    'unavailable', NULL),

  -- ---- 395 Louis Loya ----
  ('395', '2026-05-04', 'shift', '12:00', '21:00', NULL,          'TR 644, W'),
  ('395', '2026-05-05', 'shift', '12:00', '21:00', NULL,          'TR 644'),
  ('395', '2026-05-06', 'shift', '10:00', '19:00', NULL,          'TR 644'),
  ('395', '2026-05-07', 'shift', '10:00', '19:00', NULL,          'TR 644'),
  ('395', '2026-05-08', 'shift', '10:00', '19:00', NULL,          'TR 644'),
  ('395', '2026-05-09', 'off',   NULL,    NULL,    'unavailable', 'TR 644'),
  ('395', '2026-05-10', 'off',   NULL,    NULL,    'unavailable', NULL),

  -- ---- 400 Timothy Misischia ----
  ('400', '2026-05-04', 'shift', '12:00', '22:00', NULL,          'TR 4442'),
  ('400', '2026-05-05', 'shift', '12:00', '22:00', NULL,          'TR 4442'),
  ('400', '2026-05-06', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('400', '2026-05-07', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('400', '2026-05-08', 'shift', '08:00', '16:00', NULL,          'TR 4442'),
  ('400', '2026-05-09', 'shift', '08:00', '20:00', NULL,          'TR 4442'),
  ('400', '2026-05-10', 'shift', '08:00', '20:00', NULL,          'TR 4442'),

  -- ---- 410 Peter Morales (overnights + 2 ambiguous) ----
  ('410', '2026-05-04', 'shift', '22:00', '08:00', NULL,          'overnight'),
  ('410', '2026-05-05', 'shift', '22:00', '08:00', NULL,          'overnight'),
  ('410', '2026-05-06', 'shift', '22:00', '08:00', NULL,          'overnight, SB'),
  ('410', '2026-05-07', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('410', '2026-05-08', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('410', '2026-05-09', 'shift', '09:00', '21:00', NULL,          'sheet says "9 AM - 9 AM" — assumed 9 PM'),
  ('410', '2026-05-10', 'shift', '20:00', '06:00', NULL,          'sheet says "8 PM - 6 PM" — assumed 6 AM (overnight)'),

  -- ---- 501 James Smith ----
  ('501', '2026-05-04', 'shift', '13:00', '22:00', NULL,          'TR 638, C'),
  ('501', '2026-05-05', 'shift', '13:00', '22:00', NULL,          'TR 638'),
  ('501', '2026-05-06', 'shift', '13:00', '22:00', NULL,          'TR 638'),
  ('501', '2026-05-07', 'shift', '13:00', '22:00', NULL,          'TR 638'),
  ('501', '2026-05-08', 'shift', '13:00', '22:00', NULL,          'TR 638'),
  ('501', '2026-05-09', 'off',   NULL,    NULL,    'unavailable', 'TR 638'),
  ('501', '2026-05-10', 'off',   NULL,    NULL,    'unavailable', 'TR 638'),

  -- ---- 511 Eli Tomlinson ----
  ('511', '2026-05-04', 'shift', '15:00', '23:00', NULL,          'TR 4428'),
  ('511', '2026-05-05', 'off',   NULL,    NULL,    'unavailable', 'TR 4428'),
  ('511', '2026-05-06', 'shift', '10:00', '20:00', NULL,          'TR 4428'),
  ('511', '2026-05-07', 'shift', '10:00', '20:00', NULL,          'TR 630'),
  ('511', '2026-05-08', 'shift', '11:00', '21:00', NULL,          'TR 630'),
  ('511', '2026-05-09', 'shift', '10:00', '21:00', NULL,          'TR 630'),
  ('511', '2026-05-10', 'off',   NULL,    NULL,    'unavailable', 'TR 630'),

  -- ---- 549 Braeden Houle (overnights) ----
  ('549', '2026-05-04', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('549', '2026-05-05', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('549', '2026-05-06', 'shift', '22:00', '07:00', NULL,          'overnight'),
  ('549', '2026-05-07', 'shift', '22:00', '08:00', NULL,          'overnight, SB'),
  ('549', '2026-05-08', 'shift', '21:00', '08:00', NULL,          'overnight'),
  ('549', '2026-05-09', 'shift', '20:00', '08:00', NULL,          'overnight'),
  ('549', '2026-05-10', 'shift', '20:00', '07:00', NULL,          'sheet says "8 PM - 7 PM" — assumed 7 AM (overnight)'),

  -- ---- 562 Jaishawn Sullivan ----
  ('562', '2026-05-04', 'shift', '08:00', '17:00', NULL,          'United Rentals (no time on sheet)'),
  ('562', '2026-05-05', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('562', '2026-05-06', 'shift', '16:00', '23:00', NULL,          'TR 4422'),
  ('562', '2026-05-07', 'shift', '16:00', '23:00', NULL,          'TR 4422'),
  ('562', '2026-05-08', 'shift', '16:00', '23:00', NULL,          'TR 4422'),
  ('562', '2026-05-09', 'shift', '14:00', '23:00', NULL,          'TR 4422'),
  ('562', '2026-05-10', 'shift', '12:00', '20:00', NULL,          'TR 4422'),

  -- ---- 566 Miguel Santana (UFP) ----
  ('566', '2026-05-04', 'shift', '07:00', '17:00', NULL,          'UFP - TR 4408'),
  ('566', '2026-05-05', 'shift', '07:00', '17:00', NULL,          'UFP - TR 4408'),
  ('566', '2026-05-06', 'shift', '07:00', '17:00', NULL,          'UFP - TR 4408'),
  ('566', '2026-05-07', 'shift', '07:00', '17:00', NULL,          'UFP - TR 4408'),
  ('566', '2026-05-08', 'shift', '07:00', '17:00', NULL,          'UFP - TR 4408'),
  ('566', '2026-05-09', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('566', '2026-05-10', 'off',   NULL,    NULL,    'unavailable', NULL),

  -- ---- 568 Michael Gables II (overnights) ----
  ('568', '2026-05-04', 'shift', '21:00', '07:00', NULL,          'overnight, SB'),
  ('568', '2026-05-05', 'shift', '21:00', '07:00', NULL,          'overnight, SB'),
  ('568', '2026-05-06', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('568', '2026-05-07', 'shift', '22:00', '07:00', NULL,          'overnight, C'),
  ('568', '2026-05-08', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('568', '2026-05-09', 'shift', '20:00', '08:00', NULL,          'overnight'),
  ('568', '2026-05-10', 'shift', '20:00', '06:00', NULL,          'overnight'),

  -- ---- 573 Joseph Demasi ----
  ('573', '2026-05-04', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('573', '2026-05-05', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('573', '2026-05-06', 'shift', '14:00', '23:00', NULL,          NULL),
  ('573', '2026-05-07', 'shift', '14:00', '23:00', NULL,          NULL),
  ('573', '2026-05-08', 'shift', '12:00', '21:00', NULL,          NULL),
  ('573', '2026-05-09', 'shift', '09:00', '21:00', NULL,          NULL),
  ('573', '2026-05-10', 'off',   NULL,    NULL,    'unavailable', NULL),

  -- ---- 576 Chase Daunais (mechanic — function=Dispatch in DB, won't render in scheduler view) ----
  ('576', '2026-05-04', 'shift', '08:00', '17:00', NULL,          'mechanic'),
  ('576', '2026-05-05', 'shift', '08:00', '17:00', NULL,          'mechanic'),
  ('576', '2026-05-06', 'shift', '08:00', '17:00', NULL,          'mechanic'),
  ('576', '2026-05-07', 'shift', '08:00', '17:00', NULL,          'mechanic'),
  ('576', '2026-05-08', 'shift', '08:00', '17:00', NULL,          'mechanic'),
  ('576', '2026-05-09', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('576', '2026-05-10', 'off',   NULL,    NULL,    'unavailable', NULL),

  -- ---- 579 Chase Lanoue ----
  ('579', '2026-05-04', 'shift', '09:00', '17:00', NULL,          NULL),
  ('579', '2026-05-05', 'shift', '09:00', '17:00', NULL,          NULL),
  ('579', '2026-05-06', 'shift', '09:00', '17:00', NULL,          NULL),
  ('579', '2026-05-07', 'shift', '09:00', '17:00', NULL,          NULL),
  ('579', '2026-05-08', 'shift', '09:00', '17:00', NULL,          NULL),
  ('579', '2026-05-09', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('579', '2026-05-10', 'off',   NULL,    NULL,    'unavailable', NULL),

  -- ---- 585 Joseph Berardi ----
  ('585', '2026-05-04', 'shift', '12:00', '22:00', NULL,          'T400'),
  ('585', '2026-05-05', 'shift', '12:00', '22:00', NULL,          'T400'),
  ('585', '2026-05-06', 'shift', '09:00', '17:00', NULL,          'T328'),
  ('585', '2026-05-07', 'shift', '09:00', '17:00', NULL,          'T328'),
  ('585', '2026-05-08', 'shift', '08:00', '16:00', NULL,          'T400'),
  ('585', '2026-05-09', 'off',   NULL,    NULL,    'unavailable', NULL),
  ('585', '2026-05-10', 'off',   NULL,    NULL,    'unavailable', NULL)
) AS ne(irh, sd, t, st, et, reason, notes)
JOIN drivers d ON d.irh_driver_number = ne.irh
ON CONFLICT (driver_id, schedule_date) DO UPDATE SET
  entry_type = EXCLUDED.entry_type,
  start_time = EXCLUDED.start_time,
  end_time   = EXCLUDED.end_time,
  off_reason = EXCLUDED.off_reason,
  notes      = EXCLUDED.notes,
  updated_at = now();


-- Sanity check — count entries seeded for the week.
SELECT
  COUNT(*) FILTER (WHERE entry_type = 'shift') AS shifts,
  COUNT(*) FILTER (WHERE entry_type = 'off')   AS offs,
  COUNT(*)                                     AS total
FROM scheduler_driver_schedule
WHERE schedule_date BETWEEN '2026-05-04' AND '2026-05-10';
