type PrivateBannerProps = {
  message?: string;
};

export function PrivateBanner({ message }: PrivateBannerProps) {
  return (
    <div className="rounded-2xl border border-private/40 bg-private/10 px-4 py-3 text-sm text-foreground">
      <p className="font-medium text-private">Private mode is a stub</p>
      <p className="mt-1 text-muted">
        {message ??
          "Later this will merge Tor-routed SearXNG results with YaCy peer-to-peer search."}
      </p>
    </div>
  );
}
