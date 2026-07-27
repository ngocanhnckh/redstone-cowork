import { Controller, Get, Header, Res } from "@nestjs/common";
import type { Response } from "express";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const bundlePath = () => process.env.REDSTONE_BUNDLE_PATH ?? join(process.cwd(), "redstone.bundle.js");

@Controller()
export class InstallController {
  @Get("install.sh")
  @Header("Content-Type", "text/plain; charset=utf-8")
  // The script + bundle update on every deploy — must never be cached by a CDN.
  @Header("Cache-Control", "no-store, max-age=0")
  installScript(): string {
    return INSTALL_SH;
  }

  @Get("install/redstone.js")
  bundle(@Res() res: Response) {
    const p = bundlePath();
    if (!existsSync(p)) return res.status(503).send("bundle unavailable");
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, max-age=0");
    return res.send(readFileSync(p, "utf8"));
  }
}

// Zero-surprise host onboarding: instead of erroring when the host lacks Node/tmux/Claude,
// the installer PROVISIONS them in userspace under ~/.redstone — a private Node (official
// binary from nodejs.org), a private npm-global prefix (so `npm i -g` never needs sudo),
// Claude Code, and (if absent) a static tmux. Nothing touches the system or needs root. A
// sourced ~/.redstone/env keeps those private binaries on PATH for the agent + every session.
const INSTALL_SH = `#!/usr/bin/env bash
set -euo pipefail
SERVER=""; TOKEN=""; RELAY=""
while [ $# -gt 0 ]; do case "$1" in
  --server) SERVER="$2"; shift 2;;
  --token) TOKEN="$2"; shift 2;;
  --relay) RELAY="1"; shift;;
  *) echo "unknown arg: $1" >&2; exit 1;; esac; done
[ -n "$SERVER" ] && [ -n "$TOKEN" ] || { echo "usage: install.sh --server <url> --token <token> [--relay]" >&2; exit 1; }

RS="$HOME/.redstone"
mkdir -p "$RS" "$RS/bin" "$RS/npm/bin" "$HOME/.local/bin" || { echo "RCW_ERR couldn't create ~/.redstone on the server (disk full or permissions)." >&2; exit 3; }

# Preflight: refuse on a nearly-full disk (a private Node is ~120MB). Otherwise curl fails
# cryptically ("Failure writing output"), leaving a 0-byte download.
AVAIL_KB="$(df -Pk "$HOME" 2>/dev/null | awk 'NR==2{print $4+0}')"
if [ -n "$AVAIL_KB" ] && [ "$AVAIL_KB" -lt 204800 ]; then
  echo "RCW_ERR the server's disk is nearly full (only $((AVAIL_KB/1024)) MB free on $HOME). Free up space and retry." >&2; exit 3
fi

# Private binaries take precedence, but a good-enough system install is reused as-is.
export NPM_CONFIG_PREFIX="$RS/npm"
export PATH="$RS/node/bin:$RS/npm/bin:$RS/bin:$PATH"
node_major() { command -v node >/dev/null 2>&1 && node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }

# --- Ensure Node >= 20 (userspace, no sudo, no package manager) ----------
if [ "$(node_major)" -lt 20 ]; then
  echo "Node >= 20 not found — installing a private copy under ~/.redstone (no sudo)..."
  OS="$(uname -s)"; ARCH="$(uname -m)"
  case "$ARCH" in x86_64|amd64) NA=x64;; aarch64|arm64) NA=arm64;; armv7l) NA=armv7l;; *) echo "RCW_ERR unsupported CPU arch '$ARCH' — please install Node >= 20 manually and retry." >&2; exit 3;; esac
  case "$OS" in Linux) NP=linux;; Darwin) NP=darwin;; *) echo "RCW_ERR unsupported OS '$OS' — please install Node >= 20 manually and retry." >&2; exit 3;; esac
  NV=v22.11.0
  URL="https://nodejs.org/dist/$NV/node-$NV-$NP-$NA.tar.gz"
  TMP="$(mktemp -d)"
  curl -fsSL "$URL" -o "$TMP/node.tgz" || { echo "RCW_ERR couldn't download Node from nodejs.org (no internet on the host?). Install Node >= 20 and retry." >&2; exit 3; }
  rm -rf "$RS/node"; mkdir -p "$RS/node"
  tar -xzf "$TMP/node.tgz" -C "$RS/node" --strip-components=1 || { echo "RCW_ERR couldn't unpack Node (is 'tar' available?)." >&2; exit 3; }
  rm -rf "$TMP"
  [ "$(node_major)" -ge 20 ] || { echo "RCW_ERR the private Node still isn't usable." >&2; exit 3; }
  echo "  Node $(node -v) ready."
fi

# --- Ensure tmux (sessions run in it). Reuse system tmux; else a static build. ---
if ! command -v tmux >/dev/null 2>&1; then
  echo "tmux not found — fetching a private static build..."
  OS="$(uname -s)"; ARCH="$(uname -m)"; T=""
  if [ "$OS" = "Linux" ]; then case "$ARCH" in
    x86_64|amd64) T="$SERVER/install/tmux-linux-x64";;
    aarch64|arm64) T="$SERVER/install/tmux-linux-arm64";;
  esac; fi
  if [ -n "$T" ] && curl -fsSL "$T" -o "$RS/bin/tmux" 2>/dev/null && [ -s "$RS/bin/tmux" ]; then
    chmod +x "$RS/bin/tmux"; echo "  tmux ready."
  else
    echo "(couldn't auto-provision tmux on this OS/arch — if launches fail, install tmux manually)"
  fi
fi

# Reverse SSH relay is OPT-IN (only for NAT'd hosts with no inbound SSH). The marker gates
# the agent's tunnel loop; without it the agent never touches the relay.
if [ -n "$RELAY" ]; then touch "$RS/tunnel.enabled"; echo "reverse relay enabled (NAT'd host)"; else rm -f "$RS/tunnel.enabled" 2>/dev/null || true; fi

echo "Downloading redstone..."
curl -fsSL "$SERVER/install/redstone.js?t=$(date +%s)" -o "$RS/redstone.js"

# Env file: sourced by the wrapper AND by every launched session so the private
# Node/npm/tmux/claude are on PATH regardless of login vs non-login shells. \$PATH stays
# literal (expanded when the file is sourced); the ~/.redstone path is baked in absolute.
printf 'export PATH="%s/node/bin:%s/npm/bin:%s/bin:\$HOME/.local/bin:\$PATH"\\nexport NPM_CONFIG_PREFIX="%s/npm"\\n' "$RS" "$RS" "$RS" "$RS" > "$RS/env"

cat > "$HOME/.local/bin/redstone" <<'WRAPPER'
#!/bin/sh
[ -f "$HOME/.redstone/env" ] && . "$HOME/.redstone/env"
exec node "$HOME/.redstone/redstone.js" "$@"
WRAPPER
chmod +x "$HOME/.local/bin/redstone"
export PATH="$HOME/.local/bin:$PATH"

redstone init --server "$SERVER" --token "$TOKEN"

# --- Ensure Claude Code (userspace; installs into the private npm prefix) ---
if ! command -v claude >/dev/null 2>&1; then
  echo "Installing Claude Code (no sudo)..."
  npm install -g @anthropic-ai/claude-code >/dev/null 2>&1 && echo "  Claude Code ready." || echo "(couldn't auto-install Claude Code — run 'npm i -g @anthropic-ai/claude-code' on the host)"
fi

# Install + start the background agent as a boot-persistent service (systemd on Linux,
# launchd on macOS) so this host reports sessions/telemetry and serves remote commands
# across reboots. Best-effort.
redstone service install || echo "(agent service not installed automatically — run 'redstone service install' to enable telemetry + remote control)"

# Make the private toolchain available in the user's INTERACTIVE shells too (idempotent), so
# 'redstone', 'claude' and 'node' just work when they SSH in — otherwise they live only under
# ~/.redstone + ~/.local/bin and a fresh shell can't find them ("looks not installed"). This
# only edits the user's own shell rc (no sudo, no system files).
for rc in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do
  [ -f "$rc" ] || continue
  grep -qs "redstone/env" "$rc" || printf '\\n# redstone toolchain (node/tmux/claude, no sudo)\\n[ -f "$HOME/.redstone/env" ] && . "$HOME/.redstone/env"\\n' >> "$rc"
done
grep -qs "redstone/env" "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile" 2>/dev/null || printf '\\n# redstone toolchain (node/tmux/claude, no sudo)\\n[ -f "$HOME/.redstone/env" ] && . "$HOME/.redstone/env"\\n' >> "$HOME/.profile"

echo ""
echo "redstone installed with a private Node/tmux/Claude under ~/.redstone — no system changes, no sudo."
echo "Open a NEW shell (or run: . ~/.redstone/env) so 'redstone', 'claude' and 'node' are on your PATH."
echo "The background agent is running (telemetry + remote control). Manage it with: redstone service uninstall"
echo "Next: cd <your project> && redstone hook && claude --resume"
# Final marker the installer client watches for: the background agent inherits this SSH
# channel's fds and can keep it open past this point, so the app resolves on this line
# rather than waiting for the connection to close (which may never happen).
echo "RCW_INSTALL_DONE"
`;
