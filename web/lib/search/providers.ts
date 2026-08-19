import { p2pSearchProvider } from "@/lib/search/p2p";
import { searxngProvider } from "@/lib/search/searxng";
import type { SearchMode, SearchProvider } from "@/lib/search/types";

export function getSearchProvider(mode: SearchMode): SearchProvider {
  if (mode === "p2p") {
    return p2pSearchProvider;
  }
  return searxngProvider;
}
