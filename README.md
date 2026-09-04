# real search

Personal metasearch. Queries go **SearXNG → Tor SOCKS5h**. Result clicks spawn an ephemeral Firefox sandbox with no direct internet; the only egress is Tor. The guest is shown over noVNC. The UI is bound to **localhost:3000** only.

Toggle is **Web vs Peer to peer**.

## Design

- **Web** — SearXNG through `socks5h://tor:9050` (DuckDuckGo, Brave, Wikipedia, Wikidata).
- **Peer to peer** — YaCy Robinson (no public DHT). Crawling is removed and YaCy runs on an internal network with no internet gateway.
- **Qdrant** — `pages` collection for later embeddings; unused for search.
- **Secure Open** — authenticated `/api/secure-open` → filtered Docker API → disposable Firefox on an **internal** network with Tor → password- and token-protected noVNC via the gateway. An active noVNC WebSocket holds the lease; disconnected sessions expire after 90 seconds.

Secure Open requires the **gVisor `runsc` runtime**. Compose, the broker, and
sockfilter all require the exact runtime name `runsc`; there is no `runc`
fallback. Startup fails closed when gVisor is unavailable.

Expect **~5GB+ RAM** with a sandbox open.

## Supported hosts

Trusted mode requires Docker Engine and gVisor on a native Linux kernel
environment:

- **Linux:** supported when `runsc` is installed and registered with Docker.
- **Windows:** supported through a native Docker CE daemon inside a WSL 2 Ubuntu
  distribution, with `runsc` installed in that same distribution.
- **Docker Desktop on Windows or macOS:** unsupported. Do not use its `runc`
  runtime for Secure Open; it does not provide the required gVisor syscall
  boundary. Compose intentionally refuses to start the browser image when the
  `runsc` runtime is absent.
- **macOS trusted mode:** use a separate supported Linux host or VM with native
  Docker Engine and gVisor.

### Windows: native WSL 2 + Docker CE + gVisor

Run the following from an Administrator PowerShell:

```powershell
wsl --install -d Ubuntu-24.04
wsl --update
```

Inside Ubuntu, enable systemd:

```bash
sudo tee /etc/wsl.conf >/dev/null <<'EOF'
[boot]
systemd=true
EOF
```

Then run `wsl --shutdown` from PowerShell and reopen Ubuntu. Install Docker CE
inside WSL 2; do not enable Docker Desktop integration for this distribution:

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg nftables
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
```

Install gVisor from its official apt repository and register `runsc` with that
native Docker daemon:

```bash
curl -fsSL https://gvisor.dev/archive.key \
  | sudo gpg --dearmor -o /usr/share/keyrings/gvisor-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/gvisor-archive-keyring.gpg] https://storage.googleapis.com/gvisor/releases release main" \
  | sudo tee /etc/apt/sources.list.d/gvisor.list >/dev/null
