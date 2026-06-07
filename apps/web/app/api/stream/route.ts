import { apiFetch } from "../../../lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  const upstream = await apiFetch("/stream");
  if (!upstream.ok || !upstream.body) return new Response("unauthorized", { status: 401 });
  return new Response(upstream.body, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
