import { randomBytes } from "node:crypto";
import {
  isAllowedHost,
  isAuthenticatedRequest,
} from "@/lib/local-auth";
import { NextRequest, NextResponse } from "next/server";

function contentSecurityPolicy(nonce: string): string {
  const developmentScript = process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${developmentScript}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self' ws://127.0.0.1:3000 ws://localhost:3000",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-src 'none'",
    "frame-ancestors 'self'",
  ].join("; ");
}

function secureResponse(response: NextResponse, csp: string): NextResponse {
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

export function proxy(request: NextRequest) {
  if (!isAllowedHost(request)) {
    return new NextResponse(null, { status: 421 });
  }

  const nonce = randomBytes(32).toString("base64");
  const csp = contentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("Content-Security-Policy", csp);
  requestHeaders.set("x-nonce", nonce);

  const path = request.nextUrl.pathname;
  const isPublic =
    path === "/login" ||
    path === "/api/auth/login" ||
    path.startsWith("/_next/") ||
    path === "/favicon.ico";

  if (isPublic) {
    if (path === "/login" && isAuthenticatedRequest(request)) {
      return secureResponse(
        NextResponse.redirect(new URL("/", request.url)),
        csp,
      );
    }
    return secureResponse(
      NextResponse.next({ request: { headers: requestHeaders } }),
      csp,
    );
  }

  if (!isAuthenticatedRequest(request)) {
    if (path.startsWith("/api/")) {
      return secureResponse(
        NextResponse.json({ error: "authentication required" }, { status: 401 }),
        csp,
      );
    }
    return secureResponse(
      NextResponse.redirect(new URL("/login", request.url)),
      csp,
    );
  }

  return secureResponse(
    NextResponse.next({ request: { headers: requestHeaders } }),
    csp,
  );
}

export const config = {
  matcher: ["/:path*"],
};
