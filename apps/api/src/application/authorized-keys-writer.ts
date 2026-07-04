import { Injectable, Logger } from "@nestjs/common";
import { promises as fs } from "node:fs";
import { dirname } from "node:path";
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
      // CRITICAL: sshd's StrictModes silently IGNORES an authorized_keys owned by
      // root (this container runs as root), so every relay key would be rejected.
      // The file must be owned by the broker user. We can't know rcwtun's uid from
      // inside the container, so match the owner of the mounted .ssh dir (which
      // setup-relay.sh created as rcwtun). Best-effort — never fail the request.
      try {
        const st = await fs.stat(dirname(path));
        await fs.chown(path, st.uid, st.gid);
      } catch (e) {
        this.logger.warn(`authorized_keys chown to broker user failed: ${(e as Error).message}`);
      }
    } catch (e) {
      this.logger.error(`authorized_keys write failed: ${(e as Error).message}`);
    }
  }
}
