import { apiFetch } from "../../../../lib/api";

const ALLOWED = [
  /^sessions$/,
  /^decisions$/,
  /^decisions\/[\w-]+\/resolve$/,
  /^sessions\/[^/]+\/instruct$/,
];

async function forward(req: Request, params: Promise<{ path: string[] }>, method: string) {
  const { path } = await params;
  const joined = path.join("/");
  if (!ALLOWED.some((re) => re.test(joined))) return new Response("forbidden", { status: 403 });
  const url = new URL(req.url);
  const body = method === "POST" ? await req.text() : undefined;
  return apiFetch(`/${joined}${url.search}`, { method, body });
}

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(req, ctx.params, "GET");
}
export async function POST(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(req, ctx.params, "POST");
}
