import { apiFetch } from "../../../../../lib/api";

// Google redirects the browser here after consent. Forward the code to the API
// (which holds the client secret) to exchange it and create the connection, then
// bounce the user back to the Situation Room with a status flag.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;
  const code = url.searchParams.get("code");
  const err = url.searchParams.get("error");
  if (err || !code) return Response.redirect(`${origin}/?google=error`, 302);
  try {
    const res = await apiFetch("/oauth/google/callback", { method: "POST", body: JSON.stringify({ code }) });
    return Response.redirect(`${origin}/?google=${res.ok ? "connected" : "error"}`, 302);
  } catch {
    return Response.redirect(`${origin}/?google=error`, 302);
  }
}
