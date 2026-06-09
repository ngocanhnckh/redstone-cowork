import { BadRequestException, Body, Controller, Get, HttpCode, Post, UseGuards } from "@nestjs/common";
import { ZodError } from "zod";
import { z } from "zod";
import { PushService } from "../../application/push.service";
import { InstanceTokenGuard } from "./instance-token.guard";

@Controller("push")
@UseGuards(InstanceTokenGuard)
export class PushController {
  constructor(private readonly push: PushService) {}

  @Get("vapid")
  vapid() {
    return { publicKey: this.push.vapidPublicKey() };
  }

  @Post("subscriptions")
  @HttpCode(201)
  async subscribe(@Body() body: unknown) {
    try {
      const stored = await this.push.register(body);
      return { id: stored.id };
    } catch (e) {
      if (e instanceof ZodError) throw new BadRequestException(e.issues);
      throw e;
    }
  }

  @Post("subscriptions/remove")
  @HttpCode(200)
  async unsubscribe(@Body() body: unknown) {
    const { endpoint } = z.object({ endpoint: z.string().min(1) }).parse(body);
    await this.push.remove(endpoint);
    return { ok: true };
  }
}
