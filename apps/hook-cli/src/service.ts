import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

// Install `redstone agent` as a boot-persistent background service so a host keeps
// reporting inventory/telemetry/docker across reboots — no manual tmux needed.
// Linux → systemd user unit; macOS → launchd LaunchAgent. Fully defensive: any
// failure prints guidance and returns a message rather than throwing.

type Ctx = { nodePath: string; scriptPath: string };

const LINUX_UNIT = "redstone-agent.service";
const MAC_LABEL = "com.redstone.agent";

function trySync(cmd: string, args: string[]): { ok: boolean; out: string } {
  try {
    const out = execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"] }).toString();
    return { ok: true, out };
  } catch (e) {
    const err = e as { stderr?: Buffer; message?: string };
    return { ok: false, out: err.stderr?.toString() || err.message || "failed" };
  }
}

function installSystemd({ nodePath, scriptPath }: Ctx): string {
  const dir = join(homedir(), ".config", "systemd", "user");
  mkdirSync(dir, { recursive: true });
  const unit = `[Unit]
Description=Redstone Cowork agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${nodePath} ${scriptPath} agent
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`;
  writeFileSync(join(dir, LINUX_UNIT), unit);
  trySync("systemctl", ["--user", "daemon-reload"]);
  // Survive logout / run at boot without an active login session (best-effort).
  trySync("loginctl", ["enable-linger", process.env.USER || ""]);
  const en = trySync("systemctl", ["--user", "enable", "--now", LINUX_UNIT]);
  if (!en.ok) {
    return `Wrote the systemd unit, but couldn't start it automatically:\n${en.out}\nStart it with:  systemctl --user enable --now ${LINUX_UNIT}`;
  }
  return `redstone agent installed as a systemd user service and started.\n  status: systemctl --user status ${LINUX_UNIT}\n  logs:   journalctl --user -u ${LINUX_UNIT} -f`;
}

function installLaunchd({ nodePath, scriptPath }: Ctx): string {
  const dir = join(homedir(), "Library", "LaunchAgents");
  mkdirSync(dir, { recursive: true });
  const plistPath = join(dir, `${MAC_LABEL}.plist`);
  const log = join(homedir(), ".redstone", "agent.log");
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${MAC_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${scriptPath}</string>
    <string>agent</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${log}</string>
  <key>StandardErrorPath</key><string>${log}</string>
</dict></plist>
`;
  writeFileSync(plistPath, plist);
  trySync("launchctl", ["unload", plistPath]); // ignore if not loaded
  const load = trySync("launchctl", ["load", "-w", plistPath]);
  if (!load.ok) {
    return `Wrote the LaunchAgent, but couldn't load it automatically:\n${load.out}\nLoad it with:  launchctl load -w ${plistPath}`;
  }
  return `redstone agent installed as a launchd LaunchAgent and started.\n  plist: ${plistPath}\n  logs:  tail -f ${log}`;
}

export function installService(ctx: Ctx): string {
  const p = platform();
  if (p === "linux") return installSystemd(ctx);
  if (p === "darwin") return installLaunchd(ctx);
  return `Automatic service install isn't supported on ${p}. Run \`redstone agent\` under your own supervisor (pm2, nssm, a startup script, etc.).`;
}

export function uninstallService(): string {
  const p = platform();
  if (p === "linux") {
    trySync("systemctl", ["--user", "disable", "--now", LINUX_UNIT]);
    try { rmSync(join(homedir(), ".config", "systemd", "user", LINUX_UNIT)); } catch { /* ignore */ }
    trySync("systemctl", ["--user", "daemon-reload"]);
    return "redstone agent service removed.";
  }
  if (p === "darwin") {
    const plistPath = join(homedir(), "Library", "LaunchAgents", `${MAC_LABEL}.plist`);
    trySync("launchctl", ["unload", plistPath]);
    try { rmSync(plistPath); } catch { /* ignore */ }
    return "redstone agent LaunchAgent removed.";
  }
  return `Nothing to uninstall on ${p}.`;
}
