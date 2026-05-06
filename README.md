# Interstate Driver Scheduler

Live, multi-dispatcher driver scheduling tool for NETC Fleet Services. Static
site deployed via GitHub Pages, backed by Supabase (Postgres + Realtime + Auth).

## Stack

- **Frontend:** vanilla HTML/CSS/JS, no build step
- **Backend:** Supabase (Postgres, Realtime, Auth)
- **Charts:** Chart.js (CDN, pinned + SRI)
- **Hosting:** GitHub Pages

## File structure

```
irh-driver-scheduler/
  index.html                            Entry page + modal markup
  css/styles.css                        All styles
  js/
    config.js                           App constants (tabs, off-reasons, defaults)
    supabase-config.js                  Supabase URL + publishable key (committed)
    supabase-config.example.js          Template
    supabase.js                         Creates the Supabase client (window.sb)
    auth.js                             Auth wrapper, session pub-sub
    utils.js                            Date / time / formatting helpers
    db.js                               CRUD wrappers around Supabase
    shift-modal.js                      Shift / off-day editor modal
    day-view.js                         Day-detail timeline (drag-resize bars)
    scheduler.js                        Week grid + Gantt + filters + bulk actions
    stats.js                            Stats tab (12 charts on Chart.js)
    app.js                              Entry point: auth state -> view switching
  supabase/
    migrations/                         SQL schema + seed migrations
  .gitignore
  README.md
```

Script load order matters (deps before consumers); see the bottom of
`index.html`.

## Local setup

1. Copy `js/supabase-config.example.js` to `js/supabase-config.js` and fill in
   your project's URL + publishable (anon) key from
   Supabase Dashboard → Project Settings → API.
2. Open `index.html` directly in a browser, or use a local static server like
   `python -m http.server 8000` or VS Code Live Server.

The publishable key is safe to commit — it's designed to ship in static
sites, and RLS policies enforce all access control.
**Never commit a service-role key.**

## Schema

See [`supabase/migrations/`](supabase/migrations/) for the SQL.

- `drivers` (existing, shared with other apps) — augmented with `active`,
  `inactive_reason`, `inactive_since` (migration 1).
- `scheduler_driver_schedule` — one row per shift or off-day per driver
  (migration 1; `UNIQUE` constraint dropped in migration 6 to allow multi-shift
  days).
- `scheduler_distinct_companies`, `scheduler_distinct_yards` — read-only views
  used by the filter dropdowns (migration 7).

## Authn / authz

- All app users sign in with email + password (Supabase Auth).
- RLS on `scheduler_driver_schedule` allows any authenticated user full CRUD —
  appropriate for an internal tool with 3–5 dispatchers; tighten if scope grows.

## Realtime

`scheduler.js` subscribes to `postgres_changes` on `scheduler_driver_schedule`.
INSERT/UPDATE/DELETE from any dispatcher triggers a debounced re-render in all
open clients.

## Deployment

Pushes to the deployed branch go live on GitHub Pages automatically. CDN
scripts in `index.html` are pinned to specific versions with SRI hashes; bump
the versions + recompute the hashes when upgrading.

```bash
# Recompute SRI:
curl -s https://cdn.jsdelivr.net/npm/<pkg>@<version>/<path> \
  | openssl dgst -sha384 -binary | openssl base64 -A
```
