import { Injectable } from "@nestjs/common";

/**
 * Result the host agent reports after attempting to install the desktop's SSH
 * public key. `address`/`port`/`user` describe how to reach the box; `ok=false`
 * carries an `error` instead.
 */
export type SshResult = {
  ok: boolean;
  user?: string;
  address?: string | null;
  port?: number;
  error?: string;
  at: string;
};

/**
 * Transient, in-memory store of the latest ssh-authorize result per session.
 * Single API instance, short-lived hand-off (desktop polls right after asking),
 * so persistence is unnecessary — a process restart simply drops stale results.
 */
@Injectable()
export class SshResultStore {
  private readonly results = new Map<string, SshResult>();

  set(sessionId: string, result: SshResult): void {
    this.results.set(sessionId, result);
  }

  get(sessionId: string): SshResult | null {
    return this.results.get(sessionId) ?? null;
  }
}
