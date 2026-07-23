// Requests macOS Calendar access from WITHIN the app process (via the native
// node-mac-permissions addon) so the TCC prompt — and the entry in System Settings ›
// Privacy › Calendars — is attributed to "Redstone Cowork" itself, not to the
// Apple-signed /usr/bin/osascript we use to READ events. The Info.plist carries the
// required NSCalendarsUsageDescription / NSCalendarsFullAccessUsageDescription strings
// (see electron-builder.yml extendInfo). macOS shows the prompt at most once, when the
// status is "not determined"; after that this is a no-op.

// node-mac-permissions is os:["darwin"], so it's simply absent on Windows/Linux — the
// guarded require degrades to a no-op there. Loaded lazily/defensively: a native-module
// load failure must never crash startup.
type MacPermissions = {
  getAuthStatus(type: "calendar"): string;
  askForCalendarAccess(accessType?: "write-only" | "full"): Promise<string>;
};

let mod: MacPermissions | null | undefined;
function load(): MacPermissions | null {
  if (mod !== undefined) return mod;
  if (process.platform !== "darwin") return (mod = null);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require("node-mac-permissions") as MacPermissions;
  } catch {
    mod = null; // addon missing/unbuildable — fall back to no-op (osascript still reads events)
  }
  return mod;
}

/** Current calendar authorization for THIS app: "authorized" | "denied" | "restricted" |
 *  "not determined" | "unavailable" (module absent). Never throws. */
export function calendarAuthStatus(): string {
  const m = load();
  if (!m) return "unavailable";
  try {
    return m.getAuthStatus("calendar");
  } catch {
    return "unavailable";
  }
}

/** Trigger the macOS Calendar permission prompt for this app if the status is still
 *  undecided. Resolves to the resulting status (or "unavailable"). Best-effort; the
 *  prompt only appears when status is "not determined". Never throws. */
export async function requestCalendarPermission(): Promise<string> {
  const m = load();
  if (!m) return "unavailable";
  try {
    const status = m.getAuthStatus("calendar");
    if (status !== "not determined") return status; // already decided — macOS won't re-prompt
    return await m.askForCalendarAccess("full");
  } catch {
    return "unavailable";
  }
}
