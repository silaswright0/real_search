"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function ViewPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;
  const [ending, setEnding] = useState(false);
  const [credentials, setCredentials] = useState<{
    token: string;
    password: string;
  } | null>(null);
  const [credentialsLoaded, setCredentialsLoaded] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const fragment = new URLSearchParams(window.location.hash.slice(1));
      const token = fragment.get("token");
      const password = fragment.get("password");
      if (token && password) {
        setCredentials({ token, password });
        window.history.replaceState(
          window.history.state,
          "",
          window.location.pathname,
        );
      }
      setCredentialsLoaded(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

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

  if (!id || !credentialsLoaded) {
    return <p className="px-4 py-8 text-muted">Opening sandbox…</p>;
  }
  if (!credentials) {
    return <p className="px-4 py-8 text-muted">Viewer credentials are missing.</p>;
  }

  const websocketPath = `click-broker/sessions/${id}/vnc/websockify?token=${encodeURIComponent(
    credentials.token,
  )}`;
  const vncFragment = new URLSearchParams({
    autoconnect: "1",
    resize: "remote",
    path: websocketPath,
    password: credentials.password,
  });
  const vncSrc = `/click-broker/sessions/${id}/vnc/vnc.html#${vncFragment.toString()}`;

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
