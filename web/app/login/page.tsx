"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: token.trim() }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Unlock failed");
        return;
      }
      setToken("");
      router.replace("/");
      router.refresh();
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Unlock failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4">
      <form onSubmit={onSubmit} className="flex w-full max-w-sm flex-col gap-4">
        <div>
          <h1 className="text-xl font-medium">Unlock real search</h1>
          <p className="mt-1 text-sm text-muted">
            Paste the one-time startup token from the web container logs. It is
            consumed on unlock and cannot be reused from those logs. Locking the
            UI requires a web container restart to mint a new token.
          </p>
        </div>
        <label htmlFor="startup-token" className="text-sm">
          Startup token
        </label>
        <input
          id="startup-token"
          type="text"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
          required
          className="border border-foreground bg-transparent px-3 py-2 font-mono text-sm text-foreground outline-none"
        />
        {error ? <p className="text-sm text-muted">{error}</p> : null}
        <button
          type="submit"
          disabled={pending}
          className="border border-foreground px-3 py-2 disabled:opacity-50"
        >
          {pending ? "Unlocking…" : "Unlock"}
        </button>
      </form>
    </main>
  );
}
