import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post, UseGuards } from "@nestjs/common";
import { BadRequestException } from "@nestjs/common";
import { ZodError } from "zod";
import { SessionsService } from "../../application/sessions.service";
import { InstanceTokenGuard } from "./instance-token.guard";

@Controller("sessions")
@UseGuards(InstanceTokenGuard)
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Post()
  async attach(@Body() body: unknown) {
    try {
      return await this.sessions.attach(body);
    } catch (e) {
      if (e instanceof ZodError) throw new BadRequestException(e.issues);
      throw e;
    }
  }

  @Post(":id/heartbeat")
  @HttpCode(200)
  async heartbeat(@Param("id") id: string) {
    if (!(await this.sessions.heartbeat(id))) throw new NotFoundException();
    return { ok: true };
  }

  @Get()
  list() {
    return this.sessions.listViews({});
  }
}
