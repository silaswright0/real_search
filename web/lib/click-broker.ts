const CSRF_HEADER = "x-real-search-csrf";

export function brokerUrl(): string {
  return process.env.CLICK_BROKER_URL?.replace(/\/$/, "") ?? "http://click-broker:8080";
}

export function brokerHeaders(extra?: HeadersInit): Headers {
  const token = process.env.CLICK_BROKER_TOKEN;
  if (!token || token.length < 32) {
    throw new Error("CLICK_BROKER_TOKEN must be at least 32 characters");
  }
  const headers = new Headers(extra);
  headers.set("x-click-broker-token", token);
  return headers;
}

export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) {
    return false;
  }
  return origin === new URL(request.url).origin;
}

export function isSameOriginMutation(request: Request): boolean {
  return request.headers.get(CSRF_HEADER) === "1" && isSameOriginRequest(request);
}
