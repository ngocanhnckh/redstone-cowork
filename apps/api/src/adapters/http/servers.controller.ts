import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ZodError } from "zod";
import { NewServerSchema } from "@rcw/shared";
import { ServersService } from "../../application/servers.service";
import { AccountsService } from "../../application/accounts.service";
import { InstanceTokenGuard, isAdminScope, type GuardedRequest } from "./instance-token.guard";

@Controller("servers")
@UseGuards(InstanceTokenGuard)
export class ServersController {
  constructor(private readonly servers: ServersService, private readonly accounts: AccountsService) {}

  /** Admin sees all servers (with ACL); an agent sees the servers assigned to them + their own. */
  @Get()
  async list(@Req() req: GuardedRequest) {
    if (isAdminScope(req)) return this.servers.listAllWithAccess();
    return this.servers.listForAccount(req.account!.id);
  }

  /** The cowork public key to install on a self-added VPS (null if not configured). */
  @Get("cowork-key")
  coworkKey() {
    return { publicKey: this.servers.coworkPublicKey() };
  }

  /** Admin registers a shared company server; an agent self-adds their own VPS. */
  @Post()
  @HttpCode(201)
  async create(@Req() req: GuardedRequest, @Body() body: unknown) {
    try {
      const input = NewServerSchema.parse(body);
      if (isAdminScope(req) && req.authKind !== "account") {
        return await this.servers.createCompany(input, "");
      }
      if (req.account?.role === "admin") return await this.servers.createCompany(input, req.account.id);
      // members self-add owned VPS
      return await this.servers.createOwned(input, req.account!.id);
    } catch (e) {
      if (e instanceof ZodError) throw new BadRequestException(e.issues);
      throw e;
    }
  }

  @Post(":id")
  @HttpCode(200)
  async update(@Req() req: GuardedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    await this.requireManage(req, id);
    const updated = await this.servers.update(id, {
      name: body.name as string | undefined,
      host: body.host as string | undefined,
      sshUser: body.sshUser as string | undefined,
      sshPort: body.sshPort as number | undefined,
      description: body.description as string | undefined,
      keyInstalled: body.keyInstalled as boolean | undefined,
    });
    if (!updated) throw new NotFoundException();
    return updated;
  }

  @Delete(":id")
  @HttpCode(200)
  async remove(@Req() req: GuardedRequest, @Param("id") id: string) {
    await this.requireManage(req, id);
    if (!(await this.servers.remove(id))) throw new NotFoundException();
    return { ok: true };
  }

  /** Admin grants/revokes an agent's access to a company server. */
  @Post(":id/access")
  @HttpCode(200)
  async grant(@Req() req: GuardedRequest, @Param("id") id: string, @Body() body: { accountId?: string; username?: string }) {
    if (!isAdminScope(req)) throw new ForbiddenException("admin only");
    const accountId = await this.resolveAccountId(body);
    await this.servers.grant(id, accountId);
    return { ok: true };
  }
  @Delete(":id/access/:accountId")
  @HttpCode(200)
  async revoke(@Req() req: GuardedRequest, @Param("id") id: string, @Param("accountId") accountId: string) {
    if (!isAdminScope(req)) throw new ForbiddenException("admin only");
    await this.servers.revoke(id, accountId);
    return { ok: true };
  }

  private async resolveAccountId(body: { accountId?: string; username?: string }): Promise<string> {
    if (body.accountId) return body.accountId;
    if (body.username) {
      const acct = (await this.accounts.list()).find((a) => a.username === body.username);
      if (acct) return acct.id;
    }
    throw new BadRequestException("accountId or known username required");
  }

  /** Admins manage any server; an agent manages only servers they own (self-added). */
  private async requireManage(req: GuardedRequest, id: string): Promise<void> {
    if (isAdminScope(req)) return;
    if (req.account && (await this.servers.isOwner(id, req.account.id))) return;
    throw new ForbiddenException("not allowed to manage this server");
  }
}
