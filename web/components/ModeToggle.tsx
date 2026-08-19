"use client";

import { storeMode } from "@/lib/mode";
import type { SearchMode } from "@/lib/search/types";

type ModeToggleProps = {
  mode: SearchMode;
  onChange: (mode: SearchMode) => void;
};

export function ModeToggle({ mode, onChange }: ModeToggleProps) {
  function select(next: SearchMode) {
    storeMode(next);
    onChange(next);
  }

  return (
    <div
      className="inline-flex rounded-full border border-border bg-surface p-1"
      role="group"
      aria-label="Search mode"
    >
      <button
        type="button"
        onClick={() => select("standard")}
        className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
          mode === "standard"
            ? "bg-standard text-background"
            : "text-muted hover:text-foreground"
        }`}
        aria-pressed={mode === "standard"}
      >
        Standard
      </button>
      <button
        type="button"
        onClick={() => select("private")}
        className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
          mode === "private"
            ? "bg-private text-background"
            : "text-muted hover:text-foreground"
        }`}
        aria-pressed={mode === "private"}
      >
        Private
      </button>
    </div>
  );
}
