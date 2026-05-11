// App-level constants. No secrets here.

window.APP_CONFIG = {
  // Driver categories (must match what gets stored in drivers.function)
  driverCategories: ["LDT", "HDT", "Transport", "Road Service", "Dispatch", "Office Manager"],

  // Only these functions appear in the scheduler grid. Dispatch + Office Manager
  // exist in `drivers` but are not scheduled here.
  schedulableFunctions: ["LDT", "HDT", "Transport", "Road Service"],

  // Top-level tabs. Each tab restricts the grid to one set of functions.
  // Switch tabs at the top of the app; both share the same scheduling UI.
  tabs: [
    { id: "drivers",     label: "Drivers",     functions: ["LDT", "HDT", "Transport", "Road Service"] },
    { id: "dispatchers", label: "Dispatchers", functions: ["Dispatch", "Office Manager"] },
    { id: "stats",       label: "Stats",       functions: null /* stats has its own scope picker */ },
    { id: "historical",  label: "Historical",  functions: null /* read-only baseline view */ },
    { id: "settings",    label: "Settings",    functions: null /* config form */ },
  ],
  defaultTab: "drivers",

  // Off-day reasons (must match the CHECK constraint in the migration)
  offReasons: ["PTO", "sick", "unavailable", "other"],

  // Time grid granularity in minutes
  timeStepMinutes: 30,

  // Default visible window in the day-view (24h grid still possible)
  defaultDayStartHour: 6,    // 06:00
  defaultDayEndHour:   22,   // 22:00

  // Week starts on Monday (ISO week)
  weekStartsOnMonday: true,

  // How many days are visible in the grid/gantt by default. The user can
  // change this from a dropdown in the view toolbar; navigation arrows and
  // copy buttons shift by this amount.
  defaultViewDays: 7,
  viewDayChoices:  [1, 2, 3, 4, 5, 6, 7, 14],

  // Default company filter on load. Match the value as stored in drivers."Company".
  // Set to null/empty to show all companies on first load.
  defaultCompany: "Interstate",

  // Restrict the company dropdown to this set. Other companies in the DB
  // won't appear as options. Set to null to show all distinct companies.
  allowedCompanies: ["Interstate"],

  // Names to suppress from the scheduler entirely (case-insensitive, trimmed
  // exact match on `drivers.name`). Use for managers / non-driver staff who
  // happen to live in the drivers table but shouldn't appear on schedules,
  // stats, or print sheets.
  excludedDriverNames: ["Stephen Gonneville"],

  // Yard merge map. Each entry maps a real yard code -> the yard it should
  // be grouped under in the UI. The dropdown only shows the target values;
  // selecting one filters drivers from ANY mapped real yard. The data in
  // Supabase (`drivers.irh_yard_number`) is NOT modified — only the UI groups.
  // Example: { "5": "1" } means "yard 5 drivers show under yard 1".
  yardAliases: { "5": "1" },

  // Demand-vs-supply optimizer. Compares scheduled drivers per hour against
  // the historical call-volume baseline (table: call_volume_baseline) and
  // flags hours that are under- or over-staffed.
  optimizer: {
    // How many calls one driver can effectively absorb per hour, factoring
    // in average call duration (drive + hookup + transport + paperwork ≈
    // 1.5h), travel between calls, breaks, and slack for arrival variance.
    // 0.6 means demand_drivers = avg_calls/hr ÷ 0.6 ≈ 1.67 × avg_calls/hr,
    // which roughly matches what dispatchers see operationally.
    // Tune up (less staffing needed) or down (more) in the Settings tab.
    callsPerDriverPerHour: 0.6,

    // gap = supply - demand_in_drivers. Negative = short.
    // These defaults match the "Balanced" preset in the Settings tab; the UI
    // exposes a single sensitivity dropdown that expands to these two fields.
    // Flag understaffed when gap is at or below this value.
    understaffedThreshold: -1.5,
    // Flag overstaffed when gap is at or above this value.
    overstaffedThreshold:   2.0,

    // Only count drivers in these functions toward "supply". The historical
    // baseline is towing-call volume, so Transport / Road Service drivers
    // don't count against it.
    supplyFunctions: ["LDT", "HDT"],

    // Exclude drivers whose `irh_yard_number` contains any of these codes.
    // UFP drivers are dedicated to the Universal Forest Products yard work
    // and aren't available for towing calls, even if their function is LDT/HDT.
    // A multi-yard driver like "1,UFP" matches and is excluded.
    excludeYards: ["UFP"],

    // How many top suggestions to surface in the Coverage panel.
    topUnderstaffedCount: 5,
    topOverstaffedCount:  3,
  },
};
