import { apiFetch } from "../../../../../lib/api";

// Kicks off Google consent: ask the API for the consent URL, then redirect the
// browser to Google. The user's instance bearer rides along via apiFetch (cookie).
export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  try {
    const res = await apiFetch("/oauth/google/url");
    if (!res.ok) return Response.redirect(`${origin}/?google=error`, 302);
    const { url } = (await res.json()) as { url: string };
    return Response.redirect(url, 302);
  } catch {
    return Response.redirect(`${origin}/?google=error`, 302);
  }
}
