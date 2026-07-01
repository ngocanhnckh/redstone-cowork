import { NextResponse } from "next/server";
import { API_URL } from "../../../../lib/api";

const TOKEN_MAX_AGE = 60 * 60 * 24; // access token ~24h
const REFRESH_MAX_AGE = 60 * 60 * 24 * 7; // refresh token ~7d

/**
 * Org-mode sign-in: exchange the user's Redstone username + password for tokens
 * (server-side, so the client secret never reaches the browser), then store the
 * access token as `rcw_token` (the Bearer the proxy already uses) and the refresh
 * token as `rcw_refresh` for silent renewal on expiry.
 */
export async function POST(req: Request) {
  const { username, password } = await req.json().catch(() => ({}));
  if (!username || !password) {
    return NextResponse.json({ error: "invalid_request", error_description: "Username and password are required." }, { status: 400 });
  }
  const r = await fetch(`${API_URL}/auth/redstone/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
    cache: "no-store",
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    return NextResponse.json({ error: j.error ?? "invalid_grant", error_description: j.error_description ?? "Sign-in failed." }, { status: r.status || 401 });
  }
  const res = NextResponse.json({ ok: true, user: j.user ?? null });
  const secure = process.env.NODE_ENV === "production";
  res.cookies.set("rcw_token", j.access_token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: TOKEN_MAX_AGE, secure });
  if (j.refresh_token) {
    res.cookies.set("rcw_refresh", j.refresh_token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: REFRESH_MAX_AGE, secure });
  }
  return res;
}
