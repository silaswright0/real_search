import { ALLOWED_HOSTS } from "./lib/auth-constants";
import type { NextConfig } from "next";

if (
  ALLOWED_HOSTS.length !== 2 ||
  ALLOWED_HOSTS[0] !== "127.0.0.1:3000" ||
  ALLOWED_HOSTS[1] !== "localhost:3000"
) {
  throw new Error("Next.js host allowlist must remain 127.0.0.1:3000 and localhost:3000");
}

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  async headers() {
    const privacyHeaders = [
      {
        key: "Cache-Control",
        value: "no-store, no-cache, must-revalidate",
      },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
      },
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
