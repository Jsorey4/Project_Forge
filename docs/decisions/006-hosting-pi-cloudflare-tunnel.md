# ADR 006: Host on a Raspberry Pi behind a Cloudflare Tunnel

**Status:** Proposed by Jon, 2026-11-24. Needs team sign-off. The first draft chose Render; it was dropped the
same day (see Context).

## Context

[ADR 001](001-hybrid-fastapi-supabase-architecture.md) keeps FastAPI as the application server and
PostgreSQL on Supabase as the database. Supabase cannot run FastAPI or serve the React build, so a second
host is required. The backend already serves `web/dist`, so one container can serve everything.

The deciding constraint is the demo for the professor and graders: they must not mistake a sleeping host for
a crashed app. Render's free plan sleeps a service after inactivity and the first request afterwards is slow,
so Render was dropped. A Raspberry Pi 5 that is always on has no cold start, and it already runs the pieces the
public path needs: `cloudflared` (a dashboard-managed Cloudflare Tunnel) and Tailscale.

## Decision

- **Application host:** a Raspberry Pi 5 running `docker-compose.yml`: one container built from the
  `Dockerfile`. It serves the API, `/ws`, and the built web app from one origin (no CORS setup, one URL to
  share). The port is published on `127.0.0.1:8000` only, so nothing on the home network can reach the app
  directly.
- **Public entrance:** a Cloudflare Tunnel. `cloudflared` on the Pi makes an outbound connection to Cloudflare,
  and a published-application route maps a hostname on a domain Cloudflare manages to `http://localhost:8000`.
  No router port is opened and the home IP address is never published. Cloudflare terminates TLS (SE-NFR-06);
  the app runs with `FORCE_HTTPS=true` and trusts the forwarded `X-Forwarded-Proto`. Cloudflare Access stays off
  for the app's hostname, because it would put a login screen in front of the graders.
- **Admin access:** Tailscale SSH only. SSH is never exposed to the internet.
- **Database:** SQLite on a named Docker volume by default, so demo data survives restarts and rebuilds.
  Supabase PostgreSQL is used by setting `DATABASE_URL` after `supabase/migrations/` has been applied in order.
  SQLite has no RLS, so anything beyond the demo must use PostgreSQL (README, Architecture).
- **Forwarded headers:** the Compose file limits uvicorn's trusted proxy list (`FORWARDED_ALLOW_IPS`) to the
  Compose network. With `*`, uvicorn takes the left-most `X-Forwarded-For` entry, which the client controls, so a
  client could forge it to dodge the per-IP rate limit (`core/security.py` keys on `request.client.host`).
  Limited to the Compose network, uvicorn takes the right-most untrusted entry, the address Cloudflare appended.

## Consequences

- Uptime depends on home power, the home internet line, and the Pi staying up. There is no fallback host.
  There is no cold start.
- Updating is manual: `deploy/pi/update.sh` pulls the tracked branch and rebuilds when there is a new commit.
  Running it on a timer, or from CI, is still to be added, as is CI itself.
- The rate limit is 5 login or sign-up attempts per address per 60 seconds. Several graders sharing one campus
  address could hit "try again later". Raising `RATE_LIMIT_REQUESTS` in `backend/.env` for the grading window is a
  team decision; no value is set here.
- `DEMO_MODE=true` publishes the demo accounts and their shared password on the login page. Set it to `false` and
  `SEED_DEMO_DATA=false` before any real use.
- Calendar OAuth redirect URIs must be registered for the deployed origin (README, "Calendar provider setup").
- The public hostname is a personal domain choice and is not recorded in the repository.

## Verification

Run 2026-11-24 on a MacBook under Colima (arm64, the Pi's architecture): the image builds; the container reports
healthy; plain HTTP redirects while a request carrying `X-Forwarded-Proto: https` succeeds; with a forged
left-most `X-Forwarded-For`, requests are rate-limited on the right-most address (429 from the sixth attempt),
whereas with `*` they never were; and the SQLite data survives `docker compose down` and `up`.

The same stack was then built and started on the Pi (Debian 12, arm64, Docker Engine 29 with Compose 5). There it
reports healthy, listens only on `127.0.0.1:8000` (a request from another machine on the home network to the Pi's
port 8000 gets no answer), gives the same 429 result for the forged-header test, keeps its SQLite data across
`docker compose down` and `up`, and starts on boot (`restart: unless-stopped`, Docker enabled).

**Not yet run:** the Cloudflare route to this app, `deploy/pi/update.sh`, and the Supabase connection.
