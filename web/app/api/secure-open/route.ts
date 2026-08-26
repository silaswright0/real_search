import {
  brokerHeaders,
  brokerUrl,
  isSameOriginMutation,
} from "@/lib/click-broker";
import { parsePublicHttpUrl } from "@/lib/secure-url";
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
    const payload = (await response.json()) as Record<string, unknown>;
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "click broker unreachable";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
