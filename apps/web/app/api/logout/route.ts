import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const res = NextResponse.redirect(new URL("/login", req.url));
  res.cookies.set("rcw_token", "", { httpOnly: true, path: "/", maxAge: 0 });
  res.cookies.set("rcw_refresh", "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
