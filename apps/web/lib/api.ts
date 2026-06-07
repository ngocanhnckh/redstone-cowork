import { cookies } from "next/headers";

export const API_URL = process.env.API_INTERNAL_URL ?? "http://api:3001";

export async function tokenFromCookie(): Promise<string | null> {
  return (await cookies()).get("rcw_token")?.value ?? null;
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await tokenFromCookie();
  if (!token) return new Response("unauthorized", { status: 401 });
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    cache: "no-store",
  });
}
