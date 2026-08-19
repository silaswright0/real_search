#!/bin/sh
set -eu

YACY_URL="${YACY_URL:-http://yacy:8090}"
YACY_USER="${YACY_ADMIN_USER:-admin}"
YACY_PASS="${YACY_ADMIN_PASSWORD:-docker}"
SEEDS="${SEEDS_FILE:-/seeds.txt}"

echo "waiting for YaCy at ${YACY_URL}"
i=0
while [ "$i" -lt 60 ]; do
  if curl -sf "${YACY_URL}/Status.html" >/dev/null 2>&1 \
    || curl -sf "${YACY_URL}/" >/dev/null 2>&1; then
    echo "YaCy is up"
    break
  fi
  i=$((i + 1))
  sleep 5
done

if [ "$i" -ge 60 ]; then
  echo "YaCy did not become ready" >&2
  exit 1
fi

# Robinson private peer: no DHT, no index share.
set_prop() {
  key="$1"
  value="$2"
  curl -sf -u "${YACY_USER}:${YACY_PASS}" \
    --get \
    --data-urlencode "key=${key}" \
    --data-urlencode "value=${value}" \
    "${YACY_URL}/ConfigProperties_p.html" >/dev/null 2>&1 \
    || curl -sf -u "${YACY_USER}:${YACY_PASS}" \
      --data-urlencode "${key}=${value}" \
      "${YACY_URL}/ConfigProperties_p.html" >/dev/null 2>&1 \
    || true
}

set_prop "cluster.mode" "privatepeer"
set_prop "allowDistributeIndex" "false"
set_prop "allowReceiveIndex" "false"
set_prop "allowDistributeIndexWhileCrawling" "false"
set_prop "network.unit.domain" "robinson"

echo "starting seed crawls"
if [ ! -f "${SEEDS}" ]; then
  echo "no seeds file at ${SEEDS}" >&2
  exit 0
fi

# shellcheck disable=SC2162
while IFS= read url || [ -n "${url:-}" ]; do
  case "$url" in
    ""|\#*) continue ;;
  esac
  echo "crawl ${url}"
  curl -sf -u "${YACY_USER}:${YACY_PASS}" \
    --get \
    --data-urlencode "crawlingstart=1" \
    --data-urlencode "crawlingMode=url" \
    --data-urlencode "crawlingURL=${url}" \
    --data-urlencode "crawlingDepth=2" \
    --data-urlencode "crawlingDomMaxPages=40" \
    --data-urlencode "range=wide" \
    --data-urlencode "indexText=on" \
    --data-urlencode "indexMedia=off" \
    --data-urlencode "mustmatch=.*" \
    --data-urlencode "crawlingQ=off" \
    "${YACY_URL}/Crawler_p.html" >/dev/null 2>&1 || echo "crawl start failed for ${url}" >&2
done < "${SEEDS}"

echo "YaCy init finished"
