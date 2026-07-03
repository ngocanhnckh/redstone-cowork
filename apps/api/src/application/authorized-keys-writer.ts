import { Injectable, Logger } from "@nestjs/common";
import { promises as fs } from "node:fs";
import type { CockpitKeyEntry, HostTunnelEntry } from "../domain/tunnels/host-tunnel.port";

/**
 * Rebuilds the whole `authorized_keys` for the relay's `rcwtun` user from every
 * stored agent key + registered cockpit key, with restricted option prefixes that
 * allow ONLY port-forwarding (no shell, no arbitrary forwarding):
 *  - agent:   restrict,port-forwarding,permitlisten="localhost:<port>" <key> agent:<hostId>
 *  - cockpit: restrict,port-forwarding,permitopen="localhost:*" <key> cockpit:<label>
 *
 * Writes atomically (temp file + rename) to RCWTUN_AUTHKEYS_PATH. If that env is
 * unset (local/dev without the bind mount) it logs once and no-ops. NEVER throws —
 * a key-change must not fail the request that triggered it.
 */
@Injectable()
export class AuthorizedKeysWriter {
  private readonly logger = new Logger(AuthorizedKeysWriter.name);
  private warnedUnset = false;

  async rewrite(agents: HostTunnelEntry[], cockpitKeys: CockpitKeyEntry[]): Promise<void> {
    try {
      const path = process.env.RCWTUN_AUTHKEYS_PATH;
      if (!path) {
        if (!this.warnedUnset) {
          this.logger.warn("RCWTUN_AUTHKEYS_PATH unset — skipping authorized_keys write (no relay bind mount)");
          this.warnedUnset = true;
        }
        return;
      }
      const lines = [
        ...agents.map(
          (a) => `restrict,port-forwarding,permitlisten="localhost:${a.tunnelPort}" ${a.agentPubkey} agent:${a.hostId}`,
        ),
        ...cockpitKeys.map((c) => `restrict,port-forwarding,permitopen="localhost:*" ${c.pubkey} cockpit:${c.label}`),
      ];
      const text = lines.length ? lines.join("\n") + "\n" : "";
      const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
      await fs.writeFile(tmp, text, { mode: 0o600 });
      await fs.rename(tmp, path);
    } catch (e) {
      this.logger.error(`authorized_keys write failed: ${(e as Error).message}`);
    }
  }
}
