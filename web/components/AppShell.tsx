"use client";

import { IronManButton } from "@/components/IronManButton";
import { ModeToggle } from "@/components/ModeToggle";
import { csrfHeaders, useCsrfToken } from "@/lib/csrf-context";
import { useSearchMode } from "@/lib/use-search-mode";
import type { SearchMode } from "@/lib/search/types";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useEffect } from "react";

function AppShellInner({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useSearchMode();
  const pathname = usePathname();
  const router = useRouter();
  const csrfToken = useCsrfToken();

  useEffect(() => {
    document.documentElement.dataset.theme = mode;
  }, [mode]);

  function onModeChange(next: SearchMode) {
    setMode(next);
    if (pathname === "/search") {
      const nextParams = new URLSearchParams({ mode: next });
      router.push(`/search?${nextParams.toString()}`);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: csrfHeaders(csrfToken),
    });
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center justify-end gap-3 px-4 py-3 sm:px-6">
        {pathname === "/login" ? null : (
          <>
            <ModeToggle mode={mode} onChange={onModeChange} />
            <IronManButton />
            <button
              type="button"
              onClick={() => void logout()}
              className="text-xs text-muted hover:text-foreground"
            >
              Lock
            </button>
          </>
        )}
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
