import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { loadConfig } from "../../infrastructure/config";
import { DevicesService } from "../../application/devices.service";

@Injectable()
export class InstanceTokenGuard implements CanActivate {
  constructor(private readonly devices: DevicesService) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string>; authKind?: string }>();
    const header = req.headers["authorization"] ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) throw new UnauthorizedException();
    if (token === loadConfig().INSTANCE_TOKEN) { req.authKind = "instance"; return true; }
    const dev = await this.devices.verify(token);
    if (dev) { req.authKind = "device"; return true; }
    throw new UnauthorizedException();
  }
}
