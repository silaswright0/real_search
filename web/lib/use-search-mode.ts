"use client";

import { MODE_EVENT, readStoredMode, storeMode } from "@/lib/mode";
import type { SearchMode } from "@/lib/search/types";
import { useCallback, useSyncExternalStore } from "react";

function subscribeMode(onStoreChange: () => void): () => void {
  window.addEventListener(MODE_EVENT, onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    window.removeEventListener(MODE_EVENT, onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

export function useSearchMode(override?: SearchMode): [SearchMode, (mode: SearchMode) => void] {
  const stored = useSyncExternalStore(
    subscribeMode,
    readStoredMode,
    (): SearchMode => "standard",
  );
  const mode = override ?? stored;
  const setMode = useCallback((next: SearchMode) => {
    storeMode(next);
  }, []);
  return [mode, setMode];
}
