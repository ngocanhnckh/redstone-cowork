import { NextResponse } from "next/server";
import { API_URL } from "../../../../lib/api";

/** Enterprise agent sign-in: exchange username/password for an rcwa_ token cookie. */
export async function POST(req: Request) {
  const { username, password } = await req.json();
  const fwd = req.headers.get("x-forwarded-for") ?? "";
  const r = await fetch(`${API_URL}/auth/account/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": fwd },
    body: JSON.stringify({ username, password, device: "web · " + (req.headers.get("user-agent") ?? "browser").slice(0, 80) }),
    cache: "no-store",
  });
  const j = (await r.json().catch(() => ({}))) as { token?: string; error_description?: string };
  if (!r.ok || !j.token) return NextResponse.json({ ok: false, error: j.error_description ?? "Sign-in failed" }, { status: r.status || 401 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set("rcw_token", j.token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30, secure: process.env.NODE_ENV === "production" });
  return res;
}
