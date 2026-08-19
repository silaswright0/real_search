# real search

Personal metasearch you run yourself. The UI is Next.js; search backends stay behind it so the browser never talks to them directly.

## Design

Tor is the **transport**, not a mode. Outbound SearXNG fetches should always go through a Tor daemon (SOCKS) so upstream engines see a Tor exit, not your IP. The Next.js app and SearXNG stay on the local Docker network.

The UI toggle is **peer-to-peer**, not Tor vs “regular”:

- **Web** — SearXNG over Tor
- **Web + P2P** — same Tor path, plus [YaCy](https://yacy.net/) results merged in

Do not make clearnet-vs-Tor the main switch. A fast clearnet path can exist later as an advanced/fallback option, not the default. YaCy peering is its own network; routing YaCy itself through Tor is optional and slower.

SearXNG engines that CAPTCHA or block Tor exits should be dropped in favor of a Tor-tolerant set (for example DuckDuckGo, Brave, Wikipedia, onion indexes such as Ahmia).

## Current status (v1)

There is **no Tor daemon yet**, and YaCy is not wired. Docker runs three services: the web app, [SearXNG](https://docs.searxng.org/), and Valkey.

The UI still labels the toggle **Standard / Private**. Standard is live SearXNG on clearnet. Private is a stub that shows a “not wired yet” banner. Both labels should become **Web / Web + P2P** when Tor and YaCy land.

## Run

```bash
cp .env.example .env
docker compose up --build
```

Open [http://localhost:3000](http://localhost:3000). Only the Next.js app is published (port 3000). SearXNG stays on the Docker network.

## Layout

```
web/                 Next.js App Router UI and /api/search
searxng/settings.yml JSON API enabled
docker-compose.yml   web + searxng + valkey
```

Search providers live in `web/lib/search/`. That is where the Tor SOCKS client and YaCy merge should plug in, along with a Python API, Postgres, and ranking/ML.
