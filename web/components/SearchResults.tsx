import type { SearchResult } from "@/lib/search/types";

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

type SearchResultsProps = {
  results: SearchResult[];
};

export function SearchResults({ results }: SearchResultsProps) {
  if (results.length === 0) {
    return <p className="text-muted">No results.</p>;
  }

  return (
    <ol className="flex flex-col gap-7">
      {results.map((result) => (
        <li key={`${result.url}-${result.title}`}>
          <a
            href={result.url}
            target="_blank"
            rel="noreferrer"
            className="group block"
          >
            <p className="text-xs text-muted">{hostname(result.url)}</p>
            <h2 className="mt-1 text-lg font-medium text-foreground group-hover:underline">
              {result.title}
            </h2>
            {result.snippet ? (
              <p className="mt-1 text-sm leading-6 text-muted">{result.snippet}</p>
            ) : null}
            {result.engines.length > 0 ? (
              <p className="mt-2 text-xs uppercase tracking-wide text-muted/80">
                {result.engines.join(" · ")}
              </p>
            ) : null}
          </a>
        </li>
      ))}
    </ol>
  );
}
