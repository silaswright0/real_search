#!/bin/sh
set -eu

YACY_URL="${YACY_URL:-http://yacy:8090}"
YACY_USER="${YACY_ADMIN_USER:-admin}"
YACY_PASS="${YACY_ADMIN_PASSWORD:-docker}"

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

set_prop() {
  key="$1"
  value="$2"
  if curl -sf -u "${YACY_USER}:${YACY_PASS}" \
    --get \
    --data-urlencode "key=${key}" \
    --data-urlencode "value=${value}" \
    "${YACY_URL}/ConfigProperties_p.html" >/dev/null 2>&1; then
    echo "set ${key}=${value}"
    return 0
  fi
  echo "failed to set ${key}" >&2
  return 1
}

set_prop "cluster.mode" "privatepeer"
set_prop "allowDistributeIndex" "false"
set_prop "allowReceiveIndex" "false"
set_prop "allowDistributeIndexWhileCrawling" "false"
set_prop "network.unit.domain" "robinson"

echo "YaCy is locked to Robinson mode on an internal network; crawling is unavailable"
