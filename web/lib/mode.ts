import type { SearchMode } from "@/lib/search/types";

export const MODE_STORAGE_KEY = "real-search-mode";
export const MODE_EVENT = "real-search-mode";

export function parseMode(value: string | null | undefined): SearchMode {
  return value === "private" ? "private" : "standard";
}

export function readStoredMode(): SearchMode {
  if (typeof window === "undefined") {
    return "standard";
  }
  return parseMode(window.localStorage.getItem(MODE_STORAGE_KEY));
}

export function storeMode(mode: SearchMode): void {
  window.localStorage.setItem(MODE_STORAGE_KEY, mode);
  window.dispatchEvent(new Event(MODE_EVENT));
}
