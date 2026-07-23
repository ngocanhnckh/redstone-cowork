import { Controller, Get, Header, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { JiraOAuthError, JiraOAuthService } from "../../application/jira-oauth.service";
import { clientIp } from "./auth.controller";

/** Public Jira DC OAuth endpoints (unguarded — this IS how you sign in). */
@Controller("auth/jira")
export class JiraOAuthController {
  constructor(private readonly jira: JiraOAuthService) {}

  /** Begin sign-in: hand the client the Jira authorize URL + a state to poll on. */
  @Post("start")
  start() {
    try {
      return { ok: true, ...this.jira.start() };
    } catch (e) {
      return { ok: false, error: e instanceof JiraOAuthError ? e.message : "unavailable" };
    }
  }

  /** Jira redirects the browser here after consent. Renders the cinematic result page. */
  @Get("callback")
  @Header("Content-Type", "text/html; charset=utf-8")
  async callback(@Query("code") code: string | undefined, @Query("state") state: string | undefined, @Req() req: Request): Promise<string> {
    if (!code || !state) return resultPage(false, "Missing authorization code.");
    await this.jira.handleCallback(code, state, {
      ip: clientIp(req),
      device: String(req.headers["user-agent"] ?? "browser"),
    });
    // peek() does NOT drain — the desktop's poll() is what consumes the session token.
    const { ok, error } = this.jira.peek(state);
    return resultPage(ok, error);
  }

  /** Desktop drains the sign-in outcome by state. */
  @Get("poll")
  poll(@Query("state") state: string | undefined) {
    if (!state) return { status: "error", error: "missing state" };
    return this.jira.poll(state);
  }
}

// ——— Cinematic "authenticated" page shown in the browser after Jira consent ———
function resultPage(ok: boolean, error: string | null): string {
  const color = ok ? "#54e6ff" : "#ff6a5f";
  const title = ok ? "IDENTITY VERIFIED" : "ACCESS DENIED";
  const sub = ok ? "Return to Redstone Cowork — your terminal is unlocking." : (error ?? "Authentication failed.");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>YITEC · ${title}</title><style>
*{margin:0;box-sizing:border-box}
html,body{height:100%;background:radial-gradient(ellipse 120% 90% at 50% 0%,#0a1620,#050a10 55%,#030608);color:#e6f2f4;
  font-family:"SF Mono",ui-monospace,monospace;display:flex;align-items:center;justify-content:center;overflow:hidden}
.grid{position:fixed;inset:0;opacity:.14;background-image:linear-gradient(${color}44 1px,transparent 1px),linear-gradient(90deg,${color}44 1px,transparent 1px);
  background-size:44px 44px;animation:drift 6s linear infinite;mask-image:radial-gradient(ellipse 80% 70% at 50% 45%,#000 30%,transparent 75%)}
@keyframes drift{to{background-position:0 44px}}
.card{position:relative;z-index:2;text-align:center;padding:44px 52px;border:1px solid ${color}55;border-radius:18px;
  background:rgb(8 14 20 / .72);backdrop-filter:blur(24px);box-shadow:0 0 70px -18px ${color}88;animation:in .6s ease both}
@keyframes in{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
.seal{width:96px;height:96px;margin:0 auto 20px;border-radius:50%;border:2px solid ${color};display:flex;align-items:center;justify-content:center;
  font-size:44px;color:${color};box-shadow:0 0 30px -4px ${color};animation:pulse 2.4s ease infinite}
@keyframes pulse{0%,100%{box-shadow:0 0 30px -6px ${color}}50%{box-shadow:0 0 44px 2px ${color}}}
.kick{font-size:10px;letter-spacing:.4em;color:${color};opacity:.85}
h1{font-size:22px;letter-spacing:.16em;margin:8px 0 6px}
.sub{font-size:12px;letter-spacing:.08em;color:#9fb2b8;max-width:340px;line-height:1.6;margin:0 auto}
.bar{margin-top:22px;height:3px;border-radius:2px;background:${color}22;overflow:hidden}
.bar i{display:block;height:100%;width:40%;background:${color};box-shadow:0 0 12px ${color};animation:load 1.4s ease-in-out infinite}
@keyframes load{0%{transform:translateX(-120%)}100%{transform:translateX(320%)}}
</style></head><body><div class="grid"></div>
<div class="card">
  <div class="seal">${ok ? "◈" : "⚠"}</div>
  <div class="kick">YITEC INTELLIGENCE AGENCY</div>
  <h1>${title}</h1>
  <p class="sub">${sub}</p>
  ${ok ? '<div class="bar"><i></i></div>' : ""}
</div>
<script>setTimeout(function(){window.close()}, ${ok ? 2600 : 6000});</script>
</body></html>`;
}
