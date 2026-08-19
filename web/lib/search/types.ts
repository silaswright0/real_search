export type SearchMode = "web" | "p2p";

export type SearchQuery = {
  q: string;
  mode: SearchMode;
  pageno: number;
};

export type SearchResult = {
  title: string;
  url: string;
  snippet: string;
  engines: string[];
  mode: SearchMode;
};

export type SearchStatus = "ok" | "not_implemented" | "error";

export type SearchResponse = {
  query: string;
  mode: SearchMode;
  page: number;
  results: SearchResult[];
  status: SearchStatus;
  message?: string;
};

export interface SearchProvider {
  search(query: SearchQuery): Promise<SearchResponse>;
}
