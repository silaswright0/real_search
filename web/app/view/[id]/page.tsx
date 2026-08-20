"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function ViewPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;
  const [ending, setEnding] = useState(false);

  useEffect(() => {
    if (!id) {
      return;
    }
    const heartbeat = () =>
      fetch(`/api/secure-open/${id}/heartbeat`, {
        method: "POST",
        headers: { "x-real-search-csrf": "1" },
      });
    void heartbeat();
    const timer = window.setInterval(() => void heartbeat(), 15_000);
    return () => window.clearInterval(timer);
  }, [id]);

  async function endSession() {
    if (!id) {
      return;
    }
    setEnding(true);
    await fetch(`/api/secure-open/${id}`, {
      method: "DELETE",
      headers: { "x-real-search-csrf": "1" },
    });
    router.push("/");
  }

  if (!id) {
    return <p className="px-4 py-8 text-muted">Opening sandbox…</p>;
  }

  const vncSrc = `/click-broker/sessions/${id}/vnc/vnc.html?autoconnect=1&resize=remote&path=click-broker/sessions/${id}/vnc/websockify`;

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-4 px-4 py-2 text-sm">
        <p className="text-muted">
          Ephemeral Tor browser. Downloads are blocked. Ending the session destroys the sandbox.
        </p>
        <button
          type="button"
          onClick={() => void endSession()}
          disabled={ending}
          className="border border-foreground px-3 py-1"
        >
          End session
        </button>
      </div>
      <iframe
        title="Secure open"
        src={vncSrc}
        className="min-h-0 w-full flex-1 border-0 bg-black"
      />
    </main>
  );
}
