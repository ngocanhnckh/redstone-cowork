#!/usr/bin/env bash
#
# One-time cowork-server setup for the NAT'd-host SSH relay (reverse tunnel).
# Creates a locked-down broker user `rcwtun` whose ~/.ssh/authorized_keys is
# managed by the API container (bind-mounted). Reverse-forwarded ports bind to
# the relay's loopback only; the cockpit reaches them by jumping through rcwtun.
#
# SAFE BY DESIGN: creates only a NEW user, never edits sshd_config, never
# restarts sshd — so your existing SSH access cannot be affected. sshd's
# StrictModes accepts a root-owned authorized_keys (the API container runs as
# root and writes it via the bind mount).
#
# RUN AS ROOT ON THE COWORK SERVER:  sudo bash deploy/setup-relay.sh
#
set -euo pipefail

RCWTUN_USER="${RCWTUN_USER:-rcwtun}"
RCWTUN_HOME="/home/${RCWTUN_USER}"
SSH_DIR="${RCWTUN_HOME}/.ssh"
AUTHKEYS="${SSH_DIR}/authorized_keys"

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: must run as root (sudo bash deploy/setup-relay.sh)" >&2
  exit 1
fi

# 1. Create the broker user (nologin: forwarding-only, no interactive shell).
#    `ssh -N -R` and `ssh -W` do port forwarding without ever exec'ing a shell,
#    so nologin does not block the tunnel — it just hardens the account.
if ! id -u "$RCWTUN_USER" >/dev/null 2>&1; then
  useradd -m -s /usr/sbin/nologin "$RCWTUN_USER"
  echo "created user $RCWTUN_USER"
else
  echo "user $RCWTUN_USER already exists"
fi

# 2. ~/.ssh with StrictModes-correct ownership/permissions.
install -d -m 755 -o "$RCWTUN_USER" -g "$RCWTUN_USER" "$RCWTUN_HOME"
install -d -m 700 -o "$RCWTUN_USER" -g "$RCWTUN_USER" "$SSH_DIR"
if [ ! -f "$AUTHKEYS" ]; then
  # The API container rewrites this file (root-owned via the bind mount, which
  # sshd accepts). Seed it empty so the mount target exists before first write.
  install -m 600 -o root -g root /dev/null "$AUTHKEYS"
  echo "seeded empty $AUTHKEYS"
else
  echo "$AUTHKEYS already present (left as-is)"
fi

# 3. Sanity: confirm sshd permits TCP forwarding (default = yes). We do NOT
#    change config; just warn if a hardened box has it disabled.
if command -v sshd >/dev/null 2>&1; then
  FWD="$(sshd -T 2>/dev/null | awk '/^allowtcpforwarding/ {print $2}' || true)"
  case "$FWD" in
    ""|yes|all|remote|local)
      echo "sshd AllowTcpForwarding = ${FWD:-yes} (ok)";;
    *)
      echo "WARNING: sshd AllowTcpForwarding=$FWD — reverse tunnels need 'yes'/'remote'." >&2
      echo "         Add 'Match User $RCWTUN_USER' + 'AllowTcpForwarding yes' and reload sshd if needed." >&2;;
  esac
fi

echo
echo "rcwtun relay broker ready."
echo "Next (on the cowork server, in the repo dir):"
echo "  - add to .env:  RELAY_HOST=<this server's SSH-reachable address>"
echo "  - (optional)    RCWTUN_SSH_DIR=$SSH_DIR   RCWTUN_USER=$RCWTUN_USER"
echo "  - redeploy the API so it mounts $SSH_DIR and starts managing authorized_keys."
