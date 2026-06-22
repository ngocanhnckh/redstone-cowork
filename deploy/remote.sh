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
    ssh "$SERVER" "cd $DIR && [ -f .env ] || (cp .env.example .env \
      && sed -i \"s/change-me-postgres/\$(openssl rand -hex 16)/\" .env \
      && sed -i \"s/change-me-token/\$(openssl rand -hex 24)/\" .env \
      && echo '.env created')" ;;
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
