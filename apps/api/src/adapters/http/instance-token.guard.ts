import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { loadConfig } from "../../infrastructure/config";
import { DevicesService } from "../../application/devices.service";
import { RedstoneService, type RedstoneUser } from "../../application/redstone.service";

/** Request fields the guard attaches so downstream handlers know who's calling. */
export type GuardedRequest = {
  headers: Record<string, string>;
  authKind?: "instance" | "device" | "redstone";
  /** The org user's Redstone access token (only when authKind === "redstone"). */
  redstoneToken?: string;
  redstoneUser?: RedstoneUser;
};

@Injectable()
export class InstanceTokenGuard implements CanActivate {
  constructor(
    private readonly devices: DevicesService,
    private readonly redstone: RedstoneService,
  ) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<GuardedRequest>();
    const header = req.headers["authorization"] ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) throw new UnauthorizedException();
    if (token === loadConfig().INSTANCE_TOKEN) { req.authKind = "instance"; return true; }
    const dev = await this.devices.verify(token);
    if (dev) { req.authKind = "device"; return true; }
    // Org mode: a Redstone access token, validated via introspection (cached). We
    // stash it so the assistant can call the Redstone agent AS this user.
    if (this.redstone.enabled()) {
      const user = await this.redstone.verify(token);
      if (user) { req.authKind = "redstone"; req.redstoneToken = token; req.redstoneUser = user; return true; }
    }
    throw new UnauthorizedException();
  }
}
