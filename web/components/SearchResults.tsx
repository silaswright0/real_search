"use client";

import type { SearchResult } from "@/lib/search/types";
import { useRouter } from "next/navigation";
import { useState } from "react";

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

type SearchResultsProps = {
  results: SearchResult[];
};

export function SearchResults({ results }: SearchResultsProps) {
  const router = useRouter();
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (results.length === 0) {
    return <p className="text-muted">No results.</p>;
  }

  async function secureOpen(url: string) {
    setError(null);
    setPendingUrl(url);
    try {
      const response = await fetch("/api/secure-open", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-real-search-csrf": "1",
        },
        body: JSON.stringify({ url }),
      });
      const payload = (await response.json()) as {
        id?: string;
        vncPassword?: string;
        error?: string;
      };
      if (!response.ok || !payload.id || !payload.vncPassword) {
        setError(payload.error ?? "Could not start sandbox");
        return;
      }
      try {
        window.sessionStorage.setItem(
          `real-search:vnc-password:${payload.id}`,
          payload.vncPassword,
        );
      } catch {
        await fetch(`/api/secure-open/${payload.id}`, {
          method: "DELETE",
          headers: { "x-real-search-csrf": "1" },
        });
        setError("Session storage is unavailable; the sandbox was closed.");
        return;
      }
      router.push(`/view/${payload.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start sandbox");
    } finally {
      setPendingUrl(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? <p className="text-sm text-muted">{error}</p> : null}
      <ol className="flex flex-col gap-7">
        {results.map((result) => (
          <li key={`${result.url}-${result.title}`}>
            <p className="text-xs text-muted">{hostname(result.url)}</p>
            <button
              type="button"
              onClick={() => void secureOpen(result.url)}
              disabled={pendingUrl === result.url}
              className="mt-1 text-left text-lg font-medium text-foreground underline-offset-4 hover:underline disabled:opacity-50"
            >
              {result.title}
            </button>
            {result.snippet ? (
              <p className="mt-1 text-sm leading-6 text-muted">{result.snippet}</p>
            ) : null}
            {result.engines.length > 0 ? (
              <p className="mt-2 text-xs uppercase tracking-wide text-muted/80">
                {result.engines.join(" · ")}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
