import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";

@Injectable()
export class MasterTokenGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{ authKind?: string }>();
    if (req.authKind !== "instance") throw new ForbiddenException("master token required");
    return true;
  }
}
