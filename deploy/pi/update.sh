#!/usr/bin/env bash
# Author: Jon Sorey. Pulls the tracked branch and rebuilds the ProjectForge container on the Raspberry Pi
# (ADR 006, revised). Run it by hand or from a systemd timer; it changes nothing when there is no new commit.
# Usage: deploy/pi/update.sh [branch]      (default: main)
set -euo pipefail

branch="${1:-main}"
cd "$(dirname "$0")/../.."

if [ ! -f backend/.env ]; then
  echo "backend/.env is missing. Copy backend/.env.example and set JWT_SECRET and FRONTEND_URL first." >&2
  exit 1
fi

git fetch --quiet origin "$branch"
local_sha="$(git rev-parse HEAD)"
remote_sha="$(git rev-parse "origin/$branch")"

# Rebuild only when the checked-out commit differs from the remote, or when the container is not running.
if [ "$local_sha" = "$remote_sha" ] && [ -n "$(docker compose ps --status running --quiet app)" ]; then
  echo "Up to date at ${local_sha:0:7}; nothing to do."
  exit 0
fi

git checkout --quiet "$branch"
git merge --ff-only --quiet "origin/$branch"
docker compose up -d --build
docker image prune -f >/dev/null
echo "Deployed $(git rev-parse --short HEAD). Health: $(docker inspect --format '{{.State.Health.Status}}' projectforge)"
