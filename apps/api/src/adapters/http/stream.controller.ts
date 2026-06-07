import { Controller, Get, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { EventsBus } from "../../application/events-bus";
import { InstanceTokenGuard } from "./instance-token.guard";

@Controller()
export class StreamController {
  constructor(private readonly bus: EventsBus) {}

  @UseGuards(InstanceTokenGuard)
  @Get("stream")
  stream(@Res() res: Response) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Connection": "keep-alive",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "X-Accel-Buffering": "no",
    });
    (res as unknown as { flushHeaders?: () => void }).flushHeaders?.();

    const sendEvent = (data: unknown) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const sub = this.bus.stream$.subscribe({
      next: (e) => sendEvent(e),
      error: () => res.end(),
      complete: () => res.end(),
    });

    res.on("close", () => sub.unsubscribe());
  }
}
