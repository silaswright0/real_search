"use client";

import { ModeToggle } from "@/components/ModeToggle";
import { storeMode } from "@/lib/mode";
import { useSearchMode } from "@/lib/use-search-mode";
import type { SearchMode } from "@/lib/search/types";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

type SearchBarProps = {
  initialQuery?: string;
  initialMode?: SearchMode;
  compact?: boolean;
};

export function SearchBar({
  initialQuery = "",
  initialMode,
  compact = false,
}: SearchBarProps) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [mode, setMode] = useSearchMode(initialMode);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = query.trim();
    if (!q) {
      return;
    }
    storeMode(mode);
    const params = new URLSearchParams({ q, mode });
    router.push(`/search?${params.toString()}`);
  }

  function onModeChange(next: SearchMode) {
    setMode(next);
    if (compact && query.trim()) {
      const params = new URLSearchParams({ q: query.trim(), mode: next });
      router.push(`/search?${params.toString()}`);
    }
  }

  return (
    <form onSubmit={onSubmit} className="w-full">
      <label htmlFor="q" className="sr-only">
        Search
      </label>
      <div
        className={`flex w-full items-center gap-2 rounded-2xl border border-border bg-surface shadow-[0_0_0_1px_rgba(255,255,255,0.02)] focus-within:border-standard/70 ${
          compact ? "px-4 py-2.5" : "px-5 py-3.5"
        }`}
      >
        <input
          id="q"
          name="q"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Ask the open web"
          autoFocus={!compact}
          className={`w-full bg-transparent text-foreground outline-none placeholder:text-muted ${
            compact ? "text-base" : "text-lg"
          }`}
        />
        <input type="hidden" name="mode" value={mode} />
        <button
          type="submit"
          className="shrink-0 rounded-xl bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90"
        >
          Search
        </button>
      </div>
      <div className={`flex ${compact ? "mt-3" : "mt-5"} justify-center`}>
        <ModeToggle mode={mode} onChange={onModeChange} />
      </div>
    </form>
  );
}
