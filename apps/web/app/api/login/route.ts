import { NextResponse } from "next/server";
import { API_URL } from "../../../lib/api";

export async function POST(req: Request) {
  const { token } = await req.json();
  const probe = await fetch(`${API_URL}/sessions`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!probe.ok) return NextResponse.json({ ok: false }, { status: 401 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set("rcw_token", token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30, secure: process.env.NODE_ENV === "production" });
  return res;
}
