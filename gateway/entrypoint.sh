#!/bin/sh
set -eu

# gateway-ingress is intentionally host-reachable. Refuse to proxy sensitive
# requests if the host bridge policy does not block new outbound connections.
if wget -q -T 3 -O /dev/null http://1.1.1.1/ 2>/dev/null; then
  echo "gateway has direct internet egress; install the nftables policy" >&2
  exit 1
fi

(
  while sleep 10; do
    if wget -q -T 3 -O /dev/null http://1.1.1.1/ 2>/dev/null; then
      echo "gateway egress policy disappeared; stopping nginx" >&2
      kill -TERM 1
      exit 1
    fi
  done
) &

exec /docker-entrypoint.sh nginx -g "daemon off;"
