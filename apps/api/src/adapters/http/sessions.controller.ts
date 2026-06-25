import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Query, Res, UseGuards } from "@nestjs/common";
import { BadRequestException } from "@nestjs/common";
import type { Response } from "express";
import { z, ZodError } from "zod";
import { SessionsService } from "../../application/sessions.service";
import { DecisionsService } from "../../application/decisions.service";
import { InstanceTokenGuard } from "./instance-token.guard";

@Controller("sessions")
@UseGuards(InstanceTokenGuard)
export class SessionsController {
  constructor(
    private readonly sessions: SessionsService,
    private readonly decisions: DecisionsService,
  ) {}

  @Post()
  async attach(@Body() body: unknown) {
    try {
      return await this.sessions.attach(body);
    } catch (e) {
      if (e instanceof ZodError) throw new BadRequestException(e.issues);
      throw e;
    }
  }

  // NOTE: static segments (queue, by-wrapper) must be declared BEFORE :id routes
  @Get("queue")
  async queue() {
    const [pending, oldest] = await Promise.all([
      this.decisions.countPendingBySession(),
      this.decisions.oldestPendingAtBySession(),
    ]);
    return this.sessions.queue(pending, oldest);
  }

  @Get("by-wrapper/:wrapperId")
  async getByWrapper(@Param("wrapperId") wrapperId: string) {
    const session = await this.sessions.getByWrapper(wrapperId);
    if (!session) throw new NotFoundException();
    return session;
  }

  @Get("by-wrapper/:wrapperId/deliveries")
  async deliveriesByWrapper(
    @Param("wrapperId") wrapperId: string,
    @Query("timeoutMs") timeoutMs = "25000",
    @Res() res: Response,
  ) {
    const session = await this.sessions.getByWrapper(wrapperId);
    if (!session) throw new NotFoundException();
    const items = await this.decisions.deliveries(session.id, Number(timeoutMs) || 25_000);
    if (items.length === 0) return res.status(204).send();
    return res.status(200).json(items);
  }

  @Post(":id/heartbeat")
  @HttpCode(200)
  async heartbeat(@Param("id") id: string) {
    if (!(await this.sessions.heartbeat(id))) throw new NotFoundException();
    return { ok: true };
  }

  @Post(":id/instruct")
  @HttpCode(201)
  async instruct(@Param("id") id: string, @Body() body: unknown) {
    try {
      return await this.decisions.instruct(id, body);
    } catch (e) {
      if (e instanceof ZodError) throw new BadRequestException(e.issues);
      throw e;
    }
  }

  @Post(":id/resolve-local")
  @HttpCode(200)
  async resolveLocal(@Param("id") id: string) {
    const resolved = await this.decisions.resolveLocal(id);
    return { resolved };
  }

  @Post(":id/mode")
  @HttpCode(200)
  async switchMode(@Param("id") id: string, @Body() body: unknown) {
    try {
      const { mode } = z.object({ mode: z.string().min(1) }).parse(body);
      return await this.decisions.switchMode(id, mode);
    } catch (e) {
      if (e instanceof ZodError) throw new BadRequestException(e.issues);
      throw e;
    }
  }

  @Post(":id/state")
  @HttpCode(201)
  async patchState(@Param("id") id: string, @Body() body: unknown) {
    try {
      const updated = await this.sessions.patchState(id, body);
      if (!updated) throw new NotFoundException();
      return updated;
    } catch (e) {
      if (e instanceof ZodError) throw new BadRequestException(e.issues);
      throw e;
    }
  }

  @Post(":id/snooze")
  @HttpCode(200)
  async snooze(@Param("id") id: string, @Body() body: unknown) {
    const { minutes } = z.object({ minutes: z.number().nonnegative() }).parse(body);
    if (!(await this.sessions.get(id))) throw new NotFoundException();
    await this.sessions.snooze(id, minutes);
    return { ok: true };
  }

  @Post(":id/pin")
  @HttpCode(200)
  async pin(@Param("id") id: string, @Body() body: unknown) {
    const { pinned } = z.object({ pinned: z.boolean() }).parse(body);
    if (!(await this.sessions.get(id))) throw new NotFoundException();
    await this.sessions.pin(id, pinned);
    return { ok: true };
  }

  @Get()
  async list() {
    const [pending, oldest] = await Promise.all([
      this.decisions.countPendingBySession(),
      this.decisions.oldestPendingAtBySession(),
    ]);
    return this.sessions.listViews(pending, oldest);
  }
}
