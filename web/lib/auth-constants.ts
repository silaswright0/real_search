export const SESSION_COOKIE = "real_search_session";
export const CSRF_COOKIE = "real_search_csrf";
export const CSRF_HEADER = "x-real-search-csrf";
export const SESSION_TTL_SECONDS = 12 * 60 * 60;
export const ALLOWED_HOSTS = ["127.0.0.1:3000", "localhost:3000"] as const;
export const ALLOWED_ORIGINS = [
  "http://127.0.0.1:3000",
  "http://localhost:3000",
] as const;
