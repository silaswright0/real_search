import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from "@/lib/auth-constants";
import {
  createLocalSession,
  consumeStartupToken,
  isAllowedHost,
  isAllowedOrigin,
  localAuthConfigurationError,
} from "@/lib/local-auth";
import { secureCookieFor } from "@/lib/viewer-auth";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isAllowedHost(request) || !isAllowedOrigin(request)) {
    return NextResponse.json({ error: "request origin denied" }, { status: 403 });
  }
  const configurationError = localAuthConfigurationError();
  if (configurationError) {
    return NextResponse.json({ error: configurationError }, { status: 503 });
  }
  let token = "";
  try {
    const body = (await request.json()) as { token?: unknown };
    token = typeof body.token === "string" ? body.token.trim() : "";
  } catch {
    return NextResponse.json({ error: "invalid request body" }, { status: 400 });
  }
  if (!consumeStartupToken(token)) {
    return NextResponse.json({ error: "invalid startup token" }, { status: 401 });
  }

  const session = createLocalSession();
  const secure = secureCookieFor(request);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, session.value, {
    httpOnly: true,
    sameSite: "strict",
    secure,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  response.cookies.set(CSRF_COOKIE, session.csrf, {
    httpOnly: false,
    sameSite: "strict",
    secure,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return response;
}
