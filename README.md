# real search

Personal metasearch. Queries go **SearXNG → Tor SOCKS5h**. Result clicks spawn an ephemeral Firefox sandbox with no direct internet; the only egress is Tor. The guest is shown over noVNC. The UI is bound to **127.0.0.1:3000** only.

Toggle is **Web vs Peer to peer**.

## Design

- **Web** — SearXNG through `socks5h://tor:9050` (DuckDuckGo, Brave, Wikipedia, Wikidata).
- **Peer to peer** — YaCy Robinson (no public DHT). Crawling is removed and YaCy runs on an internal network with no internet gateway.
- **Qdrant** — `pages` collection for later embeddings; unused for search.
- **Secure Open** — authenticated `/api/secure-open` → filtered Docker API → disposable Firefox on an **internal** network with Tor → noVNC via the gateway. Sessions require a 15-second viewer heartbeat and expire after 45 seconds without one.

The sandbox runtime is unconditionally **gVisor `runsc`**. Compose performs an early `runsc` smoke test and the broker always requests `runsc`; deployment or session creation fails if the runtime is unavailable. There is no runc or Kata fallback.

Expect **~5GB+ RAM** with a sandbox open.

## Run

```bash
cp .env.example .env
# Set CLICK_BROKER_TOKEN in .env to this output:
python -c "import secrets; print(secrets.token_hex(32))"
docker compose up --build
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). Do not publish `3000` on `0.0.0.0`.

Install and register gVisor (`runsc`) before starting the stack: https://gvisor.dev/docs/user_guide/install/

## Click hop

Titles do not open the host browser. They start `real-search-browser:local`:

1. URL allowlist (http/https, no loopback/private/decimal IPs, no userinfo)
2. Join **only** `real-search_sandbox` (`internal: true` — no default gateway to the internet)
3. Firefox SOCKS to `127.0.0.1:9050` (socat to `tor:9050`) and `socks_remote_dns`
4. iptables OUTPUT defaults to drop, explicitly rejects RFC1918/link-local destinations, and permits only loopback plus the shared Tor daemon
5. `/tmp` and `/home/sandbox` are ephemeral `noexec,nosuid,nodev` tmpfs mounts
6. Firefox policies plus an aggressive Arkenfox-style profile disable downloads/PDF.js, WebRTC, WebGL, JIT/Wasm, speculative traffic, sensors, and several fingerprint surfaces
7. x11vnc enforces `-nosel` at the display boundary, so clipboard isolation does not depend on a noVNC client setting
8. noVNC is proxied at `/click-broker/...` through **nginx** with an internal broker token
9. Destroy on End session, Firefox close, or heartbeat expiry

`sockfilter` is the only service with the Docker socket. It is reachable only from `click-broker` on `real-search_sandbox-admin`; it requires the browser image, `runsc`, the internal sandbox network, read-only root, constrained tmpfs mounts, and the expected capabilities.

React Strict Mode does **not** delete the session on remount. The viewer heartbeats every 15 seconds; loss of heartbeat destroys the container after 45 seconds.

## Environment

| Variable | Purpose |
| --- | --- |
| `SEARXNG_SECRET` | SearXNG secret |
| `YACY_ADMIN_*` | YaCy admin (change from `docker`) |
| `YACY_RESOURCE` | `local` |
| `CLICK_BROKER_TOKEN` | Required random service token used by Next.js/nginx to authenticate every broker request |

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

Still true: local apps see queries; Tor exits see destinations; query+click timing can correlate; using one Tor daemon does not guarantee one circuit; do not log into personal accounts in the sandbox; Firefox ESR plus hardened preferences is not Tor Browser.

Do not publish Tor `9050`, YaCy, Qdrant, or noVNC. Do not expose the UI beyond loopback without adding auth — an open UI is a Tor browser farm.

Iron Man art is a personal placeholder, not branding.
