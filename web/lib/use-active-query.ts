"use client";

import { useSyncExternalStore } from "react";

let activeQuery = "";
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setActiveQuery(query: string): void {
  activeQuery = query;
  for (const listener of listeners) {
    listener();
  }
}

export function readActiveQuery(): string {
  return activeQuery;
}

export function useActiveQuery(): string {
  return useSyncExternalStore(subscribe, readActiveQuery, () => "");
}
