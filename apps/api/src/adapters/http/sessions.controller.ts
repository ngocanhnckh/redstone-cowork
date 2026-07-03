import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Query, Res, UseGuards } from "@nestjs/common";
import { BadRequestException } from "@nestjs/common";
import type { Response } from "express";
import { z, ZodError } from "zod";
import { SessionsService } from "../../application/sessions.service";
import { DecisionsService } from "../../application/decisions.service";
import { SshResultStore } from "../../application/ssh-result-store";
import { EventsBus } from "../../application/events-bus";
import { InstanceTokenGuard } from "./instance-token.guard";

@Controller("sessions")
@UseGuards(InstanceTokenGuard)
export class SessionsController {
  constructor(
    private readonly sessions: SessionsService,
    private readonly decisions: DecisionsService,
    private readonly sshResults: SshResultStore,
    private readonly bus: EventsBus,
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
    // The running poller long-polls this every ~25s while its tmux lives — treat
    // that as a heartbeat so an idle-but-live session (Claude blocked on the user,
    // firing no hooks) stays fresh. Works for any bundle version; a killed session
    // stops polling and goes stale/lost on its own.
    await this.sessions.touch(session.id);
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

  @Post(":id/interrupt")
  @HttpCode(201)
  async interrupt(@Param("id") id: string, @Body() body: unknown) {
    try {
      return await this.decisions.interrupt(id, body ?? {});
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

  // Ask this session's host agent to install a desktop SSH public key into its
  // remote ~/.ssh/authorized_keys (passwordless onboarding). The agent's poller
  // performs the install and reports back via POST :id/ssh-result.
  @Post(":id/ssh-authorize")
  @HttpCode(200)
  async sshAuthorize(@Param("id") id: string, @Body() body: unknown) {
    try {
      const { publicKey } = z.object({ publicKey: z.string().min(1) }).parse(body);
      return await this.decisions.authorizeSsh(id, publicKey);
    } catch (e) {
      if (e instanceof ZodError) throw new BadRequestException(e.issues);
      throw e;
    }
  }

  @Post(":id/ssh-result")
  @HttpCode(200)
  async sshResult(@Param("id") id: string, @Body() body: unknown) {
    try {
      const result = z
        .object({
          ok: z.boolean(),
          user: z.string().optional(),
          address: z.string().nullable().optional(),
          port: z.number().optional(),
          error: z.string().optional(),
        })
        .parse(body);
      this.sshResults.set(id, { ...result, at: new Date().toISOString() });
      this.bus.emit({ type: "session.updated", payload: { id } });
      return { ok: true };
    } catch (e) {
      if (e instanceof ZodError) throw new BadRequestException(e.issues);
      throw e;
    }
  }

  @Get(":id/ssh-result")
  async getSshResult(@Param("id") id: string) {
    return this.sshResults.get(id);
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

  @Post(":id/dismiss")
  @HttpCode(200)
  async dismiss(@Param("id") id: string) {
    if (!(await this.sessions.dismiss(id))) throw new NotFoundException();
    return { ok: true };
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

  @Post(":id/user-todos")
  @HttpCode(201)
  async addUserTodo(@Param("id") id: string, @Body() body: unknown) {
    try {
      const { text } = z.object({ text: z.string().min(1) }).parse(body);
      const updated = await this.sessions.addUserTodo(id, text);
      if (!updated) throw new NotFoundException();
      return updated;
    } catch (e) {
      if (e instanceof ZodError) throw new BadRequestException(e.issues);
      throw e;
    }
  }

  @Post(":id/user-todos/:todoId/toggle")
  @HttpCode(200)
  async toggleUserTodo(@Param("id") id: string, @Param("todoId") todoId: string) {
    const updated = await this.sessions.toggleUserTodo(id, todoId);
    if (!updated) throw new NotFoundException();
    return updated;
  }

  @Post(":id/user-todos/:todoId/delete")
  @HttpCode(200)
  async deleteUserTodo(@Param("id") id: string, @Param("todoId") todoId: string) {
    const updated = await this.sessions.deleteUserTodo(id, todoId);
    if (!updated) throw new NotFoundException();
    return updated;
  }

  @Post(":id/tags")
  @HttpCode(201)
  async addTag(@Param("id") id: string, @Body() body: unknown) {
    try {
      const { tag } = z.object({ tag: z.string().min(1) }).parse(body);
      const updated = await this.sessions.addTag(id, tag);
      if (!updated) throw new NotFoundException();
      return updated;
    } catch (e) {
      if (e instanceof ZodError) throw new BadRequestException(e.issues);
      throw e;
    }
  }

  @Post(":id/tags/remove")
  @HttpCode(200)
  async removeTag(@Param("id") id: string, @Body() body: unknown) {
    try {
      const { tag } = z.object({ tag: z.string().min(1) }).parse(body);
      const updated = await this.sessions.removeTag(id, tag);
      if (!updated) throw new NotFoundException();
      return updated;
    } catch (e) {
      if (e instanceof ZodError) throw new BadRequestException(e.issues);
      throw e;
    }
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
