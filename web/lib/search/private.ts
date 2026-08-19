import type {
  SearchProvider,
  SearchQuery,
  SearchResponse,
} from "@/lib/search/types";

export const privateSearchProvider: SearchProvider = {
  async search({ q, mode, pageno }: SearchQuery): Promise<SearchResponse> {
    return {
      query: q,
      mode,
      page: pageno,
      results: [],
      status: "not_implemented",
      message:
        "Private mode will merge Tor-routed SearXNG results with YaCy peer-to-peer search. That path is not wired yet.",
    };
  },
};
