"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export default function ViewPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;
  const [ending, setEnding] = useState(false);
  const [password, setPassword] = useState<string | null>(null);
  const [credentialsLoaded, setCredentialsLoaded] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const screenRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (id && /^[a-f0-9]{32}$/.test(id)) {
        const key = `real-search:vnc-password:${id}`;
        const stored = window.sessionStorage.getItem(key);
        window.sessionStorage.removeItem(key);
        if (stored) {
          setPassword(stored);
        }
      }
      setCredentialsLoaded(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [id]);

  useEffect(() => {
    if (!id || !password || !screenRef.current) {
      return;
    }
    let disposed = false;
    let client: { disconnect(): void } | null = null;
    const target = screenRef.current;
    void import("@novnc/novnc")
      .then(({ default: RFB }) => {
        if (disposed) {
          return;
        }
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const websocketUrl =
          `${protocol}//${window.location.host}` +
          `/click-broker/sessions/${id}/vnc/websockify`;
        const rfb = new RFB(target, websocketUrl, {
          credentials: { password },
        });
        rfb.scaleViewport = true;
        rfb.resizeSession = true;
        rfb.viewOnly = false;
        rfb.addEventListener("securityfailure", () => {
          setConnectionError("VNC authentication failed.");
        });
        rfb.addEventListener("disconnect", (event) => {
          const detail = (event as CustomEvent<{ clean?: boolean }>).detail;
          if (!disposed && !detail?.clean) {
            setConnectionError("The secure browser connection closed.");
          }
        });
        client = rfb;
      })
      .catch(() => {
        if (!disposed) {
          setConnectionError("Could not initialize the secure viewer.");
        }
      });
    return () => {
      disposed = true;
      client?.disconnect();
      target.replaceChildren();
    };
  }, [id, password]);

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
  if (!password) {
    return <p className="px-4 py-8 text-muted">Viewer credentials are missing.</p>;
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-4 px-4 py-2 text-sm">
        <p className="text-muted">
          Downloads are permitted but securely isolated in ephemeral, RAM-backed
          guest storage. They cannot reach your host machine and are destroyed on
          close.
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
      {connectionError ? (
        <p className="px-4 pb-2 text-sm text-muted">{connectionError}</p>
      ) : null}
      <div
        ref={screenRef}
        aria-label="Secure open"
        className="min-h-0 w-full flex-1 overflow-hidden bg-black"
      />
    </main>
  );
}
