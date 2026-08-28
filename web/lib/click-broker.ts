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
