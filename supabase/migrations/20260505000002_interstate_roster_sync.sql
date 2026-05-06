-- ============================================================================
-- Interstate roster sync — 2026-05-05
--
-- 1. Adds two new columns to drivers (additive, additive, no breaking change):
--      irh_driver_number  text
--      irh_yard_number    text
-- 2. Updates existing Interstate drivers with their IRH driver number,
--    function, and IRH yard number (from the source spreadsheet "Location").
-- 3. Inserts 11 new drivers from the incoming roster, using IRH# as the row id.
-- 4. Marks 3 DB-only drivers inactive (Jeremy Procon, Lewis Loya Jr,
--    Richard Bertrand) — not on the current roster.
--
-- Function priority (UFP wins over license):
--   1. Location contains "UFP"  -> Transport
--   2. License = 'A'             -> HDT
--   3. License = 'D'             -> LDT
--   4. Otherwise                 -> Dispatch
--
-- The shared `drivers.yard` column is NOT modified by this migration — only
-- the new `irh_yard_number` column. New INSERTs set yard = 'Interstate' to
-- match the existing convention for Interstate drivers in the shared table.
--
-- Idempotent: safe to re-run.
-- ============================================================================


-- 1. Add the two new columns (additive — no impact on other apps)
ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS irh_driver_number text,
  ADD COLUMN IF NOT EXISTS irh_yard_number   text;

COMMENT ON COLUMN drivers.irh_driver_number IS
  'Interstate Recovery & Hauling driver number from the Interstate roster.';
COMMENT ON COLUMN drivers.irh_yard_number IS
  'Interstate yard / location code from the Interstate roster (1, 5, 6, UFP, Dispatch, office, mechanic, etc.).';


-- 2. Update existing matches.

-- ---- Class A -> HDT ----
UPDATE drivers SET irh_driver_number = '210', "function" = 'HDT', irh_yard_number = '1'           WHERE name = 'Ryan Allard';
UPDATE drivers SET irh_driver_number = '554', "function" = 'HDT', irh_yard_number = '6'           WHERE name = 'Zachary Dill';
UPDATE drivers SET irh_driver_number = '53',  "function" = 'HDT', irh_yard_number = '1'           WHERE name = 'James Dufresne';
-- Gables splits between yards 1 and 6: comma-separated so the yard filter matches BOTH.
UPDATE drivers SET irh_driver_number = '568', "function" = 'HDT', irh_yard_number = '1,6'         WHERE name = 'Michael Gables Ii';
UPDATE drivers SET irh_driver_number = '322', "function" = 'HDT', irh_yard_number = '1'           WHERE name = 'Harry Gilmartin';
UPDATE drivers SET irh_driver_number = '203', "function" = 'HDT', irh_yard_number = '1'           WHERE name = 'Rhyan Huber';
UPDATE drivers SET irh_driver_number = '112', "function" = 'HDT', irh_yard_number = '1'           WHERE name = 'Brian Mcnally';
UPDATE drivers SET irh_driver_number = '153', "function" = 'HDT', irh_yard_number = '6'           WHERE name = 'Daniel Potter';
UPDATE drivers SET irh_driver_number = '34',  "function" = 'HDT', irh_yard_number = '1'           WHERE name = 'Jeffrey Procon';
UPDATE drivers SET irh_driver_number = '398', "function" = 'HDT', irh_yard_number = '6'           WHERE name = 'Kyle Procon';
UPDATE drivers SET irh_driver_number = '266', "function" = 'HDT', irh_yard_number = '1'           WHERE name = 'Randy Purinton';
UPDATE drivers SET irh_driver_number = '501', "function" = 'HDT', irh_yard_number = '1'           WHERE name = 'James Smith';
UPDATE drivers SET irh_driver_number = '511', "function" = 'HDT', irh_yard_number = '1'           WHERE name = 'Eli Tomlinson';

-- ---- Class D -> LDT ----
UPDATE drivers SET irh_driver_number = '351', "function" = 'LDT', irh_yard_number = '1'           WHERE name = 'Mark Cummings';
UPDATE drivers SET irh_driver_number = '573', "function" = 'LDT', irh_yard_number = '1'           WHERE name = 'Joseph Demasi';
UPDATE drivers SET irh_driver_number = '95',  "function" = 'LDT', irh_yard_number = '1'           WHERE name = 'Daniel Heroux';
UPDATE drivers SET irh_driver_number = '549', "function" = 'LDT', irh_yard_number = '1'           WHERE name = 'Braeden Houle';
UPDATE drivers SET irh_driver_number = '579', "function" = 'LDT', irh_yard_number = '1'           WHERE name = 'Chase Lanoue';
UPDATE drivers SET irh_driver_number = '395', "function" = 'LDT', irh_yard_number = '5'           WHERE name = 'Louis Loya';
UPDATE drivers SET irh_driver_number = '500', "function" = 'LDT', irh_yard_number = '6'           WHERE name = 'James Mayo';        -- ⚠ duplicate #500
UPDATE drivers SET irh_driver_number = '397', "function" = 'LDT', irh_yard_number = '6'           WHERE name = 'Aj Misischia Jr';   -- "Aj" = Alan
UPDATE drivers SET irh_driver_number = '400', "function" = 'LDT', irh_yard_number = '1'           WHERE name = 'Timothy Misischia';
UPDATE drivers SET irh_driver_number = '410', "function" = 'LDT', irh_yard_number = '1'           WHERE name = 'Peter Morales';
UPDATE drivers SET irh_driver_number = '448', "function" = 'LDT', irh_yard_number = '6'           WHERE name = 'Tyler Posusky';
UPDATE drivers SET irh_driver_number = '114', "function" = 'LDT', irh_yard_number = '1'           WHERE name = 'Jeremy Proulx';
UPDATE drivers SET irh_driver_number = '562', "function" = 'LDT', irh_yard_number = '1'           WHERE name = 'Jaishawn Sullivan';
UPDATE drivers SET irh_driver_number = '500', "function" = 'LDT', irh_yard_number = '6'           WHERE name = 'Francisco Vazquez'; -- ⚠ duplicate #500
UPDATE drivers SET irh_driver_number = '328', "function" = 'LDT', irh_yard_number = '5'           WHERE name = 'Matthew West';
UPDATE drivers SET irh_driver_number = '542', "function" = 'LDT', irh_yard_number = '6'           WHERE name = 'Tristan Wilhelm';

