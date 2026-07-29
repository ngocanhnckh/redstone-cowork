import * as api from "../api";
import { cloudProvider } from "./cloud-provider";
import type { ProviderMode, SessionProvider } from "./provider";

export type { ProviderEvent, ProviderMode, Resolution, SessionProvider } from "./provider";

// ---------------------------------------------------------------------------
// Provider resolution.
//
// Today there is exactly one implementation, so this always returns the cloud
// provider and behaviour is identical to before the seam existed. The direct
// (SSH) provider registers itself here in a later phase; keeping the resolution
// point in place now means the boot path in index.ts only has to be rewired once.
// ---------------------------------------------------------------------------

let directProvider: SessionProvider | null = null;

/** Called by the direct engine once it's built. Until then, resolution is cloud-only. */
export function registerDirectProvider(p: SessionProvider): void {
  directProvider = p;
}

/** Explicit user choice, when they've made one. Persisted by mode.ts in a later phase. */
let preferred: ProviderMode | null = null;
export function setPreferredMode(m: ProviderMode | null): void {
  preferred = m;
}

/**
 * The provider to use right now.
 *
 * Order: an explicit user choice wins; otherwise a configured cowork server means
 * cloud (the status quo — an existing install must never silently change backend);
 * otherwise direct, if it's available.
 *
 * Falling back to cloud when direct hasn't registered keeps the hosted path the
 * safe default: worst case you get "not configured", never a silently dead cockpit.
 */
export function getProvider(): SessionProvider {
  if (preferred === "direct" && directProvider) return directProvider;
  if (preferred === "cloud") return cloudProvider;
  if (api.isConfigured()) return cloudProvider;
  return directProvider ?? cloudProvider;
}

/** True when the active backend is the agent-free SSH engine. */
export function isDirect(): boolean {
  return getProvider().mode === "direct";
}

/**
 * Whether cowork-server-backed features (accounts, scoring, agency, jira, servers)
 * can work at all. Those never move local, so callers gate on this rather than on
 * the provider mode.
 */
export function hasCloud(): boolean {
  return api.isConfigured();
}
