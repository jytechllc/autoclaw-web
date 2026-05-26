#!/usr/bin/env bash
# Local cron loop for demo — replaces Vercel cron in dev.
# Calls dispatch-followups every INTERVAL seconds against the local dev server.
#
# Usage:
#   scripts/local-cron.sh                # default INTERVAL=30 BASE=http://localhost:3002
#   INTERVAL=5 BASE=http://localhost:3002 scripts/local-cron.sh
#
# Speed-demo trick: set DEMO_SPEED=1 to make scheduled_emails created in the
# last 5 minutes mature immediately (run_at = NOW()), so a 365-day funnel
# completes in ~30 seconds on stage.

set -u
INTERVAL="${INTERVAL:-30}"
BASE="${BASE:-http://localhost:3002}"
SECRET="${CRON_SECRET:-stub}"
DEMO_SPEED="${DEMO_SPEED:-0}"

DB_URL="${DATABASE_URL:-postgres://autoclaw:autoclaw@localhost:5433/autoclaw}"

echo "[local-cron] base=$BASE interval=${INTERVAL}s demo_speed=$DEMO_SPEED"

while true; do
  if [ "$DEMO_SPEED" = "1" ]; then
    PGPASSWORD=autoclaw psql -h localhost -p 5433 -U autoclaw -d autoclaw -c \
      "UPDATE scheduled_emails SET run_at = NOW() WHERE status='pending' AND created_at >= NOW() - INTERVAL '10 minutes'" \
      >/dev/null 2>&1 || true
  fi
  ts=$(date +%H:%M:%S)
  out=$(curl -sS -H "Authorization: Bearer $SECRET" "$BASE/api/cron/dispatch-followups" 2>&1)
  echo "[$ts] dispatch-followups → $out"
  sleep "$INTERVAL"
done
