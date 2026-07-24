import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ZodError } from "zod";
import { NewServerSchema } from "@rcw/shared";
import { ServersService } from "../../application/servers.service";
import { AccountsService } from "../../application/accounts.service";
import { SessionsService } from "../../application/sessions.service";
import { InventoryService } from "../../application/inventory.service";
import { InstanceTokenGuard, isAdminScope, type GuardedRequest } from "./instance-token.guard";

@Controller("servers")
@UseGuards(InstanceTokenGuard)
export class ServersController {
  constructor(
    private readonly servers: ServersService,
    private readonly accounts: AccountsService,
    private readonly sessions: SessionsService,
    private readonly inventory: InventoryService,
  ) {}

  /** Admin sees all servers (with ACL); an agent sees the servers assigned to them + their own. */
  @Get()
  async list(@Req() req: GuardedRequest) {
    const registry = isAdminScope(req) ? await this.servers.listAllWithAccess() : await this.servers.listForAccount(req.account!.id);
    // Also surface reporting redstone agents not yet curated. A redstone install lives
    // in the USER's home (~/.redstone/host-id), so each USER@HOST is its own inventory
    // host — discovery is keyed per (user, host), not per machine.
    const registryKey = new Set(
      registry.map((s) => `${(s.sshUser || "").toLowerCase()}@${(s.host || "").toLowerCase()}`),
    );
    const hosts = await this.inventory.listHosts();
    // Members only see hosts they have sessions on (by machine).
    const myMachines = isAdminScope(req)
      ? null
      : new Set((await this.sessions.list(req.account!.id)).map((s) => s.machine.toLowerCase()));
    const now = new Date();
    const discovered = hosts
      .filter((h) => (myMachines ? myMachines.has(h.machine.toLowerCase()) : true))
      .filter((h) => !registryKey.has(`${(h.user || "").toLowerCase()}@${(h.address || h.machine).toLowerCase()}`))
      .map((h) => ({
        id: `host:${h.id}`,
        name: h.user ? `${h.user}@${h.machine}` : h.machine,
        host: h.address || h.machine,
        sshUser: h.user || "",
        sshPort: h.sshPort ?? 22,
        description: "reporting a redstone agent",
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

  /** Admin registers a shared company server; an agent self-adds their own VPS. If the
   *  same user@host is ALREADY known to cowork (a curated server or a reporting agent),
   *  we don't duplicate it — we grant the caller access to the existing one. */
  @Post()
  @HttpCode(201)
  async create(@Req() req: GuardedRequest, @Body() body: unknown) {
    try {
      const input = NewServerSchema.parse(body);
      // Already known (same user@host)? Reuse it and, for a member, grant access.
      const known = await this.findKnown(input.sshUser, input.host, req);
      if (known) {
        if (req.account && req.account.role !== "admin") await this.servers.grant(known, req.account.id);
        return await this.servers.get(known);
      }
      if (isAdminScope(req) && req.authKind !== "account") {
        return await this.servers.createCompany(input, "");
      }
      if (req.account?.role === "admin") return await this.servers.createCompany(input, req.account.id);
      // members self-add owned VPS (genuinely new)
      return await this.servers.createOwned(input, req.account!.id);
    } catch (e) {
      if (e instanceof ZodError) throw new BadRequestException(e.issues);
      throw e;
    }
  }

  /** Find an existing registry server for user@host, or adopt a matching reporting host.
   *  Returns the registry server id, or null when cowork has never seen this user@host. */
  private async findKnown(sshUser: string, host: string, req: GuardedRequest): Promise<string | null> {
    const u = (sshUser || "").toLowerCase(), h = (host || "").toLowerCase();
    const registry = (await this.servers.listAllWithAccess()).find(
      (s) => s.sshUser.toLowerCase() === u && s.host.toLowerCase() === h,
    );
    if (registry) return registry.id;
    const invHost = (await this.inventory.listHosts()).find(
      (x) => (x.user || "").toLowerCase() === u && (x.address || x.machine).toLowerCase() === h,
    );
    if (invHost) return this.adoptIfDiscovered(`host:${invHost.id}`, req);
    return null;
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
   *  Resolves the inventory host (which carries the Unix user + address + port), so the
   *  adopted server captures the correct user@host. No-op for real ids. */
  private async adoptIfDiscovered(id: string, req: GuardedRequest): Promise<string> {
    if (!id.startsWith("host:")) return id;
    const hostId = id.slice("host:".length);
    const host = (await this.inventory.listHosts()).find((h) => h.id === hostId);
    const machine = host?.machine ?? hostId;
    const user = host?.user || "root";
    const addr = host?.address || machine;
    // Already adopted? Match by (user, host).
    const existing = (await this.servers.listAllWithAccess()).find(
      (s) => s.sshUser.toLowerCase() === user.toLowerCase() && s.host.toLowerCase() === addr.toLowerCase(),
    );
    if (existing) return existing.id;
    const created = await this.servers.createCompany(
      {
        name: host?.user ? `${host.user}@${machine}` : machine,
        host: addr, sshUser: user, sshPort: host?.sshPort ?? 22,
        description: "adopted from a reporting redstone agent",
      },
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
