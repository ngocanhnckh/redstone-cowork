#!/usr/bin/env bash
# Drive Redstone Cowork on a remote Docker host (the Mac never runs Docker).
# Usage: deploy/remote.sh {sync|init|build|up|down|logs|ps|smoke} [args...]
set -euo pipefail

SERVER="${DEV_SERVER:-youruser@your-server.example.com}"
DIR="${DEV_DIR:-/home/youruser/redstone-cowork}"

sync() {
  rsync -az --delete \
    --exclude .git --exclude node_modules --exclude '*/node_modules' \
    --exclude .creds --exclude .env --exclude dist --exclude .next \
    ./ "$SERVER:$DIR/"
}

case "${1:-help}" in
  sync) sync ;;
  init)
    sync
    # Refuse to clobber an existing install — its ports/name/secrets are load-bearing.
    if ssh "$SERVER" "[ -f $DIR/.env ]"; then
      echo "→ $DIR/.env already exists on $SERVER — leaving it untouched."
      echo "  (Remove it there first if you really want to re-run init.)"
      exit 0
    fi

    # Many accounts run many cowork installs on one host, so each install needs its
    # own container/volume namespace AND its own host ports or they collide (two
    # installs sharing COMPOSE_PROJECT_NAME would even cross-mount each other's
    # Postgres volume). init proposes a unique name + a free uncommon port pair,
    # then CONFIRMS with the user before writing anything.

    # 1. Install name → COMPOSE_PROJECT_NAME. Default rcw-<remote-user>-<dir>,
    #    sanitised to a valid compose project name ([a-z0-9][a-z0-9_-]*).
    ruser="${SERVER%@*}"; [ "$ruser" = "$SERVER" ] && ruser="$(whoami)"
    default_name="$(printf 'rcw-%s-%s' "$ruser" "$(basename "$DIR")" \
      | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9_-]/-/g; s/^[^a-z0-9]*//; s/-\{2,\}/-/g')"
    name="${RCW_INSTALL_NAME:-}"
    if [ -z "$name" ] && [ -t 0 ]; then
      read -r -e -i "$default_name" -p "Install name (containers/volumes): " name
    fi
    name="${name:-$default_name}"

    # 2. Scan the host for a free consecutive pair in the uncommon 47000–48899
    #    range (matches the project's 47100/47101 convention). Random even base so
    #    two installs started at once rarely propose the same pair. `ss` surfaces
    #    docker-published ports too (via the docker-proxy listeners).
    ports="$(ssh "$SERVER" 'bash -s' <<'SCAN'
used="$(ss -tlnH 2>/dev/null | awk '{p=$4; sub(/.*:/,"",p); print p}' | sort -u)"
free(){ ! grep -qx "$1" <<<"$used"; }
for _ in $(seq 1 100); do
  base=$(( (RANDOM % 950) * 2 + 47000 )); a=$base; b=$((base+1))
  if free "$a" && free "$b"; then echo "$a $b"; exit 0; fi
done
exit 1
SCAN
)" || { echo "✗ no free port pair found in 47000–48899 on $SERVER"; exit 1; }
    web_port="${ports% *}"; api_port="${ports#* }"

    # 3. Confirm before touching the server.
    printf '\nProposed install on %s:%s\n' "$SERVER" "$DIR"
    printf '  name (containers/volumes): %s\n' "$name"
    printf '  web port:                  %s\n' "$web_port"
    printf '  api port:                  %s\n' "$api_port"
    if [ -t 0 ]; then
      read -r -p "Write .env and proceed? [y/N] " ok
      case "$ok" in y|Y|yes|YES) ;; *) echo "aborted."; exit 1 ;; esac
    else
      echo "(non-interactive stdin — proceeding with the above)"
    fi

    # 4. Write .env with the chosen identity + fresh secrets.
    ssh "$SERVER" "cd $DIR && cp .env.example .env \
      && sed -i \"s/change-me-postgres/\$(openssl rand -hex 16)/\" .env \
      && sed -i \"s/change-me-token/\$(openssl rand -hex 24)/\" .env \
      && sed -i \"s/^COMPOSE_PROJECT_NAME=.*/COMPOSE_PROJECT_NAME=$name/\" .env \
      && sed -i \"s/^WEB_PORT=.*/WEB_PORT=$web_port/\" .env \
      && sed -i \"s/^API_PORT=.*/API_PORT=$api_port/\" .env \
      && echo '.env created'" ;;
  build) sync; ssh "$SERVER" "cd $DIR && docker compose build" ;;
  up)    sync; ssh "$SERVER" "cd $DIR && docker compose up -d --build" ;;
  down)  ssh "$SERVER" "cd $DIR && docker compose down" ;;
  logs)  ssh "$SERVER" "cd $DIR && docker compose logs ${2:---tail=100}" ;;
  ps)    ssh "$SERVER" "cd $DIR && docker compose ps" ;;
  smoke)
    ssh "$SERVER" "cd $DIR && set -e
      . ./.env
      echo '--- health ---'
      curl -sf http://localhost:\${API_PORT:-47101}/health
      echo; echo '--- record event ---'
      curl -sf -X POST http://localhost:\${API_PORT:-47101}/events \
        -H \"Authorization: Bearer \$INSTANCE_TOKEN\" -H 'Content-Type: application/json' \
        -d '{\"type\":\"smoke.test\",\"source\":\"remote.sh\",\"payload\":{\"m\":\"M0\"}}'
      echo; echo '--- list events ---'
      curl -sf http://localhost:\${API_PORT:-47101}/events -H \"Authorization: Bearer \$INSTANCE_TOKEN\" | head -c 400
      echo; echo '--- web ---'
      curl -sf http://localhost:\${WEB_PORT:-47100}/ -o /dev/null -w 'web: %{http_code}\n'
      echo '--- compose ps ---'
      docker compose ps" ;;
  *) echo "usage: deploy/remote.sh {sync|init|build|up|down|logs|ps|smoke}"; exit 1 ;;
esac
