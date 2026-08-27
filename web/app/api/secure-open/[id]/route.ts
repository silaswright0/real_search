import {
  brokerHeaders,
  brokerUrl,
  isSameOriginMutation,
} from "@/lib/click-broker";
import {
  secureCookieFor,
  viewerWebsocketPath,
  VIEWER_COOKIE,
} from "@/lib/viewer-auth";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "CSRF validation failed" }, { status: 403 });
  }
  const { id } = await context.params;
  if (!/^[a-f0-9]{32}$/.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  try {
    const response = await fetch(`${brokerUrl()}/sessions/${id}`, {
      method: "DELETE",
      headers: brokerHeaders(),
      cache: "no-store",
    });
    const payload = (await response.json()) as Record<string, unknown>;
    const result = NextResponse.json(payload, { status: response.status });
    result.cookies.set(VIEWER_COOKIE, "", {
      httpOnly: true,
      sameSite: "strict",
      secure: secureCookieFor(request),
      path: viewerWebsocketPath(id),
      maxAge: 0,
    });
    return result;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "click broker unreachable";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
