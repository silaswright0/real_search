"use client";

import { IronManButton } from "@/components/IronManButton";
import { ModeToggle } from "@/components/ModeToggle";
import { useSearchMode } from "@/lib/use-search-mode";
import type { SearchMode } from "@/lib/search/types";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

function AppShellInner({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useSearchMode();
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    document.documentElement.dataset.theme = mode;
  }, [mode]);

  function onModeChange(next: SearchMode) {
    setMode(next);
    const q = params.get("q")?.trim();
    if (pathname === "/search" && q) {
      const nextParams = new URLSearchParams({ q, mode: next });
      router.push(`/search?${nextParams.toString()}`);
    }
  }

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center justify-end gap-3 px-4 py-3 sm:px-6">
        <ModeToggle mode={mode} onChange={onModeChange} />
        <IronManButton />
      </header>
      <div className="h-px w-full bg-foreground" aria-hidden="true" />
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-full flex-col">
          <header className="h-14" />
          <div className="h-px w-full bg-foreground" aria-hidden="true" />
          <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        </div>
      }
    >
      <AppShellInner>{children}</AppShellInner>
    </Suspense>
  );
}