-- ---- UFP location -> Transport (overrides license) ----
UPDATE drivers SET irh_driver_number = '306', "function" = 'Transport', irh_yard_number = 'UFP'   WHERE name = 'Chris Hernandez';   -- incoming: Hernandez-Ward
UPDATE drivers SET irh_driver_number = '307', "function" = 'Transport', irh_yard_number = 'UFP'   WHERE name = 'Dakota Nadle';
UPDATE drivers SET irh_driver_number = '43',  "function" = 'Transport', irh_yard_number = 'UFP'   WHERE name = 'Raymond Rivet';     -- incoming: Rivet Jr
UPDATE drivers SET irh_driver_number = '566', "function" = 'Transport', irh_yard_number = 'UFP'   WHERE name = 'Miguel Santana';

-- ---- Dispatch / office / mechanic / blank class -> Dispatch ----
UPDATE drivers SET irh_driver_number = '569', "function" = 'Dispatch', irh_yard_number = 'Dispatch'    WHERE name = 'Pierce Canty';
UPDATE drivers SET irh_driver_number = '576', "function" = 'Dispatch', irh_yard_number = 'mechanic'    WHERE name = 'Chase Daunais';
UPDATE drivers SET irh_driver_number = '449', "function" = 'Dispatch', irh_yard_number = 'Dispatch 6'  WHERE name = 'Heidi Fiske';
UPDATE drivers SET irh_driver_number = '272', "function" = 'Dispatch', irh_yard_number = 'dispatch'    WHERE name = 'Daniel Mason';
UPDATE drivers SET irh_driver_number = '320', "function" = 'Dispatch', irh_yard_number = 'dispatch'    WHERE name = 'Keenan O''reilly';

-- ---- DB-only drivers (not on the incoming roster) ----
UPDATE drivers SET "function" = 'Office Manager' WHERE name = 'Stephen Gonneville';
UPDATE drivers SET "function" = 'Dispatch'       WHERE name = 'Karl Hosnander';

-- Mark these three inactive (no longer on the active roster).
-- Their old shifts/history stay; they won't show in the scheduler by default.
UPDATE drivers
   SET active          = false,
       inactive_reason = 'not on current roster',
       inactive_since  = CURRENT_DATE
 WHERE name IN ('Jeremy Procon', 'Lewis Loya Jr', 'Richard Bertrand');


-- 3. Insert 11 new drivers, using their IRH# as the row id.
--    yard column is NOT NULL in the shared schema; we set 'Interstate' (matching
--    the existing convention) and put the actual yard in irh_yard_number.
WITH new_rows(name, "function", irh, irh_yard) AS (
  VALUES
    ('Joseph Berardi',     'LDT',      '585', '1'),
    ('Deanna Blair',       'Dispatch', '438', 'Dispatch'),
    ('Joseph Caputo',      'LDT',      '584', '6'),
    ('Jillian Champagne',  'Dispatch', '534', 'Dispatch'),
    ('Blake Green',        'HDT',      '582', '6'),
    ('Amanda Martin',      'Dispatch', '564', 'dispatch'),
    ('Jessica Monett',     'Dispatch', '406', 'office'),
    ('Courtney Philpott',  'Dispatch', '513', 'office'),
    ('Stephanie Pierce',   'Dispatch', '575', 'dispach'),
    ('Desiree Roda',       'Dispatch', '447', 'dispatch'),
    ('Abigail White',      'Dispatch', '520', 'dispatch')
)
INSERT INTO drivers (id, name, "function", yard, "Company", irh_driver_number, irh_yard_number, active)
SELECT
  nr.irh::integer,
  nr.name,
  nr."function",
  'Interstate',
  'Interstate',
  nr.irh,
  nr.irh_yard,
  true
FROM new_rows nr
WHERE NOT EXISTS (SELECT 1 FROM drivers d WHERE LOWER(d.name) = LOWER(nr.name))
  AND NOT EXISTS (SELECT 1 FROM drivers d WHERE d.id = nr.irh::integer);


-- 4. Sanity check — rows after the run, ordered by IRH yard then function then IRH#.
SELECT name, "function", irh_yard_number, irh_driver_number, active
FROM drivers
WHERE "Company" = 'Interstate'
ORDER BY irh_yard_number NULLS LAST, "function" NULLS LAST, irh_driver_number::integer NULLS LAST;
