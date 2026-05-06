# Interstate Driver Scheduler

Live, multi-dispatcher driver scheduling tool for NETC Fleet Services. Static site deployed via GitHub Pages, backed by Supabase (Postgres + Realtime + Auth).

## Stack

- **Frontend:** vanilla HTML/CSS/JS, no build step
- **Backend:** Supabase (Postgres, Realtime, Auth)
- **Hosting:** GitHub Pages

## File structure

```
interstate-driver-scheduler/
  index.html                           Entry page
  css/styles.css                       All styles
  js/
    config.js                          App constants (categories, off-reasons, etc.)
    supabase-config.js                 Real Supabase URL + key (GITIGNORED)
    supabase-config.example.js         Template (committed)
    supabase.js                        Creates the Supabase client
    utils.js                           Date helpers, formatters
    db.js                              CRUD wrappers around Supabase
    app.js                             Entry point, page wiring
  supabase/
    migrations/                        SQL schema files
  .env.example                         Env var template (committed)
  .env.local                           Real env vars (GITIGNORED)
  .gitignore
  README.md
```

## Local setup

1. Copy `.env.example` to `.env.local` and fill in your Supabase URL + publishable key.
2. Copy `js/supabase-config.example.js` to `js/supabase-config.js` and fill in the same values.
3. Open `index.html` directly in a browser (no server needed) — or use a local static server like `python -m http.server` or VS Code Live Server.

## Schema

See [`supabase/migrations/`](supabase/migrations/) for the SQL.

- `drivers` (existing, shared with other apps) — augmented with `active`, `inactive_reason`, `inactive_since`
- `scheduler_driver_schedule` (this project) — one row per driver per date, either a `shift` or an `off` entry

## Deployment

Pushes to `main` deploy automatically to GitHub Pages. (Set up in Phase 9.)
