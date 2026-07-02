import type { NextConfig } from "next";

// The public origin is the web app; the API runs internally. The host CLI
// (`apps/hook-cli`) and the desktop app talk to the API DIRECTLY with a Bearer
// token (not the web's cookie-based `/api/proxy`), so proxy the API routes they
// use through the public origin. Auth is unchanged — the API guard still checks
// the token; rewrites forward the Authorization header.
const API_URL = process.env.API_INTERNAL_URL ?? "http://api:3001";

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    return [
      // Public, unauthenticated — one-line device install.
      { source: "/install.sh", destination: `${API_URL}/install.sh` },
      { source: "/install/redstone.js", destination: `${API_URL}/install/redstone.js` },
      // Public auth endpoints (org mode / Redstone): discovery + password grant +
      // refresh. Used by the login page and by the desktop app talking direct.
      { source: "/auth/:path*", destination: `${API_URL}/auth/:path*` },
      // Bearer-authed API routes used by the host CLI + desktop app.
      { source: "/sessions", destination: `${API_URL}/sessions` },
      { source: "/sessions/:path*", destination: `${API_URL}/sessions/:path*` },
      { source: "/decisions", destination: `${API_URL}/decisions` },
      { source: "/decisions/:path*", destination: `${API_URL}/decisions/:path*` },
      { source: "/stream", destination: `${API_URL}/stream` },
      // LLM assistant + agent (models, chat, assist, agent, custom endpoints).
      { source: "/llm/:path*", destination: `${API_URL}/llm/:path*` },
      // Session inventory + external API (host agent, inventory, access keys).
      { source: "/hosts", destination: `${API_URL}/hosts` },
      { source: "/hosts/:path*", destination: `${API_URL}/hosts/:path*` },
      { source: "/inventory", destination: `${API_URL}/inventory` },
      { source: "/inventory/:path*", destination: `${API_URL}/inventory/:path*` },
      { source: "/access-keys", destination: `${API_URL}/access-keys` },
      { source: "/access-keys/:path*", destination: `${API_URL}/access-keys/:path*` },
      { source: "/telemetry", destination: `${API_URL}/telemetry` },
      { source: "/telemetry/:path*", destination: `${API_URL}/telemetry/:path*` },
    ];
  },
};

export default nextConfig;
