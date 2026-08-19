"use client";

import { PrivateBanner } from "@/components/PrivateBanner";
import { SearchBar } from "@/components/SearchBar";
import { SearchResults } from "@/components/SearchResults";
import { Wordmark } from "@/components/Wordmark";
import { parseMode } from "@/lib/mode";
import type { SearchMode, SearchResponse } from "@/lib/search/types";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

function pageHref(q: string, mode: SearchMode, page: number): string {
  const next = new URLSearchParams({ q, mode, pageno: String(page) });
  return `/search?${next.toString()}`;
}

function QueryResults({
  q,
  mode,
  pageno,
}: {
  q: string;
  mode: SearchMode;
  pageno: number;
}) {
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();

    fetch(
      `/api/search?${new URLSearchParams({
        q,
        mode,
        pageno: String(pageno),
      }).toString()}`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        const payload = (await response.json()) as SearchResponse;
        setData(payload);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setData({
          query: q,
          mode,
          page: pageno,
          results: [],
          status: "error",
          message: error instanceof Error ? error.message : "Search failed",
        });
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [q, mode, pageno]);

  if (loading) {
    return <p className="text-muted">Searching…</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      {mode === "private" ? <PrivateBanner message={data?.message} /> : null}
      {data?.status === "error" ? (
        <p className="text-sm text-red-300">{data.message}</p>
      ) : null}
      {data && data.status !== "error" ? (
        <SearchResults results={data.results} />
      ) : null}
      {data?.status === "ok" ? (
        <nav className="flex items-center gap-4 pt-4 text-sm">
          {pageno > 1 ? (
            <Link
              href={pageHref(q, mode, pageno - 1)}
              className="text-muted hover:text-foreground"
            >
              Previous
            </Link>
          ) : null}
          <span className="text-muted">Page {pageno}</span>
          {data.results.length > 0 ? (
            <Link
              href={pageHref(q, mode, pageno + 1)}
              className="text-muted hover:text-foreground"
            >
              Next
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}

function SearchPageContent() {
  const params = useSearchParams();
  const q = params.get("q")?.trim() ?? "";
  const mode = parseMode(params.get("mode"));
  const pageno = Math.max(1, Number(params.get("pageno") ?? 1) || 1);

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-border px-4 py-4 sm:px-8">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 sm:flex-row sm:items-center">
          <Wordmark compact />
          <div className="flex-1">
            <SearchBar key={`${q}|${mode}`} initialQuery={q} initialMode={mode} compact />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-8">
        {!q ? (
          <p className="text-muted">Type a query to search.</p>
        ) : (
          <QueryResults key={`${q}|${mode}|${pageno}`} q={q} mode={mode} pageno={pageno} />
        )}
      </main>
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="px-8 py-10 text-muted">Loading search…</div>}>
      <SearchPageContent />
    </Suspense>
  );
}
