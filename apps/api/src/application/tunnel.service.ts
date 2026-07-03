import { Inject, Injectable } from "@nestjs/common";
import type { TunnelCoordinates } from "@rcw/shared";
import { HOST_TUNNEL_STORE, type HostTunnelStore } from "../domain/tunnels/host-tunnel.port";
import { AuthorizedKeysWriter } from "./authorized-keys-writer";

/**
 * The NAT'd-host SSH relay control plane: assign each agent a stable reverse-tunnel
 * port, hand cockpit clients the coordinates to jump through, and register cockpit
 * jump keys. Any key change re-materializes the relay's authorized_keys.
 */
@Injectable()
export class TunnelService {
  constructor(
    @Inject(HOST_TUNNEL_STORE) private readonly store: HostTunnelStore,
    private readonly authKeys: AuthorizedKeysWriter,
  ) {}

  /** Relay connection details, parameterized by this host's assigned tunnel port. */
  private coords(tunnelPort: number): TunnelCoordinates {
    return {
      relayHost: process.env.RELAY_HOST ?? "",
      relayPort: Number(process.env.RELAY_SSH_PORT ?? 22),
      tunnelUser: process.env.RCWTUN_USER ?? "rcwtun",
      tunnelPort,
    };
  }

  /** Agent provisioning: store its key, (re)assign a port, rewrite keys, return coordinates. */
  async provisionAgent(hostId: string, pubkey: string): Promise<TunnelCoordinates> {
    const entry = await this.store.upsert(hostId, pubkey);
    await this.rewriteAuthorizedKeys();
    return this.coords(entry.tunnelPort);
  }

  /** Cockpit fetch — coordinates for an already-provisioned host, or null. */
  async getCoordinates(hostId: string): Promise<TunnelCoordinates | null> {
    const entry = await this.store.get(hostId);
    return entry ? this.coords(entry.tunnelPort) : null;
  }

  /** Register a cockpit jump key and rewrite authorized_keys. */
  async registerCockpitKey(label: string, pubkey: string): Promise<{ ok: true }> {
    await this.store.addCockpitKey(label, pubkey);
    await this.rewriteAuthorizedKeys();
    return { ok: true };
  }

  private async rewriteAuthorizedKeys(): Promise<void> {
    const [agents, cockpitKeys] = await Promise.all([this.store.list(), this.store.listCockpitKeys()]);
    await this.authKeys.rewrite(agents, cockpitKeys);
  }
}
