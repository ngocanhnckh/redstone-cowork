import type { NextConfig } from "next";

// The public origin is the web app; the install script + bundled CLI are served
// by the API. Proxy them through so `https://<origin>/install.sh` works for the
// one-line device enrollment (`curl … | bash`). Both are public (no auth).
const API_URL = process.env.API_INTERNAL_URL ?? "http://api:3001";

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    return [
      { source: "/install.sh", destination: `${API_URL}/install.sh` },
      { source: "/install/redstone.js", destination: `${API_URL}/install/redstone.js` },
    ];
  },
};

export default nextConfig;
