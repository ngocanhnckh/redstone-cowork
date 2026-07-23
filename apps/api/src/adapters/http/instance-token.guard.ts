import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { loadConfig } from "../../infrastructure/config";
import { AccountsService } from "../../application/accounts.service";
import { DevicesService } from "../../application/devices.service";
import { RedstoneService, type RedstoneUser } from "../../application/redstone.service";
import { SettingsService } from "../../application/settings.service";
import type { AccessKeyScope, Account } from "@rcw/shared";

/** Request fields the guard attaches so downstream handlers know who's calling. */
export type GuardedRequest = {
  headers: Record<string, string>;
  authKind?: "instance" | "device" | "redstone" | "accesskey" | "account";
  /** The org user's Redstone access token (only when authKind === "redstone"). */
  redstoneToken?: string;
  redstoneUser?: RedstoneUser;
  /** Scope of the access key used (only when authKind === "accesskey"). */
  accessScope?: AccessKeyScope;
  /** The signed-in employee/admin account (only when authKind === "account"). */
  account?: Account;
};

/** True when the caller may act with admin breadth: the instance token, a device
 *  token, the linked Redstone owner, or an account with the admin role. Member
 *  accounts are the only scoped-down callers. */
export function isAdminScope(req: GuardedRequest): boolean {
  return req.authKind !== "account" || req.account?.role === "admin";
}

/**
 * Validate a Redstone token AND confirm it belongs to the linked owner. Once an
 * org owner is recorded (first login), only that user's tokens are accepted — so
 * not just any Redstone user can reach this installation.
 */
export async function verifyRedstoneOwner(
  redstone: RedstoneService,
  settings: SettingsService,
  token: string,
): Promise<RedstoneUser | null> {
  if (!redstone.enabled()) return null;
  const user = await redstone.verify(token);
  if (!user) return null;
  const owner = await settings.ownerSub();
  if (owner && owner !== user.sub) return null;
  return user;
}

@Injectable()
export class InstanceTokenGuard implements CanActivate {
  constructor(
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
    // Employee/admin account bearer (enterprise mode). Prefix-routed so the two
    // hashed-token lookups below never race a legitimate account token.
    if (token.startsWith("rcwa_")) {
      const account = await this.accounts.verify(token);
      if (account) { req.authKind = "account"; req.account = account; return true; }
      throw new UnauthorizedException();
    }
    const dev = await this.devices.verify(token);
    if (dev) { req.authKind = "device"; return true; }
    // Org mode: a Redstone access token, validated via introspection (cached) and
    // restricted to the linked owner. Stashed so the assistant can act AS the user.
    const user = await verifyRedstoneOwner(this.redstone, this.settings, token);
    if (user) { req.authKind = "redstone"; req.redstoneToken = token; req.redstoneUser = user; return true; }
    throw new UnauthorizedException();
  }
}
