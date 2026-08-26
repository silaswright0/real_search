# real search

Personal metasearch. Queries go **SearXNG → Tor SOCKS5h**. Result clicks spawn an ephemeral Firefox sandbox with no direct internet; the only egress is Tor. The guest is shown over noVNC. The UI is bound to **127.0.0.1:3000** only.

Toggle is **Web vs Peer to peer**.

## Design

- **Web** — SearXNG through `socks5h://tor:9050` (DuckDuckGo, Brave, Wikipedia, Wikidata).
- **Peer to peer** — YaCy Robinson (no public DHT). Crawling is removed and YaCy runs on an internal network with no internet gateway.
- **Qdrant** — `pages` collection for later embeddings; unused for search.
- **Secure Open** — authenticated `/api/secure-open` → filtered Docker API → disposable Firefox on an **internal** network with Tor → password- and token-protected noVNC via the gateway. An active noVNC WebSocket holds the lease; disconnected sessions expire after 90 seconds.

`SANDBOX_RUNTIME` selects the exact runtime accepted by Compose, the broker, and sockfilter. It defaults to **runc** for Docker Desktop compatibility. On a supported Linux host, set it to **runsc** for gVisor syscall isolation. runc preserves network and process restrictions but shares the Docker VM/host kernel and is materially weaker against container escape.

Expect **~5GB+ RAM** with a sandbox open.

## Run

```bash
cp .env.example .env
# Generate independent values for SEARXNG_SECRET, QDRANT_API_KEY,
# CLICK_BROKER_TOKEN, and a YaCy password:
python -c "import secrets; print(secrets.token_hex(32))"
docker compose up --build
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). Do not publish `3000` on `0.0.0.0`.

Linux hardened runtime: install/register gVisor and set `SANDBOX_RUNTIME=runsc`: https://gvisor.dev/docs/user_guide/install/

Search terms are held only in the current page's JavaScript memory and sent to `/api/search` in a POST body. They are not placed in browser URLs, history, referrers, or nginx access logs. Refreshing or directly reopening `/search` intentionally loses the active query.

## Click hop

Titles do not open the host browser. They start `real-search-browser:local`:

1. HTTPS-only URL allowlist (no loopback/private/decimal IPs or userinfo); HTTP requires `ALLOW_INSECURE_HTTP=1`
2. Join **only** `real-search_sandbox` (`internal: true` — no default gateway to the internet)
3. Firefox SOCKS to `127.0.0.1:9050` (socat to `tor:9050`) and `socks_remote_dns`
4. Tor isolates streams by container source address; iptables accepts replies first, rejects new RFC1918/link-local destinations, and drops every direct-internet path
5. `/tmp` and `/home/sandbox` are ephemeral `noexec,nosuid,nodev` tmpfs mounts
6. Firefox policies plus an aggressive Arkenfox-style profile disable downloads/PDF.js, WebRTC, WebGL, JIT/Wasm, speculative traffic, sensors, and several fingerprint surfaces
7. x11vnc enforces `-nosel` at the display boundary, so clipboard isolation does not depend on a noVNC client setting
8. Each session receives a 256-bit websockify token plus an ephemeral VNC password; credentials arrive in a non-request URL fragment, are immediately erased from host history, and are removed from the Firefox process environment
9. noVNC is proxied at `/click-broker/...` through **nginx** with an internal broker token
10. Destroy on End session, Firefox close, or 90 seconds after the viewer WebSocket disconnects

`sockfilter` is the only service with the Docker socket. It is reachable only from `click-broker` on `real-search_sandbox-admin`; it exact-matches the selected runtime, browser image, environment keys, command, user, network, read-only root, auto-removal, resource limits, tmpfs mounts, security options, and capabilities.

React Strict Mode does **not** delete the session on remount. The broker refreshes the lease while the noVNC WebSocket exists, so browser timer throttling cannot kill a connected session. On restart, the broker removes labeled orphan sandboxes before accepting new sessions.

## Environment

| Variable | Purpose |
| --- | --- |
| `SEARXNG_SECRET` | SearXNG secret |
| `YACY_ADMIN_*` | Required YaCy administrator credentials |
| `YACY_RESOURCE` | `local` |
| `QDRANT_API_KEY` | Required API key for the isolated Qdrant service |
| `CLICK_BROKER_TOKEN` | Required random service token used by Next.js/nginx to authenticate every broker request |
| `SANDBOX_RUNTIME` | `runc` for compatibility or `runsc` for gVisor isolation |
| `ALLOW_INSECURE_HTTP` | `0` by default; set `1` only to permit HTTP targets |

## Services

| Service | Role | Host ports |
| --- | --- | --- |
| `gateway` | nginx: Next.js + WebSocket to broker | `127.0.0.1:3000` |
| `web` | Next.js | none |
| `searxng` | Metasearch | none |
| `tor` | SOCKS (default + sandbox nets) | none |
| `sockfilter` | Allowlisted Docker API | none |
| `click-broker` | Spawn/kill/proxy VNC | none |
| `yacy` | Robinson index | none |
| `qdrant` | Vector DB | none |

## Security

**Search:** engines see a Tor exit. **Click (Secure Open):** the site sees the sandbox’s Tor exit, not Chrome on the host.

Still true: local apps process queries in memory; Tor exits see destinations; source-address circuit isolation does not defeat timing correlation; do not log into personal accounts in the sandbox; Firefox ESR plus hardened preferences is not Tor Browser.

Do not publish Tor `9050`, YaCy, Qdrant, or noVNC. Do not expose the UI beyond loopback without adding auth — an open UI is a Tor browser farm.

Iron Man art is a personal placeholder, not branding.
