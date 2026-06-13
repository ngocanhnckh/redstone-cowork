import { apiFetch } from "../../../../../lib/api";

// Kicks off Google consent: ask the API for the consent URL, then redirect the
// browser to Google. The user's instance bearer rides along via apiFetch (cookie).
// On error, redirect relatively so the browser stays on the public domain (not the
// container's internal hostname). The Google consent URL is absolute and used as-is.
const fail = () => new Response(null, { status: 302, headers: { Location: "/?google=error" } });

export async function GET() {
  try {
    const res = await apiFetch("/oauth/google/url");
    if (!res.ok) return fail();
    const { url } = (await res.json()) as { url: string };
    return Response.redirect(url, 302);
  } catch {
    return fail();
  }
}
