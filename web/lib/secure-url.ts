export function isPrivateHostname(host: string): boolean {
  const name = host
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^\[/, "")
    .replace(/\]$/, "");
  if (
    name === "localhost" ||
    name === "127.0.0.1" ||
    name === "127.1" ||
    name === "0.0.0.0" ||
    name === "::1" ||
    name === "::ffff:127.0.0.1" ||
    name.endsWith(".local") ||
    name.endsWith(".internal") ||
    name.endsWith(".localhost")
  ) {
    return true;
  }
  if (/^\d+$/.test(name)) {
    return true;
  }
  const parts = name.split(".");
  if (parts.length >= 1 && parts.length <= 4 && parts.every((part) => /^\d+$/.test(part))) {
    const first = Number(parts[0]);
    const second = Number(parts[1] ?? 0);
    if (first === 10 || first === 127 || first === 0) {
      return true;
    }
    if (first === 192 && second === 168) {
      return true;
    }
    if (first === 172 && second >= 16 && second <= 31) {
      return true;
    }
    if (first === 169 && second === 254) {
      return true;
    }
    if (first === 100 && second >= 64 && second <= 127) {
      return true;
    }
  }
  if (name.includes(":")) {
    return true;
  }
  return false;
}

export function parsePublicHttpUrl(raw: string, allowInsecureHttp = false): URL {
  const url = new URL(raw);
  if (url.protocol !== "https:" && !(allowInsecureHttp && url.protocol === "http:")) {
    throw new Error("HTTPS is required");
  }
  if (url.username || url.password) {
    throw new Error("userinfo in URLs is not allowed");
  }
  if (!url.hostname || isPrivateHostname(url.hostname)) {
    throw new Error("private or loopback hosts are not allowed");
  }
  return url;
}
