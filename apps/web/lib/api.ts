import { cookies } from "next/headers";

export const API_URL = process.env.API_INTERNAL_URL ?? "http://api:3001";

export async function tokenFromCookie(): Promise<string | null> {
  return (await cookies()).get("rcw_token")?.value ?? null;
}

const SECURE = process.env.NODE_ENV === "production";

/**
 * Fetch the API with the browser's cookie token as Bearer. For org (Redstone)
 * users the access token expires (~24h); on a 401 we transparently refresh it
 * with the stored `rcw_refresh` token, update the cookies, and retry once. A
 * personal-mode instance token never 401s this way, so the fast path is unchanged.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const jar = await cookies();
  const token = jar.get("rcw_token")?.value;
  if (!token) return new Response("unauthorized", { status: 401 });

  const call = (t: string) =>
    fetch(`${API_URL}${path}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
      cache: "no-store",
    });

  const res = await call(token);
  if (res.status !== 401) return res;

  // Try a silent refresh (org mode only — personal instance tokens have none).
  const refresh = jar.get("rcw_refresh")?.value;
  if (!refresh) return res;
  const rr = await fetch(`${API_URL}/auth/redstone/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refresh }),
    cache: "no-store",
  });
  if (!rr.ok) return res;
  const j = (await rr.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string };
  if (!j.access_token) return res;
  try {
    jar.set("rcw_token", j.access_token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24, secure: SECURE });
    if (j.refresh_token) jar.set("rcw_refresh", j.refresh_token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7, secure: SECURE });
  } catch {
    // read-only cookie context (e.g. a server component) — the retry still serves
    // this request; the cookie refreshes on the next mutable (route-handler) call.
  }
  return call(j.access_token);
}
