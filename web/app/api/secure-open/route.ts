import {
  brokerHeaders,
  brokerUrl,
  isSameOriginMutation,
} from "@/lib/click-broker";
import { parsePublicHttpUrl } from "@/lib/secure-url";
import {
  secureCookieFor,
  viewerWebsocketPath,
  VIEWER_COOKIE,
} from "@/lib/viewer-auth";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "CSRF validation failed" }, { status: 403 });
  }
  let raw = "";
  try {
    const body = (await request.json()) as { url?: string };
    raw = body.url?.trim() ?? "";
    parsePublicHttpUrl(raw, process.env.ALLOW_INSECURE_HTTP === "1");
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "invalid URL" },
      { status: 400 },
    );
  }

  try {
    const response = await fetch(`${brokerUrl()}/sessions`, {
      method: "POST",
      headers: brokerHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ url: raw }),
      cache: "no-store",
    });
    const payload = (await response.json()) as {
      id?: unknown;
      viewerToken?: unknown;
      vncPassword?: unknown;
      error?: unknown;
    };
    if (!response.ok) {
      return NextResponse.json(payload, { status: response.status });
    }
    if (
      typeof payload.id !== "string" ||
      !/^[a-f0-9]{32}$/.test(payload.id) ||
      typeof payload.viewerToken !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(payload.viewerToken) ||
      typeof payload.vncPassword !== "string" ||
      payload.vncPassword.length !== 8
    ) {
      if (typeof payload.id === "string" && /^[a-f0-9]{32}$/.test(payload.id)) {
        await fetch(`${brokerUrl()}/sessions/${payload.id}`, {
          method: "DELETE",
          headers: brokerHeaders(),
          cache: "no-store",
        }).catch(() => undefined);
      }
      return NextResponse.json(
        { error: "click broker returned invalid credentials" },
        { status: 502 },
      );
    }
    const result = NextResponse.json({
      id: payload.id,
      vncPassword: payload.vncPassword,
    });
    result.cookies.set(VIEWER_COOKIE, payload.viewerToken, {
      httpOnly: true,
      sameSite: "strict",
      secure: secureCookieFor(request),
      path: viewerWebsocketPath(payload.id),
    });
    return result;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "click broker unreachable";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
