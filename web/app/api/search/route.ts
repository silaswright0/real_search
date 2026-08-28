import { isAuthorizedMutation } from "@/lib/local-auth";
import { parseMode } from "@/lib/mode";
import { getSearchProvider } from "@/lib/search/providers";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const PRIVATE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  "Referrer-Policy": "no-referrer",
};

function parsePage(value: unknown): number {
  const page = Number(value ?? 1);
  if (!Number.isFinite(page) || page < 1) {
    return 1;
  }
  return Math.min(100, Math.floor(page));
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  const isNativeForm = contentType.startsWith("application/x-www-form-urlencoded");

  let body: {
    query?: unknown;
    mode?: unknown;
    pageno?: unknown;
    csrf?: unknown;
  };
  try {
    if (isNativeForm) {
      const form = await request.formData();
      body = {
        query: form.get("query"),
        mode: form.get("mode"),
        pageno: form.get("pageno"),
        csrf: form.get("csrf"),
      };
    } else {
      body = (await request.json()) as typeof body;
    }
  } catch {
    return NextResponse.json(
      { error: "invalid request body" },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }
  const suppliedCsrf =
    isNativeForm && typeof body.csrf === "string" ? body.csrf : undefined;
  if (!isAuthorizedMutation(request, suppliedCsrf)) {
    return NextResponse.json(
      { error: "authorization failed" },
      { status: 403, headers: PRIVATE_HEADERS },
    );
  }
  const q = typeof body.query === "string" ? body.query.trim() : "";
  const mode = parseMode(typeof body.mode === "string" ? body.mode : undefined);
  const pageno = parsePage(body.pageno);

  if (!q || q.length > 500) {
    return NextResponse.json(
      {
        query: "",
        mode,
        page: pageno,
        results: [],
        status: "error",
        message: q ? "Search query is too long" : "Missing search query",
      },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }

  const provider = getSearchProvider(mode);
  const payload = await provider.search({ q, mode, pageno });
  const httpStatus = payload.status === "error" ? 502 : 200;
  return NextResponse.json(payload, {
    status: httpStatus,
    headers: PRIVATE_HEADERS,
  });
}
