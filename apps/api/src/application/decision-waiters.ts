import { Injectable } from "@nestjs/common";
import { EventEmitter } from "node:events";
import type { Decision } from "@rcw/shared";

/** In-process wakeup channel for long-polling /decisions/:id/await (single API instance by design). */
@Injectable()
export class DecisionWaiters {
  private readonly emitter = new EventEmitter().setMaxListeners(1000);

  notify(decision: Decision) { this.emitter.emit(decision.id, decision); }

  wait(id: string, ms: number): Promise<Decision | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.emitter.off(id, onResolved); resolve(null); }, ms);
      const onResolved = (d: Decision) => { clearTimeout(timer); resolve(d); };
      this.emitter.once(id, onResolved);
    });
  }
}
