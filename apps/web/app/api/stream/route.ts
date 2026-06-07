import { apiFetch } from "../../../lib/api";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const upstream = await apiFetch("/stream", { signal: req.signal });
  if (!upstream.ok && upstream.status !== 401) return new Response("bad gateway", { status: 502 });
  if (!upstream.ok || !upstream.body) return new Response("unauthorized", { status: 401 });
  return new Response(upstream.body, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
