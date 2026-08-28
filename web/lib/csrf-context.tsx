"use client";

import { CSRF_HEADER } from "@/lib/auth-constants";
import { createContext, useContext } from "react";

const CsrfContext = createContext("");

export function CsrfProvider({
  children,
  token,
}: {
  children: React.ReactNode;
  token: string;
}) {
  return <CsrfContext.Provider value={token}>{children}</CsrfContext.Provider>;
}

export function useCsrfToken(): string {
  return useContext(CsrfContext);
}

export function csrfHeaders(token: string, extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set(CSRF_HEADER, token);
  return headers;
}
