import { NextResponse } from "next/server";
import { API_URL } from "../../../../../lib/api";

/** Kick off Jira OAuth from the web: ask the API for the authorize URL (telling it to
 *  redirect back to our finish route with the state), then send the browser to Jira. */
export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  const r = await fetch(`${API_URL}/auth/jira/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ redirectTo: `${origin}/api/login/jira/finish` }),
    cache: "no-store",
  });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; authUrl?: string; error?: string };
  if (!j.ok || !j.authUrl) return NextResponse.redirect(new URL(`/login?e=${encodeURIComponent(j.error ?? "jira unavailable")}`, req.url));
  return NextResponse.redirect(j.authUrl);
}
