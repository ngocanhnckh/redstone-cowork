#!/usr/bin/env bash
# Open (or re-open) the SSH tunnel from this Mac to the dev server so that
# localhost:47100 = web UI and localhost:47101 = API.
# Usage: deploy/dev-tunnel.sh [up|down|status]
set -euo pipefail

SERVER="${DEV_SERVER:-ubuntu@18.143.147.28}"
PATTERN="ssh -f -N -L 47101:localhost:47101"

case "${1:-up}" in
  up)
    pkill -f "$PATTERN" 2>/dev/null || true
    sleep 1
    ssh -f -N -L 47101:localhost:47101 -L 47100:localhost:47100 "$SERVER"
    sleep 2
    if curl -sf -m 5 http://localhost:47101/health >/dev/null; then
      echo "tunnel up:"
      echo "  web UI : http://localhost:47100"
      echo "  API    : http://localhost:47101"
    else
      echo "tunnel started but API not responding — is the stack up on $SERVER?"
      exit 1
    fi
    ;;
  down)
    pkill -f "$PATTERN" 2>/dev/null && echo "tunnel closed" || echo "no tunnel running"
    ;;
  status)
    if curl -sf -m 5 http://localhost:47101/health >/dev/null; then echo "tunnel UP"; else echo "tunnel DOWN"; fi
    ;;
  *) echo "usage: deploy/dev-tunnel.sh [up|down|status]"; exit 1 ;;
esac
