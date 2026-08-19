"use client";

import { storeMode } from "@/lib/mode";
import { useSearchMode } from "@/lib/use-search-mode";
import type { SearchMode } from "@/lib/search/types";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

type SearchBarProps = {
  initialQuery?: string;
  initialMode?: SearchMode;
};

export function SearchBar({ initialQuery = "", initialMode }: SearchBarProps) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [mode] = useSearchMode(initialMode);

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

  return (
    <form onSubmit={onSubmit} className="w-full">
      <label htmlFor="q" className="sr-only">
        Search
      </label>
      <input
        id="q"
        name="q"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder=""
        autoFocus
        autoComplete="off"
        className="w-full border border-foreground bg-transparent px-3 py-2 text-base text-foreground outline-none placeholder:text-muted"
      />
    </form>
  );
}
