#!/bin/sh
set -eu

mkdir -p /var/lib/tor /run/tor
# chmod while still root-owned. CAP_FOWNER is dropped, so chmod after
# chown to tor:tor fails with "Operation not permitted".
chmod 0700 /var/lib/tor /run/tor
chown -R tor:tor /var/lib/tor /run/tor

if ! su-exec tor tor --verify-config -f /etc/tor/torrc; then
  echo "tor configuration is invalid" >&2
  exit 1
fi

# CLI flags beat compiled defaults (including an accidental daemonize).
su-exec tor tor -f /etc/tor/torrc --RunAsDaemon 0 --PidFile /var/lib/tor/tor.pid &
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
    wait "$TOR_PID" || status=$?
    echo "tor exited before the loopback SOCKS port opened (status ${status:-0})" >&2
    echo "scroll up for Tor's own [warn]/[err] lines" >&2
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

k=0
while [ "$k" -lt 50 ]; do
  if python3 /usr/local/bin/tor-healthcheck.py; then
    break
  fi
  if ! kill -0 "$GATE_PID" 2>/dev/null; then
    echo "socks-gate exited before both SOCKS ports opened" >&2
    exit 1
  fi
  k=$((k + 1))
  sleep 1
done
if ! python3 /usr/local/bin/tor-healthcheck.py; then
  echo "socks-gate did not listen on 172.28.0.2:9050 and 172.30.0.2:9050" >&2
  exit 1
fi

wait "$GATE_PID"
