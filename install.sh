#!/usr/bin/env bash
# Redstone Cowork — one-line server installer for any Linux VPS.
#
#   curl -fsSL https://raw.githubusercontent.com/ngocanhnckh/redstone-cowork/main/install.sh | bash
#
# Clones the repo, picks a FREE uncommon host-port pair (confirmed with you),
# generates the login token + secrets, brings the Docker stack up, and prints the
# URL + token to sign in. Re-running against an existing install leaves its .env
# (ports/token) untouched.
set -euo pipefail

REPO_URL="${RCW_REPO_URL:-https://github.com/ngocanhnckh/redstone-cowork.git}"
BRANCH="${RCW_BRANCH:-main}"
DIR="${RCW_DIR:-$HOME/redstone-cowork}"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
info() { printf '  %s\n' "$1"; }
die()  { printf '\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

# Read a prompt even when the script is piped from curl (stdin is the script, so we
# talk to the terminal directly). Non-interactive (no tty) → use the default.
ask() { # ask <prompt> <default>
  local prompt="$1" def="$2" ans=""
  if [ -r /dev/tty ]; then printf '%s' "$prompt" > /dev/tty; read -r ans < /dev/tty || true; fi
  printf '%s' "${ans:-$def}"
}
confirm() { # confirm <prompt>  → 0 if yes
  local ans; ans="$(ask "$1 [y/N] " "n")"
  case "$ans" in y|Y|yes|YES) return 0 ;; *) return 1 ;; esac
}

bold "Redstone Cowork installer"

# ---- prerequisites --------------------------------------------------------
command -v git >/dev/null 2>&1 || die "git is required (apt install git)."
SUDO=""; [ "$(id -u)" -eq 0 ] || SUDO="sudo"

if ! command -v docker >/dev/null 2>&1; then
  info "Docker is not installed."
  if confirm "Install Docker now (get.docker.com)?"; then
    curl -fsSL https://get.docker.com | $SUDO sh || die "Docker install failed."
    $SUDO usermod -aG docker "$USER" 2>/dev/null || true
  else
    die "Docker is required. Install it and re-run."
  fi
fi
# docker compose v2 (plugin) or fall back to the v1 binary.
if docker compose version >/dev/null 2>&1; then DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then DC="docker-compose"
else die "Docker Compose v2 is required (comes with modern Docker)."; fi
DOCKER="docker"; docker info >/dev/null 2>&1 || DOCKER="$SUDO docker"

# ---- fetch the repo -------------------------------------------------------
if [ -d "$DIR/.git" ]; then
  info "Updating existing checkout at $DIR"
  git -C "$DIR" pull --ff-only origin "$BRANCH" || info "(couldn't fast-forward — keeping local)"
else
  info "Cloning into $DIR"
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$DIR" || die "git clone failed."
fi
cd "$DIR"

# ---- .env: keep an existing one; otherwise generate a fresh identity ------
if [ -f .env ]; then
  bold "An install already exists here — leaving .env untouched."
else
  gen() { openssl rand -hex "$1" 2>/dev/null || head -c "$((${1}*2))" /dev/urandom | od -An -tx1 | tr -d ' \n'; }

  # Unique container/volume namespace so several installs can share one VPS.
  DEFNAME="$(printf 'rcw-%s' "$(hostname -s 2>/dev/null || echo host)" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9_-]/-/g; s/^[^a-z0-9]*//')"
  NAME="$(ask "Install name (containers/volumes) [$DEFNAME]: " "$DEFNAME")"

  # Free consecutive pair in the uncommon 47000–48899 range.
  bold "Finding a free port pair…"
  PORTS="$(
    used="$(ss -tlnH 2>/dev/null | awk '{p=$4; sub(/.*:/,"",p); print p}' | sort -u)"
    free(){ ! grep -qx "$1" <<<"$used"; }
    for _ in $(seq 1 100); do
      base=$(( (RANDOM % 950) * 2 + 47000 )); a=$base; b=$((base+1))
      if free "$a" && free "$b"; then echo "$a $b"; break; fi
    done
  )"
  [ -n "$PORTS" ] || die "no free port pair found in 47000–48899."
  WEB_PORT="${PORTS% *}"; API_PORT="${PORTS#* }"

  bold "Proposed configuration"
  info "name:     $NAME"
  info "web port: $WEB_PORT   (the UI you sign in to)"
  info "api port: $API_PORT"
  if [ -r /dev/tty ]; then
    confirm "Write .env and start the stack?" || die "aborted."
  else
    info "(non-interactive — proceeding)"
  fi

  cp .env.example .env
  sed -i "s/change-me-postgres/$(gen 16)/" .env
  sed -i "s/change-me-token/$(gen 24)/" .env
  sed -i "s/^COMPOSE_PROJECT_NAME=.*/COMPOSE_PROJECT_NAME=$NAME/" .env
  sed -i "s/^WEB_PORT=.*/WEB_PORT=$WEB_PORT/" .env
  sed -i "s/^API_PORT=.*/API_PORT=$API_PORT/" .env
fi

# ---- build + start --------------------------------------------------------
bold "Building and starting containers (first build can take a few minutes)…"
$DOCKER compose up -d --build 2>/dev/null || $DC up -d --build

# ---- report ---------------------------------------------------------------
# shellcheck disable=SC1091
. ./.env
IP="$(curl -fsS https://api.ipify.org 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')"

printf '\n'
bold "✓ Redstone Cowork is up."
info "URL:    http://${IP:-<server-ip>}:${WEB_PORT}"
info "Token:  ${INSTANCE_TOKEN}"
printf '\n'
info "Sign in with that token (it's your password). Keep it secret — anyone with it"
info "controls this instance. It's stored in $DIR/.env."
info "For a public HTTPS URL, point a reverse proxy / Cloudflare tunnel at the web port."
printf '\n'
info "Manage:  cd $DIR && $DC ps | logs | down"
