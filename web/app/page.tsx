import { SearchBar } from "@/components/SearchBar";

export default function Home() {
  return (
    <main className="flex flex-1 items-center justify-center px-4">
      <div className="w-full max-w-xl">
        <SearchBar />
      </div>
    </main>
  );
}
