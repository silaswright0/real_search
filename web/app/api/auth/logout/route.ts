import {
  CSRF_COOKIE,
  SESSION_COOKIE,
} from "@/lib/auth-constants";
import { isAuthorizedMutation } from "@/lib/local-auth";
import { secureCookieFor } from "@/lib/viewer-auth";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isAuthorizedMutation(request)) {
    return NextResponse.json({ error: "authorization failed" }, { status: 403 });
  }
  const secure = secureCookieFor(request);
  const response = NextResponse.json({ ok: true });
  for (const name of [SESSION_COOKIE, CSRF_COOKIE]) {
    response.cookies.set(name, "", {
      httpOnly: name === SESSION_COOKIE,
      sameSite: "strict",
      secure,
      path: "/",
      maxAge: 0,
    });
  }
  return response;
}
