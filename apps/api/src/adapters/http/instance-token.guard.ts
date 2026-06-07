import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { loadConfig } from "../../infrastructure/config";

@Injectable()
export class InstanceTokenGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string> }>();
    const header = req.headers["authorization"] ?? "";
    if (header !== `Bearer ${loadConfig().INSTANCE_TOKEN}`) throw new UnauthorizedException();
    return true;
  }
}
