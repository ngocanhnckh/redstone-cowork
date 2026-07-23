import { NextResponse } from "next/server";
import { API_URL } from "../../../../../lib/api";

/** Jira → API callback 302'd here with ?state. Drain the session and set the cookie. */
export async function GET(req: Request) {
  const state = new URL(req.url).searchParams.get("state");
  if (!state) return NextResponse.redirect(new URL("/login?e=missing+state", req.url));
  const r = await fetch(`${API_URL}/auth/jira/poll?state=${encodeURIComponent(state)}`, { cache: "no-store" });
  const j = (await r.json().catch(() => ({}))) as { status?: string; session?: { token?: string }; error?: string };
  if (j.status !== "ok" || !j.session?.token) {
    return NextResponse.redirect(new URL(`/login?e=${encodeURIComponent(j.error ?? "jira sign-in failed")}`, req.url));
  }
  const res = NextResponse.redirect(new URL("/admin", req.url));
  res.cookies.set("rcw_token", j.session.token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30, secure: process.env.NODE_ENV === "production" });
  return res;
}
