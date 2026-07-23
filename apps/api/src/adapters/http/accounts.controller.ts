import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { BadRequestException } from "@nestjs/common";
import { ZodError } from "zod";
import { AccountProfilePatchSchema, NewAccountSchema } from "@rcw/shared";
import { AccountsService } from "../../application/accounts.service";
import { InstanceTokenGuard, isAdminScope, type GuardedRequest } from "./instance-token.guard";

/** Admin = the instance token (the installation itself) or an admin-role account.
 *  Member accounts get exactly two reads here: who am I, and my own audit trail. */
function requireAdmin(req: GuardedRequest): void {
  if (!isAdminScope(req)) throw new ForbiddenException("admin only");
}

@Controller("accounts")
@UseGuards(InstanceTokenGuard)
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get("me")
  me(@Req() req: GuardedRequest) {
    if (req.authKind === "account" && req.account) return req.account;
    // Instance-token (or other privileged) callers aren't a person; say so explicitly.
    return { id: null, role: "admin", username: null, kind: req.authKind };
  }

  @Get()
  async list(@Req() req: GuardedRequest) {
    requireAdmin(req);
    return this.accounts.list();
  }

  @Post()
  async create(@Req() req: GuardedRequest, @Body() body: unknown) {
    requireAdmin(req);
    try {
      return await this.accounts.create(NewAccountSchema.parse(body));
    } catch (e) {
      if (e instanceof ZodError) throw new BadRequestException(e.issues);
      if (e instanceof Error && /exists|unique|duplicate/i.test(e.message)) {
        throw new BadRequestException("username already exists");
      }
      throw e;
    }
  }

  /** Admin: edit an agent's profile (name, photo, level, division, contacts, webhook, role). */
  @Post(":id/profile")
  @HttpCode(200)
  async updateProfile(@Req() req: GuardedRequest, @Param("id") id: string, @Body() body: unknown) {
    requireAdmin(req);
    try {
      const updated = await this.accounts.updateProfile(id, AccountProfilePatchSchema.parse(body));
      if (!updated) throw new NotFoundException();
      return updated;
    } catch (e) {
      if (e instanceof ZodError) throw new BadRequestException(e.issues);
      throw e;
    }
  }

  @Post(":id/disable")
  @HttpCode(200)
  async disable(@Req() req: GuardedRequest, @Param("id") id: string) {
    requireAdmin(req);
    if (!(await this.accounts.setDisabled(id, true))) throw new NotFoundException();
    return { ok: true };
  }

  @Post(":id/enable")
  @HttpCode(200)
  async enable(@Req() req: GuardedRequest, @Param("id") id: string) {
    requireAdmin(req);
    if (!(await this.accounts.setDisabled(id, false))) throw new NotFoundException();
    return { ok: true };
  }

  /** Sign-in audit trail. Admin: whole org (optionally ?accountId=). Member: self only. */
  @Get("audit/logins")
  async audit(@Req() req: GuardedRequest, @Query("accountId") accountId?: string, @Query("limit") limit?: string) {
    const n = Math.max(1, Math.min(Number(limit) || 200, 1000));
    if (!isAdminScope(req)) {
      return this.accounts.loginAudit({ accountId: req.account!.id, limit: n });
    }
    return this.accounts.loginAudit({ accountId: accountId || undefined, limit: n });
  }

  @Post("logout")
  @HttpCode(200)
  async logout(@Req() req: GuardedRequest) {
    const header = req.headers["authorization"] ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (token.startsWith("rcwa_")) await this.accounts.logout(token);
    return { ok: true };
  }
}
