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

const INSTALL_SH = `#!/usr/bin/env bash
set -euo pipefail
SERVER=""; TOKEN=""; RELAY=""
while [ $# -gt 0 ]; do case "$1" in
  --server) SERVER="$2"; shift 2;;
  --token) TOKEN="$2"; shift 2;;
  --relay) RELAY="1"; shift;;
  *) echo "unknown arg: $1" >&2; exit 1;; esac; done
[ -n "$SERVER" ] && [ -n "$TOKEN" ] || { echo "usage: install.sh --server <url> --token <token> [--relay]" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "Node.js is required (>= 20). Install it then re-run." >&2; exit 1; }
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || { echo "Node >= 20 required (found $(node -v))." >&2; exit 1; }
mkdir -p "$HOME/.redstone" "$HOME/.local/bin"
# Reverse SSH relay is OPT-IN (only for NAT'd hosts with no inbound SSH). The
# marker gates the agent's tunnel loop; without it the agent never touches the
# relay, so directly-reachable hosts can't trip fail2ban with rcwtun auth.
if [ -n "$RELAY" ]; then touch "$HOME/.redstone/tunnel.enabled"; echo "reverse relay enabled (NAT'd host)"; else rm -f "$HOME/.redstone/tunnel.enabled" 2>/dev/null || true; fi
echo "Downloading redstone..."
curl -fsSL "$SERVER/install/redstone.js?t=$(date +%s)" -o "$HOME/.redstone/redstone.js"
cat > "$HOME/.local/bin/redstone" <<'WRAPPER'
#!/bin/sh
exec node "$HOME/.redstone/redstone.js" "$@"
WRAPPER
chmod +x "$HOME/.local/bin/redstone"
export PATH="$HOME/.local/bin:$PATH"
redstone init --server "$SERVER" --token "$TOKEN"
# Install + start the background agent as a boot-persistent service (systemd on
# Linux, launchd on macOS) so this host reports sessions/telemetry/docker and
# serves remote commands automatically — including across reboots. Best-effort.
redstone service install || echo "(agent service not installed automatically — run 'redstone service install' to enable telemetry + remote control)"
echo ""
echo "redstone installed. If 'redstone' is not found, add to your shell: export PATH=\\"\\$HOME/.local/bin:\\$PATH\\""
echo "The background agent is running (telemetry + remote control). Manage it with: redstone service uninstall"
echo "Next: cd <your project> && redstone hook && claude --resume"
echo "Later: run 'redstone update' anytime to pull the latest agent."
`;