sudo apt update
sudo apt install -y runsc
sudo runsc install
sudo systemctl restart docker
sudo docker run --rm --runtime=runsc hello-world
```

The final command must succeed. Confirm that the client is using the WSL-native
daemon with `sudo docker info`; do not point `DOCKER_HOST` at Docker Desktop.
Keep the repository in the WSL filesystem (for example
`~/src/real_search`), not under `/mnt/c`.

The Docker group is root-equivalent. Either continue using `sudo docker ...` or
deliberately grant the current WSL user access with
`sudo usermod -aG docker "$USER"` and start a new login session.

Official references:

- Docker Engine on Ubuntu: https://docs.docker.com/engine/install/ubuntu/
- gVisor installation: https://gvisor.dev/docs/user_guide/install/
- gVisor Docker quick start: https://gvisor.dev/docs/user_guide/quick_start/docker/

## Run

Step-by-step start, unlock, and troubleshooting: [setup.md](setup.md).

```bash
cp .env.example .env
# Generate independent values for SEARXNG_SECRET, QDRANT_API_KEY,
# CLICK_BROKER_TOKEN, VALKEY_PASSWORD, and a YaCy password:
python -c "import secrets; print(secrets.token_hex(32))"
# SOCKS/Docker host: set DOCKER_GID to `stat -c %g /var/run/docker.sock`
# Required after every Docker daemon/firewall restart. This nftables policy
# blocks all new traffic entering from the host-published gateway bridge.
sudo sh gateway/install-egress-firewall.sh
sudo ./build-sandbox.sh
sudo chown "$USER:$USER" .env
sudo docker compose up --build
sudo docker compose logs -f web
```

Open [http://localhost:3000](http://localhost:3000). Do not publish `3000` on `0.0.0.0`.
Only `localhost:3000` and `127.0.0.1:3000` Host headers are accepted. The web
container prints a one-time startup token at boot; paste it once to unlock.
The token is consumed on unlock and cannot be reused from those logs.
The server then issues a signed, 12-hour HttpOnly local session and a
per-session CSRF token. Restarting `web` mints a new token. The gateway refuses to start if a direct
IPv4 egress probe succeeds. The bridge-based nftables rule is the authoritative
control across both address families and all protocols, while a recurring
guard stops nginx if direct IPv4 egress appears. Reinstall the rule after
Docker or the host firewall is restarted.

Search terms are held only in the current page's JavaScript memory and sent to
`/api/search` in a POST body. They are not placed in browser URLs, referrers, or
nginx access logs. Before React hydration, the form falls back to a same-origin
native POST that returns JSON rather than leaking `?q=...` through a GET.
Refreshing or directly reopening `/search` intentionally loses the active
query.

## Click hop

Titles do not open the host browser. They start the content-pinned
`real-search-browser:<gitsha>-<hash>` image from `./build-sandbox.sh`:

1. HTTPS-only URL allowlist (no loopback/private/decimal IPs or userinfo); HTTP requires `ALLOW_INSECURE_HTTP=1`
2. Join **only** `real-search_sandbox` (`internal: true` — no default gateway to the internet)
3. The broker resolves Tor on the ordinary Docker network before creation and gives runsc literal `TOR_IP` and `BROKER_IP` values; the guest never depends on Docker's `127.0.0.11` DNS
4. Firefox SOCKS to `127.0.0.1:9050` (socat to the literal Tor address) with remote DNS; stateless guest firewall rules permit only Tor SOCKS traffic, loopback, and websockify replies to the broker
5. `/tmp` and `/home/sandbox` are ephemeral `noexec,nosuid,nodev` tmpfs mounts
6. Firefox blocks file-selection dialogs; automatic downloads and disabled-PDF-viewer payloads can only land in bounded RAM-backed tmpfs and disappear with the session
7. x11vnc enforces `-nosel` at the display boundary, so clipboard isolation does not depend on a noVNC client setting
8. Each session receives a 256-bit websockify token in a path-scoped HttpOnly session cookie plus an ephemeral VNC password held briefly in `sessionStorage`; neither credential enters browser URLs
9. The trusted Next.js bundle runs the noVNC RFB client directly. nginx accepts only the WebSocket endpoint, converts the HttpOnly cookie to websockify's internal token query, strips the cookie, and authenticates to the broker
10. Destroy on End session, Firefox close, or 90 seconds after the viewer WebSocket disconnects

`sockfilter` is the only service with the Docker socket. It is reachable only from `click-broker` on `real-search_sandbox-admin`; it rejects unknown create and `HostConfig` keys, exact-matches the mandatory `runsc` runtime, one-core CPU quota, and all other sandbox invariants, then rebuilds a minimal Docker create payload instead of forwarding caller JSON. Python dependencies are transitively pinned with distribution hashes and installed with `--require-hashes`.

`tor` is the only service permitted to create internet flows. `gateway` also
joins `real-search_gateway-ingress` so Docker can publish loopback port 3000,
but nftables drops every new flow entering from its stable
`br-rs-ingress` bridge regardless of source address. The gateway has no
external DNS resolver and drops all capabilities except those required for
nginx to initialize and lower privilege. `gateway`, `web`, and `click-broker` communicate over
`real-search_app-internal`; the additional search, P2P, sandbox, admin, and
vector networks are internal.

Before `sockfilter` receives access to the Docker socket, the
`browser-sandbox` canary runs the real image with `runsc`, the production
capability/tmpfs/network controls, and the real entrypoint. It must bring up
Xvfb, x11vnc, websockify, and socat and complete a Tor SOCKS handshake.

React Strict Mode does **not** delete the session on remount. The broker refreshes the lease while the noVNC WebSocket exists, so browser timer throttling cannot kill a connected session. Capacity is reserved before container creation and reconciled against labeled Docker containers, preventing concurrent requests from bypassing the session limit. Failed removals remain as tombstones, retry with exponential backoff, and count against capacity; startup fails closed if labeled orphans cannot be removed.

## Environment

| Variable | Purpose |
| --- | --- |
| `SEARXNG_SECRET` | SearXNG secret |
| `YACY_ADMIN_*` | Required YaCy administrator credentials; `yacy-init` sets them with `passwd.sh` |
| `YACY_RESOURCE` | `local` |
| `QDRANT_API_KEY` | Required API key for the isolated Qdrant service |
| `CLICK_BROKER_TOKEN` | Required random service token used by Next.js/nginx to authenticate every broker request |
| `VALKEY_PASSWORD` | Required Valkey `requirepass`; SearXNG authenticates with `SEARXNG_VALKEY_URL` |
| `DOCKER_GID` | Host GID that owns `/var/run/docker.sock`; sockfilter runs as uid 1000 in this group |
| `ALLOW_INSECURE_HTTP` | `0` by default; set `1` only to permit HTTP targets |

## Services

| Service | Role | Host ports |
| --- | --- | --- |
| `gateway` | nginx: Next.js + WebSocket to broker | `localhost:3000` |
| `web` | Next.js | none |
| `searxng` | Metasearch | none |
| `tor` | Only internet-egress service; SOCKS for search + sandbox nets | none |
| `sockfilter` | Allowlisted Docker API | none |
| `click-broker` | Spawn/kill/proxy VNC | none |
| `yacy` | Robinson index | none |
| `qdrant` | Vector DB | none |

## Security

**Search:** engines see a Tor exit. **Click (Secure Open):** the site sees the sandbox’s Tor exit, not Chrome on the host.

Still true: local apps process queries in memory; Tor exits see destinations; source-address circuit isolation does not defeat timing correlation; do not log into personal accounts in the sandbox; Firefox ESR plus hardened preferences is not Tor Browser.

Do not publish Tor `9050`, YaCy, Qdrant, or noVNC. Do not expose the UI beyond loopback without adding auth — an open UI is a Tor browser farm.

Iron Man art is a personal placeholder, not branding.
