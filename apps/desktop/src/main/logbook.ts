import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

// A lightweight rolling debug log for the "Report a problem" button. Tees console.error/warn and
// catches uncaught errors into userData/logs/redstone-debug.log, size-capped so it self-trims.
// Best-effort — logging must never crash the app.

const MAX_BYTES = 1_000_000; // ~1MB cap; trimmed to the last half on overflow
let logPath = "";

function ensure(): string {
  if (logPath) return logPath;
  try {
    const dir = path.join(app.getPath("userData"), "logs");
    fs.mkdirSync(dir, { recursive: true });
    logPath = path.join(dir, "redstone-debug.log");
  } catch { /* ignore */ }
  return logPath;
}

function append(level: string, args: unknown[]): void {
  try {
    const p = ensure(); if (!p) return;
    const line = `${new Date().toISOString()} [${level}] ${args.map(fmt).join(" ")}\n`;
    fs.appendFileSync(p, line);
    // Trim if it grew past the cap (keep the most recent half).
    const size = fs.statSync(p).size;
    if (size > MAX_BYTES) {
      const buf = fs.readFileSync(p);
      fs.writeFileSync(p, buf.subarray(buf.length - Math.floor(MAX_BYTES / 2)));
    }
  } catch { /* never throw from logging */ }
}
const fmt = (v: unknown): string => {
  if (typeof v === "string") return v;
  if (v instanceof Error) return `${v.name}: ${v.message}\n${v.stack ?? ""}`;
  try { return JSON.stringify(v); } catch { return String(v); }
};

/** Install the tees + uncaught handlers. Call once at startup. */
export function initLogbook(): void {
  const origErr = console.error.bind(console);
  const origWarn = console.warn.bind(console);
  console.error = (...a: unknown[]) => { append("error", a); origErr(...a); };
  console.warn = (...a: unknown[]) => { append("warn", a); origWarn(...a); };
  process.on("uncaughtException", (e) => append("uncaught", [e]));
  process.on("unhandledRejection", (e) => append("unhandledRejection", [e]));
  append("info", [`--- session start · v${app.getVersion()} · ${process.platform} ${process.arch} ---`]);
}

/** Append an explicit entry (e.g. a renderer-reported error). */
export function logEntry(level: string, message: string): void { append(level, [message]); }

/** The tail of the debug log (default ~200KB), for a bug report. */
export function recentLog(maxBytes = 200_000): string {
  try {
    const p = ensure(); if (!p || !fs.existsSync(p)) return "(no log captured)";
    const buf = fs.readFileSync(p);
    return buf.subarray(Math.max(0, buf.length - maxBytes)).toString("utf8");
  } catch { return "(log unavailable)"; }
}
