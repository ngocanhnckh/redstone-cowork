import { Injectable } from "@nestjs/common";
import { EventEmitter } from "node:events";

@Injectable()
export class DeliveryWaiters {
  private readonly emitter = new EventEmitter().setMaxListeners(1000);
  notify(sessionId: string) { this.emitter.emit(sessionId); }
  wait(sessionId: string, ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.emitter.off(sessionId, on); resolve(false); }, ms);
      const on = () => { clearTimeout(timer); resolve(true); };
      this.emitter.once(sessionId, on);
    });
  }
}
