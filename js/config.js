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
  defaultViewDays: 3,
  viewDayChoices:  [1, 2, 3, 4, 5, 6, 7, 14],

  // Default company filter on load. Match the value as stored in drivers."Company".
  // Set to null/empty to show all companies on first load.
  defaultCompany: "Interstate",

  // Restrict the company dropdown to this set. Other companies in the DB
  // won't appear as options. Set to null to show all distinct companies.
  allowedCompanies: ["Interstate"],

  // Yard merge map. Each entry maps a real yard code -> the yard it should
  // be grouped under in the UI. The dropdown only shows the target values;
  // selecting one filters drivers from ANY mapped real yard. The data in
  // Supabase (`drivers.irh_yard_number`) is NOT modified — only the UI groups.
  // Example: { "5": "1" } means "yard 5 drivers show under yard 1".
  yardAliases: { "5": "1" },
};
