/**
 * Settings durability.
 *
 * Every user preference (appearance, HUD layouts, widgets, custom apps, session
 * order, keybindings…) lives in localStorage. localStorage is scoped to the page
 * ORIGIN and stored in a Chromium LevelDB, which gives it two failure modes that
 * both look identical to the user — "all my settings are gone":
 *
 *   1. Origin change. Dev serves from http://localhost:5173, the packaged app
 *      from app://bundle. Those are separate stores; neither can see the other.
 *   2. Unreadable store. LevelDB is single-writer. If another instance holds the
 *      lock, Chromium hands the page an EMPTY localStorage and silently discards
 *      what it writes.
 *
 * So localStorage alone can never be the source of truth. This module mirrors the
 * rcw.* keys to a JSON file in userData (origin-independent, always readable) and
 * restores from it when the store comes up empty. Nothing here deletes anything:
 * restore only fills in keys that are MISSING, so a live profile is never
 * overwritten by a stale snapshot.
 */

const PREFIX = "rcw.";
const SNAPSHOT_MS = 20_000;

/** The rcw.* view of localStorage; other keys are not ours to persist. */
function readLocal(): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(PREFIX)) continue;
    const v = localStorage.getItem(k);
    if (v != null) out[k] = v;
  }
  return out;
}

/**
 * Restore anything the snapshot has that this origin doesn't. Runs before the UI
 * reads its settings, so a first launch on a new origin comes up configured.
 * Returns how many keys were recovered (0 on a healthy profile).
 */
export async function restoreSettings(): Promise<number> {
  try {
    const snap = await window.cowork.settingsSnapshotRead();
    if (!snap) return 0;
    let restored = 0;
    for (const [k, v] of Object.entries(snap)) {
      if (!k.startsWith(PREFIX)) continue;
      if (localStorage.getItem(k) !== null) continue; // never clobber live values
      try { localStorage.setItem(k, v); restored++; } catch { /* quota — skip */ }
    }
    if (restored > 0) console.info(`[settings] recovered ${restored} key(s) from snapshot`);
    return restored;
  } catch {
    return 0; // a missing snapshot is normal, not an error
  }
}

/**
 * Keep the snapshot current. Writes only when the rcw.* set actually changed, and
 * once more on unload so the last edit before quitting is never lost.
 *
 * Guard: if localStorage reads empty we do NOT overwrite a good snapshot with
 * nothing — an unreadable store must not destroy the backup that would fix it.
 */
export function startSettingsSnapshot(): () => void {
  let last = "";
  const push = () => {
    const keys = readLocal();
    if (Object.keys(keys).length === 0) return;
    const json = JSON.stringify(keys);
    if (json === last) return;
    last = json;
    window.cowork.settingsSnapshotWrite(keys).catch(() => { /* best-effort */ });
  };
  push();
  const timer = setInterval(push, SNAPSHOT_MS);
  addEventListener("beforeunload", push);
  return () => { clearInterval(timer); removeEventListener("beforeunload", push); };
}
