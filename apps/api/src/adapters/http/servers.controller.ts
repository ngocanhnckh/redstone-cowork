import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ZodError } from "zod";
import { NewServerSchema } from "@rcw/shared";
import { ServersService } from "../../application/servers.service";
import { AccountsService } from "../../application/accounts.service";
import { SessionsService } from "../../application/sessions.service";
import { InstanceTokenGuard, isAdminScope, type GuardedRequest } from "./instance-token.guard";

@Controller("servers")
@UseGuards(InstanceTokenGuard)
export class ServersController {
  constructor(private readonly servers: ServersService, private readonly accounts: AccountsService, private readonly sessions: SessionsService) {}

  /** Admin sees all servers (with ACL); an agent sees the servers assigned to them + their own. */
  @Get()
  async list(@Req() req: GuardedRequest) {
    const registry = isAdminScope(req) ? await this.servers.listAllWithAccess() : await this.servers.listForAccount(req.account!.id);
    // Also surface hosts where sessions already run (redstone agent reporting) that
    // aren't in the curated registry yet — so connected servers aren't invisible.
    const known = new Set(registry.map((s) => (s.host || "").toLowerCase()).concat(registry.map((s) => s.name.toLowerCase())));
    const sessions = isAdminScope(req) ? await this.sessions.list() : await this.sessions.list(req.account!.id);
    const machines = new Map<string, string>();
    for (const s of sessions) if (s.machine && !machines.has(s.machine.toLowerCase())) machines.set(s.machine.toLowerCase(), s.machine);
    const now = new Date();
    const discovered = [...machines.values()]
      .filter((m) => !known.has(m.toLowerCase()))
      .map((m) => ({
        id: `host:${m}`, name: m, host: m, sshUser: "", sshPort: 22, description: "reporting a redstone agent",
        ownerAccountId: null, keyInstalled: true, createdBy: null, createdAt: now, discovered: true,
      }));
    return [...registry, ...discovered];
  }

  /** The cowork public key to install on a self-added VPS (null if not configured). */
  @Get("cowork-key")
  coworkKey() {
    return { publicKey: this.servers.coworkPublicKey() };
  }

  /** Provisioning bundle for a server: ready-to-paste install commands (direct &
   *  reverse-relay for closed hosts) carrying a fresh long-lived host token bound to
   *  the caller, so the installed redstone agent authenticates as this account. */
  @Post(":id/provision")
  @HttpCode(200)
  async provision(@Req() req: GuardedRequest, @Param("id") realId: string) {
    // A discovered host (already reporting redstone) has no registry row — adopt it
    // so it can be managed, then build the (re)install command.
    const id = await this.adoptIfDiscovered(realId, req);
    await this.requireManage(req, id);
    const server = await this.servers.get(id);
    if (!server) throw new NotFoundException();
    const alreadyInstalled = realId.startsWith("host:");
    const accountId = req.account?.id;
    // Instance-token callers (no account) fall back to the instance token itself.
    const token = accountId
      ? await this.accounts.mintHostToken(accountId, `host:${server.name}`)
      : process.env.INSTANCE_TOKEN ?? "";
    const base = (process.env.COWORK_PUBLIC_URL ?? "https://cowork.chatredstone.com").replace(/\/$/, "");
    const direct = `curl -fsSL ${base}/install.sh | bash -s -- --server ${base} --token ${token}`;
    return {
      serverUrl: base,
      alreadyInstalled, // true when adopted from a host already reporting a redstone agent
      // Directly-reachable host: install + agent, no relay.
      installCommand: direct,
      // Closed/NAT'd host (no inbound SSH): opt into the reverse-SSH relay.
      installCommandRelay: direct + " --relay",
    };
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

  /** Admin grants/revokes an agent's access to a company server. Granting a
   *  DISCOVERED host (id "host:<machine>") first adopts it into the registry. */
  @Post(":id/access")
  @HttpCode(200)
  async grant(@Req() req: GuardedRequest, @Param("id") id: string, @Body() body: { accountId?: string; username?: string }) {
    if (!isAdminScope(req)) throw new ForbiddenException("admin only");
    const accountId = await this.resolveAccountId(body);
    const serverId = await this.adoptIfDiscovered(id, req);
    await this.servers.grant(serverId, accountId);
    return { ok: true, serverId };
  }

  /** Turn a discovered host into a real registry server so it can be assigned/managed.
   *  No-op for real ids. Returns the registry server id to operate on. */
  private async adoptIfDiscovered(id: string, req: GuardedRequest): Promise<string> {
    if (!id.startsWith("host:")) return id;
    const machine = id.slice("host:".length);
    // Already adopted under a real id? Match by host/name.
    const existing = (await this.servers.listAllWithAccess()).find(
      (s) => s.host.toLowerCase() === machine.toLowerCase() || s.name.toLowerCase() === machine.toLowerCase(),
    );
    if (existing) return existing.id;
    const created = await this.servers.createCompany(
      { name: machine, host: machine, sshUser: "root", sshPort: 22, description: "adopted from a reporting redstone agent" },
      req.account?.id ?? "",
    );
    return created.id;
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
