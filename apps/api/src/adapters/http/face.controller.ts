import { BadRequestException, Body, Controller, ForbiddenException, HttpCode, NotFoundException, Param, Post, Req, UnauthorizedException, UseGuards } from "@nestjs/common";
import { ZodError } from "zod";
import { FaceDescriptorSchema, FaceEnrollSchema, FaceLoginSchema } from "@rcw/shared";
import { FaceError, FaceService } from "../../application/face.service";
import { AccountsService } from "../../application/accounts.service";
import { clientIp } from "./auth.controller";
import { InstanceTokenGuard, isAdminScope, type GuardedRequest } from "./instance-token.guard";
import type { Request } from "express";

/** Face sign-in is public (it IS a login). Enrollment is guarded. */
@Controller("auth/face")
export class FaceLoginController {
  constructor(private readonly face: FaceService) {}

  @Post("login")
  @HttpCode(200)
  async login(@Body() body: unknown, @Req() req: Request) {
    try {
      const { deviceSecret, descriptor } = FaceLoginSchema.parse(body);
      return await this.face.login(deviceSecret, descriptor, {
        ip: clientIp(req),
        device: String(req.headers["user-agent"] ?? ""),
      });
    } catch (e) {
      if (e instanceof FaceError) throw new UnauthorizedException({ error: "face_" + e.reason });
      if (e instanceof ZodError) throw new BadRequestException(e.issues);
      throw e;
    }
  }
}

/** Guarded enrollment: the signed-in agent opts into face unlock on this device; admins
 *  pre-enroll a descriptor computed from a roster photo. */
@Controller("accounts")
@UseGuards(InstanceTokenGuard)
export class FaceEnrollController {
  constructor(private readonly face: FaceService, private readonly accounts: AccountsService) {}

  /** The current agent enrolls their face on this device → returns a one-time device secret. */
  @Post("me/face/enroll")
  @HttpCode(200)
  async enroll(@Req() req: GuardedRequest, @Body() body: unknown) {
    if (req.authKind !== "account" || !req.account) throw new ForbiddenException("sign in as an agent first");
    try {
      const { descriptor, deviceLabel } = FaceEnrollSchema.parse(body);
      return await this.face.enroll(req.account, descriptor, deviceLabel ?? "");
    } catch (e) {
      if (e instanceof ZodError) throw new BadRequestException(e.issues);
      throw e;
    }
  }

  /** Admin pre-enrollment: store a descriptor computed from the agent's roster photo. */
  @Post(":id/face")
  @HttpCode(200)
  async adminEnroll(@Req() req: GuardedRequest, @Param("id") id: string, @Body() body: unknown) {
    if (!isAdminScope(req)) throw new ForbiddenException("admin only");
    try {
      const descriptor = FaceDescriptorSchema.parse((body as { descriptor?: unknown })?.descriptor);
      if (!(await this.accounts.list()).some((a) => a.id === id)) throw new NotFoundException();
      await this.face.enrollDescriptor(id, descriptor);
      return { ok: true };
    } catch (e) {
      if (e instanceof ZodError) throw new BadRequestException(e.issues);
      throw e;
    }
  }
}
