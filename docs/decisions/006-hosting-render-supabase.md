# ADR 006: Host on Render (one container), database on Supabase

**Status:** Proposed by Jon, 2026-11-24. Needs team sign-off.

## Context

[ADR 001](001-hybrid-fastapi-supabase-architecture.md) keeps FastAPI as the application server and
PostgreSQL on Supabase as the database. Supabase cannot run FastAPI or serve the React build, so a second
host is required. The backend already serves `web/dist`, so one container can serve everything.

## Decision

- **Application host:** Render, one Docker web service built from `Dockerfile` and `render.yaml`. It serves
  the API, `/ws`, and the built web app from one origin (no CORS setup, one URL to share).
- **Database:** Supabase PostgreSQL, reached through `DATABASE_URL`. Apply `supabase/migrations/` in order
  before connecting it. Until then, a blank `DATABASE_URL` runs the demo on SQLite inside the container
  (reset on every deploy or restart).
- **TLS:** terminated by Render; uvicorn runs with `--proxy-headers`. `FORCE_HTTPS=true` (SE-NFR-06).

## Consequences

- Free-tier Render services sleep after inactivity; the first request is slow (relevant to SE-NFR-08 measurements).
- `DEMO_MODE=true` publishes the demo accounts and their shared password on the login page. Set it to
  `false` and `SEED_DEMO_DATA=false` before any real use.
- Calendar OAuth redirect URIs must be registered for the deployed origin (see README, "Calendar provider setup").
- CI and automatic deploys on merge to `main` are still to be added.
