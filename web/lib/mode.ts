import type { SearchMode } from "@/lib/search/types";

export const MODE_STORAGE_KEY = "real-search-mode";
export const MODE_EVENT = "real-search-mode";

export function parseMode(value: string | null | undefined): SearchMode {
  if (value === "p2p" || value === "private") {
    return "p2p";
  }
  return "web";
}

export function readStoredMode(): SearchMode {
  if (typeof window === "undefined") {
    return "web";
  }
  return parseMode(window.localStorage.getItem(MODE_STORAGE_KEY));
}

export function storeMode(mode: SearchMode): void {
  window.localStorage.setItem(MODE_STORAGE_KEY, mode);
  window.dispatchEvent(new Event(MODE_EVENT));
}
