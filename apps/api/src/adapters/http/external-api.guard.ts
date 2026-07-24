import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { loadConfig } from "../../infrastructure/config";
import { AccessKeysService } from "../../application/access-keys.service";
import { AccountsService } from "../../application/accounts.service";
import { DevicesService } from "../../application/devices.service";
import { RedstoneService } from "../../application/redstone.service";
import { SettingsService } from "../../application/settings.service";
import { verifyRedstoneOwner, type GuardedRequest } from "./instance-token.guard";

/**
 * Auth for the external inventory/control surface. Ways in:
 *  1. the instance token (the owner's own tools),
 *  2. a device token — the locally-installed `redstone` CLI / host agent, which is
 *     a trusted device (same as the delivery poller) and reports inventory/telemetry,
 *  3. a dedicated access key (`rcwk_…`) — scoped read | control (external callers),
 *  4. the linked Redstone owner's token (remote-back from the Redstone agent).
 *
 * Distinct from InstanceTokenGuard so ACCESS KEYS are accepted ONLY here, never on
 * the human cockpit endpoints. Per-endpoint scope (control) is enforced in handlers.
 */
@Injectable()
export class ExternalApiGuard implements CanActivate {
  constructor(
    private readonly accessKeys: AccessKeysService,
    private readonly devices: DevicesService,
    private readonly redstone: RedstoneService,
    private readonly settings: SettingsService,
    private readonly accounts: AccountsService,
  ) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<GuardedRequest>();
    const header = req.headers["authorization"] ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) throw new UnauthorizedException();
    if (token === loadConfig().INSTANCE_TOKEN) { req.authKind = "instance"; return true; }
    const dev = await this.devices.verify(token);
    if (dev) { req.authKind = "device"; return true; }
    const ak = await this.accessKeys.verify(token);
    if (ak) { req.authKind = "accesskey"; req.accessScope = ak.scope; return true; }
    // Enterprise agent accounts (rcwa_) — so agents can read inventory / discovered sessions.
    const account = await this.accounts.verify(token);
    if (account) { req.authKind = "account"; req.account = account; return true; }
    const user = await verifyRedstoneOwner(this.redstone, this.settings, token);
    if (user) { req.authKind = "redstone"; req.redstoneToken = token; req.redstoneUser = user; return true; }
    throw new UnauthorizedException();
  }
}
