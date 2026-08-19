import { privateSearchProvider } from "@/lib/search/private";
import { searxngProvider } from "@/lib/search/searxng";
import type { SearchMode, SearchProvider } from "@/lib/search/types";

export function getSearchProvider(mode: SearchMode): SearchProvider {
  if (mode === "private") {
    return privateSearchProvider;
  }
  return searxngProvider;
}
