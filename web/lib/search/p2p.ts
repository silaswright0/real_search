import type {
  SearchProvider,
  SearchQuery,
  SearchResponse,
  SearchResult,
} from "@/lib/search/types";

type YacyItem = {
  title?: string;
  link?: string;
  description?: string;
};

type YacyPayload = {
  channels?: Array<{
    items?: YacyItem[];
  }>;
};

const PAGE_SIZE = 20;

function yacyBaseUrl(): string {
  return process.env.YACY_URL?.replace(/\/$/, "") ?? "http://localhost:8090";
}

function yacyResource(): string {
  return process.env.YACY_RESOURCE === "global" ? "global" : "local";
}

function mapItem(item: YacyItem, mode: SearchQuery["mode"]): SearchResult | null {
  if (!item.link || !item.title) {
    return null;
  }
  return {
    title: item.title,
    url: item.link,
    snippet: item.description ?? "",
    engines: ["yacy"],
    mode,
  };
}

export const p2pSearchProvider: SearchProvider = {
  async search({ q, mode, pageno }: SearchQuery): Promise<SearchResponse> {
    const url = new URL("/yacysearch.json", yacyBaseUrl());
    const body = new URLSearchParams({
      query: q,
      resource: yacyResource(),
      maximumRecords: String(PAGE_SIZE),
      startRecord: String((pageno - 1) * PAGE_SIZE),
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
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        return {
          query: q,
          mode,
          page: pageno,
          results: [],
          status: "error",
          message: `YaCy returned ${response.status}`,
        };
      }

      const payload = (await response.json()) as YacyPayload;
      const items = payload.channels?.[0]?.items ?? [];
      const results = items
        .map((item) => mapItem(item, mode))
        .filter((item): item is SearchResult => item !== null);

      return {
        query: q,
        mode,
        page: pageno,
        results,
        status: "ok",
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to reach YaCy";
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
