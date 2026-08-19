"use client";

import type { SearchMode } from "@/lib/search/types";

type ModeToggleProps = {
  mode: SearchMode;
  onChange: (mode: SearchMode) => void;
};

export function ModeToggle({ mode, onChange }: ModeToggleProps) {
  const p2p = mode === "p2p";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={p2p}
      aria-label="Peer to peer"
      onClick={() => onChange(p2p ? "web" : "p2p")}
      className="flex items-center gap-2 text-foreground"
    >
      <span className="text-xs uppercase tracking-[0.14em]">Peer to peer</span>
      <span
        className={`relative h-6 w-10 rounded-full border border-foreground ${
          p2p ? "bg-foreground" : "bg-transparent"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full transition-all ${
            p2p
              ? "right-0.5 bg-background"
              : "left-0.5 bg-foreground"
          }`}
        />
      </span>
    </button>
  );
}
