#!/bin/sh
set -eu

mkdir -p /var/lib/tor
# chmod while still root-owned. CAP_FOWNER is dropped, so chmod after
# chown to tor:tor fails with "Operation not permitted".
chmod 0700 /var/lib/tor
chown -R tor:tor /var/lib/tor

su-exec tor tor -f /etc/tor/torrc &
TOR_PID=$!
GATE_PID=""

cleanup() {
  kill "$TOR_PID" ${GATE_PID:+"$GATE_PID"} 2>/dev/null || true
}
trap cleanup EXIT INT TERM

i=0
while [ "$i" -lt 60 ]; do
  if nc -z 127.0.0.1 9051; then
    break
  fi
  if ! kill -0 "$TOR_PID" 2>/dev/null; then
    echo "tor exited before the loopback SOCKS port opened" >&2
    exit 1
  fi
  i=$((i + 1))
  sleep 1
done

if ! nc -z 127.0.0.1 9051; then
  echo "tor SOCKS listener did not become ready" >&2
  exit 1
fi

su-exec tor python3 /usr/local/bin/socks-gate.py &
GATE_PID=$!

wait "$GATE_PID"
