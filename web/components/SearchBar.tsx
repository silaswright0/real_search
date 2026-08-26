"use client";

import { storeMode } from "@/lib/mode";
import { useSearchMode } from "@/lib/use-search-mode";
import { setActiveQuery, useActiveQuery } from "@/lib/use-active-query";
import type { SearchMode } from "@/lib/search/types";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

type SearchBarProps = {
  initialMode?: SearchMode;
};

export function SearchBar({ initialMode }: SearchBarProps) {
  const router = useRouter();
  const activeQuery = useActiveQuery();
  const [query, setQuery] = useState(activeQuery);
  const [mode] = useSearchMode(initialMode);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = query.trim();
    if (!q) {
      return;
    }
    storeMode(mode);
    setActiveQuery(q);
    const params = new URLSearchParams({ mode });
    router.push(`/search?${params.toString()}`);
  }

  return (
    <form
      method="post"
      action="/api/search"
      encType="application/x-www-form-urlencoded"
      onSubmit={onSubmit}
      className="w-full"
    >
      <label htmlFor="q" className="sr-only">
        Search
      </label>
      <input
        id="q"
        name="query"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder=""
        autoFocus
        autoComplete="off"
        className="w-full border border-foreground bg-transparent px-3 py-2 text-base text-foreground outline-none placeholder:text-muted"
      />
      <input type="hidden" name="mode" value={mode} />
      <input type="hidden" name="pageno" value="1" />
    </form>
  );
}
