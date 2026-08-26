import type {
  SearchProvider,
  SearchQuery,
  SearchResponse,
  SearchResult,
} from "@/lib/search/types";

type SearxngHit = {
  url?: string;
  title?: string;
  content?: string;
  engine?: string;
  engines?: string[];
};

type SearxngPayload = {
  results?: SearxngHit[];
};

function searxngBaseUrl(): string {
  return process.env.SEARXNG_URL?.replace(/\/$/, "") ?? "http://localhost:8080";
}

function mapHit(hit: SearxngHit, mode: SearchQuery["mode"]): SearchResult | null {
  if (!hit.url || !hit.title) {
    return null;
  }

  const engines =
    hit.engines?.filter((engine) => engine.length > 0) ??
    (hit.engine ? [hit.engine] : []);

  return {
    title: hit.title,
    url: hit.url,
    snippet: hit.content ?? "",
    engines,
    mode,
  };
}

export const searxngProvider: SearchProvider = {
  async search({ q, mode, pageno }: SearchQuery): Promise<SearchResponse> {
    const url = new URL("/search", searxngBaseUrl());
    const body = new URLSearchParams({
      q,
      format: "json",
      pageno: String(pageno),
    });

    try {
      const response = await fetch(url, {
        method: "POST",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
        },
        body,
        signal: AbortSignal.timeout(35_000),
      });

      if (!response.ok) {
        return {
          query: q,
          mode,
          page: pageno,
          results: [],
          status: "error",
          message: `SearXNG returned ${response.status}`,
        };
      }

      const payload = (await response.json()) as SearxngPayload;
      const results = (payload.results ?? [])
        .map((hit) => mapHit(hit, mode))
        .filter((hit): hit is SearchResult => hit !== null);

      return {
        query: q,
        mode,
        page: pageno,
        results,
        status: "ok",
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to reach SearXNG";
      return {
        query: q,
        mode,
        page: pageno,
        results: [],
        status: "error",
        message,
      };
    }
  },
};
