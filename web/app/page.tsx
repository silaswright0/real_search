import { SearchBar } from "@/components/SearchBar";
import { Wordmark } from "@/components/Wordmark";

export default function Home() {
  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center px-4">
      <main className="flex w-full max-w-xl flex-col items-center">
        <Wordmark />
        <p className="mt-4 mb-10 max-w-sm text-center text-sm leading-6 text-muted">
          A personal metasearch front end. Standard uses SearXNG. Private will
          later combine Tor routing with YaCy.
        </p>
        <SearchBar />
      </main>
    </div>
  );
}
