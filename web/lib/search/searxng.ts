import type {
  SearchProvider,
  SearchQuery,
  SearchResponse,
  SearchResult,
} from "@/lib/search/types";

type SearxngLink = {
  url?: string;
};

type SearxngHit = {
  url?: string;
  title?: string;
  content?: string;
  engine?: string;
  engines?: string[];
  infobox?: string;
  urls?: SearxngLink[];
};

type SearxngPayload = {
  results?: SearxngHit[];
  unresponsive_engines?: unknown;
};

function searxngBaseUrl(): string {
  return process.env.SEARXNG_URL?.replace(/\/$/, "") ?? "http://localhost:8080";
}

const ENGINE_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,40}$/;

function httpUrl(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function unresponsiveEngines(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const names = new Set<string>();
  for (const item of value) {
    const raw = Array.isArray(item) ? item[0] : undefined;
    if (typeof raw === "string" && ENGINE_NAME.test(raw)) {
      names.add(raw);
    }
  }
  return [...names];
}

function mapHit(hit: SearxngHit, mode: SearchQuery["mode"]): SearchResult | null {
  const url = httpUrl(hit.url) ?? httpUrl(hit.urls?.find((link) => link.url)?.url);
  const title = hit.title || hit.infobox;
  if (!url || !title) {
    return null;
  }

  const engines =
    hit.engines?.filter((engine) => engine.length > 0) ??
    (hit.engine ? [hit.engine] : []);

  return {
    title,
    url,
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
      const failed = unresponsiveEngines(payload.unresponsive_engines);

      if (results.length === 0 && failed.length > 0) {
        return {
          query: q,
          mode,
          page: pageno,
          results,
          status: "error",
          message: `No engine answered (${failed.join(", ")})`,
        };
      }

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
