import Link from "next/link";

type WordmarkProps = {
  compact?: boolean;
};

export function Wordmark({ compact = false }: WordmarkProps) {
  return (
    <Link href="/" className="group inline-flex items-baseline gap-2">
      <span
        className={`font-semibold tracking-tight text-foreground ${
          compact ? "text-xl" : "text-5xl sm:text-6xl"
        }`}
      >
        real
      </span>
      <span
        className={`font-light tracking-[0.18em] uppercase text-muted ${
          compact ? "text-xs" : "text-sm sm:text-base"
        }`}
      >
        search
      </span>
    </Link>
  );
}
