# real search

Personal metasearch you run yourself. The UI is Next.js; backends stay behind it. Web search is always over Tor. The toggle is **Web vs Peer to peer**, not Tor vs clearnet.

## Design

- **Web** — [SearXNG](https://docs.searxng.org/) with outbound fetches through a local Tor SOCKS proxy (`socks5h`). Engines: DuckDuckGo, Brave, Wikipedia, Wikidata.
- **Peer to peer** — [YaCy](https://yacy.net/) as a **Robinson private peer** (no public DHT). Its web crawler follows links from `yacy/seeds.txt` into a local index. Search uses `/yacysearch.json?resource=local`.
- **Qdrant** — project database (`pages` collection, 384-d `content` vectors) for later embeddings/ML. Not used for search yet. No Postgres.

A later always-on public/cloud partner is leaving Robinson (`freeworld` / public cluster), not a new search API. Python that embeds YaCy crawls into Qdrant is the next slice.

Expect **~4GB+ RAM**.

## Run

```bash
cp .env.example .env
docker compose up --build
```

Open [http://localhost:3000](http://localhost:3000). Only the Next.js app is published (port 3000).

Tor needs a minute to bootstrap. YaCy is a JVM process and is slower; peer-to-peer results stay empty until the seed crawl has pages. Enter submits a query. The top-right switch is peer-to-peer (off-white Web theme / black P2P theme). The Iron Man control is decorative.

## Environment (`.env`)

| Variable | Purpose |
| --- | --- |
| `SEARXNG_SECRET` | SearXNG secret key. Change it. |
| `YACY_ADMIN_USER` | YaCy admin user (default `admin`) |
| `YACY_ADMIN_PASSWORD` | YaCy admin password (image default is `docker` — change it) |
| `YACY_RESOURCE` | `local` now; `global` later if you leave Robinson |

Crawler start URLs: [yacy/seeds.txt](yacy/seeds.txt). Keep the list small. Depth and page caps are in [yacy/init.sh](yacy/init.sh).

## Services

| Service | Role | Host ports |
| --- | --- | --- |
| `web` | Next.js UI + `/api/search` | `3000` |
| `searxng` | Web metasearch | none |
| `tor` | SOCKS for SearXNG outbound | none (`9050` internal) |
| `valkey` | SearXNG cache | none |
| `yacy` | Robinson index + crawler | none |
| `yacy-init` | Robinson flags + seed crawls | — |
| `qdrant` | Vector DB | none (`6333` internal) |
| `qdrant-init` | Creates `pages` collection | — |

## Layout

```
web/                 Next.js UI and /api/search
searxng/settings.yml JSON API + Tor outgoing proxy
tor/                 Tor SOCKS daemon (not published)
yacy/                Robinson init + crawler seeds
qdrant/              pages collection init
docker-compose.yml
```

## Security

**What Web + Tor protects**

- Upstream search engines see a Tor exit, not your home IP, for SearXNG’s outbound requests.
- `socks5h` keeps DNS for those fetches inside Tor.

**What it does not protect**

- Clicking a result uses your normal browser and your real IP. This is not Tor Browser.
- Your machine still sees every query (Next.js, SearXNG, Valkey, history, localStorage).
- Tor exit nodes see destinations (and the query if an engine is plain HTTP).

**Ports**

- Do not publish Tor `9050`. An open SOCKS port lets others send traffic as your Tor client.
- Do not publish SearXNG, YaCy (`8090`/`8443`), or Qdrant (`6333`). Qdrant has no auth by default. Change `YACY_ADMIN_PASSWORD` in `.env`.

**Robinson crawler**

- Robinson does not join the public YaCy network. The crawler still uses your real IP toward crawled sites.
- Seeds and depth are capped on purpose. A wide crawl is noisy.
- Switching off Robinson later shares index/DHT with strangers. Lock admin auth, TLS, and firewall first.

Do not treat this as anonymous browsing. The Iron Man image is personal-use placeholder art, not branding.
