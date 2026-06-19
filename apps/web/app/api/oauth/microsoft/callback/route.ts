import { apiFetch } from "../../../../../lib/api";

// Microsoft redirects the browser here after consent. Forward the code to the API
// (which holds the client secret) to exchange it and create the connection, then
// bounce the user back to the Situation Room with a status flag.
// Relative redirects: the browser resolves Location against the public address-bar
// URL, not the container's internal hostname (which Next sees in req.url behind the tunnel).
const back = (status: string) => new Response(null, { status: 302, headers: { Location: `/?microsoft=${status}` } });

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const err = url.searchParams.get("error");
  if (err || !code) return back("error");
  try {
    const res = await apiFetch("/oauth/microsoft/callback", { method: "POST", body: JSON.stringify({ code }) });
    return back(res.ok ? "connected" : "error");
  } catch {
    return back("error");
  }
}
