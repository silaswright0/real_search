import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
    const privacyHeaders = [
      {
        key: "Cache-Control",
        value: "no-store, no-cache, must-revalidate",
      },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
    ];
    return [
      { source: "/search", headers: privacyHeaders },
      { source: "/view/:path*", headers: privacyHeaders },
      { source: "/api/search", headers: privacyHeaders },
      { source: "/api/secure-open", headers: privacyHeaders },
      { source: "/api/secure-open/:path*", headers: privacyHeaders },
    ];
  },
};

export default nextConfig;
