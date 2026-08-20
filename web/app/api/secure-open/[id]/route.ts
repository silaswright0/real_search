import {
  brokerHeaders,
  brokerUrl,
  isSameOriginMutation,
} from "@/lib/click-broker";
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
  if (!/^[a-f0-9]{16}$/.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  try {
    const response = await fetch(`${brokerUrl()}/sessions/${id}`, {
      method: "DELETE",
      headers: brokerHeaders(),
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
