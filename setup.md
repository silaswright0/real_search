# Setup

Run everything in **WSL 2 Ubuntu** with native **Docker CE** and **gVisor `runsc`**. Docker Desktop is unsupported. Keep this repo on the Linux filesystem (for example `~/src/real_search`), not under `/mnt/c`.

Expect **~5GB+ RAM** with a sandbox open.

## Prerequisites

Confirm these before the first start:

```bash
sudo docker info          # WSL-native daemon, not Docker Desktop
runsc --version           # official gVisor, not Ubuntu's runsc package
sudo docker run --rm --runtime=runsc hello-world
```

The `hello-world` command must succeed. If `runsc` is missing or too old, the sandbox canary fails and sockfilter never starts.

First-time Docker CE + gVisor install: see [README.md](README.md#windows-native-wsl-2--docker-ce--gvisor).

### Version requirements

| Component | Requirement |
| --- | --- |
| Host | WSL 2 with systemd, or native Linux. Docker Desktop is unsupported. |
| Docker | Docker Engine CE from Docker's apt repo (Compose plugin included). |
| `runsc` | Official gVisor **`release-20240801` or later**. Ubuntu's `runsc` package (version like `0.0~20240729.0`) is too old. |
| Kernel | Linux 5.6 or later (WSL 2's Microsoft kernel is fine if `runsc` is new enough). |
| RAM | About 5GB+ with a sandbox open. |

`runsc --version` must look like `release-YYYYMMDD.N`. On kernels where `/proc/sys/net/core/rmem_default` exists in every netns (including recent WSL 2), older `runsc` fails with `cannot run with network enabled in root network namespace` even though Docker created a real netns. Install from [gVisor's apt repo](https://gvisor.dev/docs/user_guide/install/), not `apt install runsc` from Ubuntu.

## First start

From the repo root:

```bash
cp .env.example .env
python3 -c "import secrets; print(secrets.token_hex(32))"
```

Put a **different** 32-byte hex value in each of:

| Variable | Notes |
| --- | --- |
| `SEARXNG_SECRET` | required |
| `QDRANT_API_KEY` | required |
| `CLICK_BROKER_TOKEN` | required; at least 32 characters |
| `VALKEY_PASSWORD` | hex or url-safe only; no `@`, `:`, or `/` |
| `YACY_ADMIN_PASSWORD` | required; longer than 2 characters |
| `YACY_ADMIN_USER` | typically `admin` |
| `YACY_RESOURCE` | leave as `local` |
| `ALLOW_INSECURE_HTTP` | leave as `0` unless you intentionally allow HTTP click targets |

Then set the Docker socket group and start. Use `sudo` for Docker here, matching the prerequisite `sudo docker` checks. If `docker info` already works without `sudo` (your user is in the `docker` group), omit `sudo` and skip the `chown`.

```bash
stat -c %g /var/run/docker.sock    # paste the number into DOCKER_GID in .env
sudo sh gateway/install-egress-firewall.sh
sudo ./build-sandbox.sh            # writes SANDBOX_IMAGE_TAG into .env
sudo chown "$USER:$USER" .env      # the build ran as root
sudo docker compose up --build
sudo docker compose logs -f web
```

## Unlock

1. Open [http://localhost:3000](http://localhost:3000). Do not publish port `3000` on `0.0.0.0`.
2. Copy the one-time startup token from the `web` container logs.
3. Paste it once on the unlock page.

The token is consumed on unlock and cannot be reused from those logs. Restarting `web` mints a new token. Locking the UI without a `web` restart leaves you locked out until the container restarts.

## Later starts

If `.env` is already filled:

```bash
sudo sh gateway/install-egress-firewall.sh
sudo docker compose up --build
sudo docker compose logs -f web
```

Reinstall the nftables rule after every Docker daemon or host-firewall restart. The gateway will refuse to start if it still has direct internet egress.

Rerun `sudo ./build-sandbox.sh` after any change under `browser-sandbox/`, then `sudo docker compose up --build` again. If the build ran as root, `sudo chown "$USER:$USER" .env`.

## Stop

```bash
sudo docker compose down
```

## If it does not start

- **Gateway exits immediately** — nftables is missing or was wiped. Run `sudo sh gateway/install-egress-firewall.sh` again.
- **`tor exited before the loopback SOCKS port opened`** — Tor died during startup. `sudo docker compose logs tor` and read the `[warn]`/`[err]` lines above that message. Rebuild after pulling: `sudo docker compose up --build tor`.
- **Compose stuck on `tor-1 Waiting` / localhost refused** — Tor can be bootstrapped while the SOCKS **gate** on `9050` is not healthy yet. Gateway does not start until Tor is healthy. Check `sudo docker inspect -f '{{.State.Health.Status}}' real-search-tor-1`.
- **sockfilter never becomes healthy** — `runsc` is missing, or the sandbox canary failed. Check `sudo docker compose logs browser-sandbox`.
- **`permission denied` on `docker.sock`** — prefix the command with `sudo`. `DOCKER_GID` does not grant your user Docker access.
- **`unknown or invalid runtime name: runsc`** — the binary is missing or Docker was not restarted after `sudo runsc install`.
- **`cannot run with network enabled in root network namespace`** — `runsc` is too old (Ubuntu's `0.0~*` package). Install official gVisor `release-20240801` or later and run `sudo runsc install` again.
- **Compose interpolation error for `SANDBOX_IMAGE_TAG`** — run `sudo ./build-sandbox.sh` first.
- **Compose interpolation error for `DOCKER_GID`** — set it to `stat -c %g /var/run/docker.sock`.
- **Unlock token rejected** — it was already consumed, or `web` was restarted and a new token was printed. Use the latest `web` log banner.
