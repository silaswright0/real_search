export const VIEWER_COOKIE = "real_search_vnc";

export function viewerWebsocketPath(id: string): string {
  return `/click-broker/sessions/${id}/vnc/websockify`;
}

export function secureCookieFor(request: Request): boolean {
  const forwarded = request.headers.get("x-forwarded-proto");
  return forwarded === "https" || (!forwarded && new URL(request.url).protocol === "https:");
}
