import {
  createHmac,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ALLOWED_HOSTS,
  ALLOWED_ORIGINS,
  CSRF_COOKIE,
  CSRF_HEADER,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from "@/lib/auth-constants";

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const AUTH_DIR = join(tmpdir(), "real-search");
const AUTH_PATH = join(AUTH_DIR, "startup-auth.json");
const STATE_KEY = Symbol.for("real-search.startup-auth");

type LocalSession = {
  csrf: string;
  expiresAt: number;
  value: string;
};

type StartupAuth = {
  sessionSecret: string;
  token: string;
  tokenHash: string;
  consumed: boolean;
};

type StoredAuth = {
  sessionSecret: string;
  token: string;
};

function isBuildPhase(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build";
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftDigest = createHmac("sha256", "real-search-compare").update(left).digest();
  const rightDigest = createHmac("sha256", "real-search-compare").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

function mintAuth(): StartupAuth {
  const token = randomBytes(32).toString("base64url");
  return {
    sessionSecret: randomBytes(32).toString("base64url"),
    token,
    tokenHash: hashToken(token),
    consumed: false,
  };
}

function parseStored(raw: string): StartupAuth | null {
  try {
    const parsed = JSON.parse(raw) as StoredAuth;
    if (!TOKEN_RE.test(parsed.sessionSecret ?? "")) {
      return null;
    }
    const token = parsed.token ?? "";
    if (token && !TOKEN_RE.test(token)) {
      return null;
    }
    return {
      sessionSecret: parsed.sessionSecret,
      token,
      tokenHash: token ? hashToken(token) : "",
      consumed: token === "",
    };
  } catch {
    return null;
  }
}

function readAuthFile(): StartupAuth | null {
  try {
    return parseStored(readFileSync(AUTH_PATH, "utf8"));
  } catch {
    return null;
  }
}

function persistAuth(auth: StartupAuth): void {
  mkdirSync(AUTH_DIR, { recursive: true, mode: 0o700 });
  const payload = JSON.stringify({
    sessionSecret: auth.sessionSecret,
    token: auth.consumed ? "" : auth.token,
  } satisfies StoredAuth);
  const temporary = `${AUTH_PATH}.${process.pid}.tmp`;
  writeFileSync(temporary, payload, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, AUTH_PATH);
}

function writeAuthFileExclusive(auth: StartupAuth): boolean {
  mkdirSync(AUTH_DIR, { recursive: true, mode: 0o700 });
  const payload = JSON.stringify({
    sessionSecret: auth.sessionSecret,
    token: auth.token,
  } satisfies StoredAuth);
  try {
    writeFileSync(AUTH_PATH, payload, { encoding: "utf8", flag: "wx", mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

function cacheAuth(auth: StartupAuth): StartupAuth {
  const existing = globalThis as typeof globalThis & {
    [STATE_KEY]?: StartupAuth;
  };
  existing[STATE_KEY] = auth;
  return auth;
}

function loadStartupAuth(): StartupAuth {
  const existing = globalThis as typeof globalThis & {
    [STATE_KEY]?: StartupAuth;
  };
  if (existing[STATE_KEY]) {
    return existing[STATE_KEY];
  }
  if (isBuildPhase()) {
    throw new Error("startup authentication is not available during build");
  }

  const minted = mintAuth();
  if (!writeAuthFileExclusive(minted)) {
    const fromDisk = readAuthFile();
    if (!fromDisk) {
      throw new Error("could not initialize the localhost startup token");
    }
    return cacheAuth(fromDisk);
  }
  return cacheAuth(minted);
}

function cookieValue(request: Request, name: string): string {
  const prefix = `${name}=`;
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const cookie = part.trim();
    if (cookie.startsWith(prefix)) {
      return cookie.slice(prefix.length);
    }
  }
  return "";
}

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function parseSession(request: Request): LocalSession | null {
  let secret = "";
  try {
    secret = loadStartupAuth().sessionSecret;
  } catch {
    return null;
  }
  const value = cookieValue(request, SESSION_COOKIE);
  const separator = value.lastIndexOf(".");
  if (separator < 1) {
    return null;
  }
  const payload = value.slice(0, separator);
  const suppliedSignature = value.slice(separator + 1);
  const expectedSignature = signature(payload, secret);
  if (!constantTimeEqual(suppliedSignature, expectedSignature)) {
    return null;
  }
  const [expiresRaw, csrf, extra] = payload.split(".");
  const expiresAt = Number(expiresRaw);
  if (
    extra !== undefined ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= Math.floor(Date.now() / 1000) ||
    !TOKEN_RE.test(csrf)
  ) {
    return null;
  }
  return { csrf, expiresAt, value };
}

export function announceStartupToken(): void {
  if (isBuildPhase() || process.env.NEXT_RUNTIME === "edge") {
    return;
  }
  let auth = loadStartupAuth();
  if (auth.consumed) {
    auth = mintAuth();
    persistAuth(auth);
    cacheAuth(auth);
  }
  console.error(
    [
      "",
      "============================================================",
      "real search startup token (one-time; consumed on unlock)",
      "Paste it once at http://127.0.0.1:3000 to unlock.",
      "After unlock it is invalid even if copied from these logs.",
      "",
      `  ${auth.token}`,
      "============================================================",
      "",
    ].join("\n"),
  );
}

export function localAuthConfigurationError(): string | null {
  try {
    loadStartupAuth();
  } catch (error) {
    return error instanceof Error
      ? error.message
      : "startup authentication is unavailable";
  }
  return null;
}

export function isAllowedHost(request: Request): boolean {
  const host = (request.headers.get("host") ?? "").toLowerCase();
  const forwarded = (request.headers.get("x-forwarded-host") ?? "").toLowerCase();
  if (!ALLOWED_HOSTS.includes(host as (typeof ALLOWED_HOSTS)[number])) {
    return false;
  }
  return (
    forwarded === "" ||
    ALLOWED_HOSTS.includes(forwarded as (typeof ALLOWED_HOSTS)[number])
  );
}

export function isAllowedOrigin(request: Request): boolean {
  return ALLOWED_ORIGINS.includes(
    (request.headers.get("origin") ?? "") as (typeof ALLOWED_ORIGINS)[number],
  );
}

export function isAuthenticatedRequest(request: Request): boolean {
  return isAllowedHost(request) && parseSession(request) !== null;
}

export function isAuthorizedMutation(
  request: Request,
  suppliedCsrf = request.headers.get(CSRF_HEADER) ?? "",
): boolean {
  const session = parseSession(request);
  const csrfCookie = cookieValue(request, CSRF_COOKIE);
  return (
    isAllowedHost(request) &&
    isAllowedOrigin(request) &&
    session !== null &&
    TOKEN_RE.test(suppliedCsrf) &&
    constantTimeEqual(suppliedCsrf, session.csrf) &&
    constantTimeEqual(csrfCookie, session.csrf)
  );
}

export function consumeStartupToken(token: string): boolean {
  const supplied = token.trim();
  const auth = readAuthFile() ?? loadStartupAuth();
  cacheAuth(auth);
  const suppliedHash = TOKEN_RE.test(supplied) ? hashToken(supplied) : hashToken("invalid");
  const expectedHash = auth.tokenHash || hashToken("consumed");
  const matches = constantTimeEqual(suppliedHash, expectedHash);
  if (auth.consumed || !auth.tokenHash || !TOKEN_RE.test(supplied) || !matches) {
    return false;
  }
  auth.consumed = true;
  auth.token = "";
  auth.tokenHash = "";
  cacheAuth(auth);
  persistAuth(auth);
  return true;
}

export function createLocalSession(): LocalSession {
  const secret = loadStartupAuth().sessionSecret;
  const csrf = randomBytes(32).toString("base64url");
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = `${expiresAt}.${csrf}`;
  return {
    csrf,
    expiresAt,
    value: `${payload}.${signature(payload, secret)}`,
  };
}
