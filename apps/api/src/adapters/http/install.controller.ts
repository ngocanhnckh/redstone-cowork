import { Controller, Get, Header, Res } from "@nestjs/common";
import type { Response } from "express";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const bundlePath = () => process.env.REDSTONE_BUNDLE_PATH ?? join(process.cwd(), "redstone.bundle.js");

@Controller()
export class InstallController {
  @Get("install.sh")
  @Header("Content-Type", "text/plain; charset=utf-8")
  installScript(): string {
    return INSTALL_SH;
  }

  @Get("install/redstone.js")
  bundle(@Res() res: Response) {
    const p = bundlePath();
    if (!existsSync(p)) return res.status(503).send("bundle unavailable");
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    return res.send(readFileSync(p, "utf8"));
  }
}

const INSTALL_SH = `#!/usr/bin/env bash
set -euo pipefail
SERVER=""; TOKEN=""
while [ $# -gt 0 ]; do case "$1" in
  --server) SERVER="$2"; shift 2;;
  --token) TOKEN="$2"; shift 2;;
  *) echo "unknown arg: $1" >&2; exit 1;; esac; done
[ -n "$SERVER" ] && [ -n "$TOKEN" ] || { echo "usage: install.sh --server <url> --token <token>" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "Node.js is required (>= 20). Install it then re-run." >&2; exit 1; }
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || { echo "Node >= 20 required (found $(node -v))." >&2; exit 1; }
mkdir -p "$HOME/.redstone" "$HOME/.local/bin"
echo "Downloading redstone..."
curl -fsSL "$SERVER/install/redstone.js" -o "$HOME/.redstone/redstone.js"
cat > "$HOME/.local/bin/redstone" <<'WRAPPER'
#!/bin/sh
exec node "$HOME/.redstone/redstone.js" "$@"
WRAPPER
chmod +x "$HOME/.local/bin/redstone"
export PATH="$HOME/.local/bin:$PATH"
redstone init --server "$SERVER" --token "$TOKEN"
echo ""
echo "redstone installed. If 'redstone' is not found, add to your shell: export PATH=\\"\\$HOME/.local/bin:\\$PATH\\""
echo "Next: cd <your project> && redstone hook && claude --resume"
`;
