"use client";

import { SearchBar } from "@/components/SearchBar";
import { SearchResults } from "@/components/SearchResults";
import { csrfHeaders, useCsrfToken } from "@/lib/csrf-context";
import { parseMode } from "@/lib/mode";
import type { SearchMode, SearchResponse } from "@/lib/search/types";
import { useActiveQuery } from "@/lib/use-active-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

function pageHref(mode: SearchMode, page: number): string {
  const next = new URLSearchParams({ mode, pageno: String(page) });
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
  const csrfToken = useCsrfToken();

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/search", {
      method: "POST",
      headers: csrfHeaders(csrfToken, {
        "content-type": "application/json",
      }),
      body: JSON.stringify({ query: q, mode, pageno }),
      cache: "no-store",
      signal: controller.signal,
    })
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
  }, [csrfToken, q, mode, pageno]);

  if (loading) {
    return <p className="text-muted">Searching…</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      {data?.status === "error" ? (
        <p className="text-sm text-muted">{data.message}</p>
      ) : null}
      {data && data.status !== "error" ? (
        <SearchResults results={data.results} />
      ) : null}
      {data?.status === "ok" && data.results.length > 0 ? (
        <nav className="flex items-center gap-4 pt-4 text-sm">
          {pageno > 1 ? (
            <Link
              href={pageHref(mode, pageno - 1)}
              className="text-muted hover:text-foreground"
            >
              Previous
            </Link>
          ) : null}
          <span className="text-muted">Page {pageno}</span>
          <Link
            href={pageHref(mode, pageno + 1)}
            className="text-muted hover:text-foreground"
          >
            Next
          </Link>
        </nav>
      ) : null}
    </div>
  );
}

function SearchPageContent() {
  const params = useSearchParams();
  const q = useActiveQuery();
  const mode = parseMode(params.get("mode"));
  const pageno = Math.min(
    100,
    Math.max(1, Math.floor(Number(params.get("pageno") ?? 1) || 1)),
  );

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-8 px-4 py-8">
      <SearchBar key={mode} initialMode={mode} />
      {!q ? (
        <p className="text-muted">Type a query to search.</p>
      ) : (
        <QueryResults key={`${q}|${mode}|${pageno}`} q={q} mode={mode} pageno={pageno} />
      )}
    </main>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="px-8 py-10 text-muted">Loading search…</div>}>
      <SearchPageContent />
    </Suspense>
  );
}
