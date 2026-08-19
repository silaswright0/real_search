import { parseMode } from "@/lib/mode";
import { getSearchProvider } from "@/lib/search/providers";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function parsePage(value: string | null): number {
  const page = Number(value ?? 1);
  if (!Number.isFinite(page) || page < 1) {
    return 1;
  }
  return Math.floor(page);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() ?? "";
  const mode = parseMode(searchParams.get("mode"));
  const pageno = parsePage(searchParams.get("pageno"));

  if (!q) {
    return NextResponse.json(
      {
        query: "",
        mode,
        page: pageno,
        results: [],
        status: "error",
        message: "Missing search query",
      },
      { status: 400 },
    );
  }

  const provider = getSearchProvider(mode);
  const payload = await provider.search({ q, mode, pageno });
  const httpStatus = payload.status === "error" ? 502 : 200;
  return NextResponse.json(payload, { status: httpStatus });
}
