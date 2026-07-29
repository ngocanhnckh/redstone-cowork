import { DirectProvider } from "./direct-provider";
import { enabledHosts } from "./host-book";
import { registerDirectProvider } from "../providers";

// Wire the direct backend into provider resolution. Kept in its own module so
// main/index.ts imports one thing and the engine's internals stay private.

let provider: DirectProvider | null = null;

/** The direct provider, created on first use. */
export function directProvider(): DirectProvider {
  if (!provider) {
    provider = new DirectProvider();
    registerDirectProvider(provider);
  }
  return provider;
}

/**
 * Whether direct mode has anything to talk to. The local machine is always in the
 * host book, so this is effectively "is the engine usable" — true even with no SSH
 * hosts configured and no cowork account, which is the point.
 */
export function directAvailable(): boolean {
  return enabledHosts().length > 0;
}

export { listHosts, addHost, removeHost, setEnabled, LOCAL_HOST_ID } from "./host-book";
export type { HostEntry } from "./host-book";
