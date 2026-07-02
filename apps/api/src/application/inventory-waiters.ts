import { Injectable } from "@nestjs/common";
import { EventEmitter } from "node:events";

/**
 * Two long-poll channels for the inventory command queue:
 *  - `command:<hostId>` — a new command is available for that host (host agent waits).
 *  - `result:<commandId>` — a command's result has arrived (the enqueuing request waits).
 */
@Injectable()
export class InventoryWaiters {
  private readonly emitter = new EventEmitter().setMaxListeners(1000);

  notifyHost(hostId: string) { this.emitter.emit(`command:${hostId}`); }
  notifyResult(commandId: string) { this.emitter.emit(`result:${commandId}`); }

  private wait(key: string, ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.emitter.off(key, on); resolve(false); }, ms);
      const on = () => { clearTimeout(timer); resolve(true); };
      this.emitter.once(key, on);
    });
  }
  waitForCommand(hostId: string, ms: number): Promise<boolean> { return this.wait(`command:${hostId}`, ms); }
  waitForResult(commandId: string, ms: number): Promise<boolean> { return this.wait(`result:${commandId}`, ms); }
}
