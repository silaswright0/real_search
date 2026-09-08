#!/bin/sh
set -eu

# chmod only while root-owned. After a restart the tmpfs is already tor:tor,
# and CAP_FOWNER is dropped so chmod would fail.
mkdir -p /var/lib/tor
if [ "$(stat -c %u /var/lib/tor)" = "0" ]; then
  chmod 0700 /var/lib/tor
fi
chown -R tor:tor /var/lib/tor

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
  if python3 /usr/local/bin/tor-healthcheck.py --tor >/dev/null 2>&1; then
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

if ! python3 /usr/local/bin/tor-healthcheck.py --tor >/dev/null 2>&1; then
  echo "tor SOCKS listener did not become ready" >&2
  exit 1
fi

python3 -u /usr/local/bin/socks-gate.py &
GATE_PID=$!
sleep 1

k=0
while [ "$k" -lt 50 ]; do
  if python3 /usr/local/bin/tor-healthcheck.py --gate >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$GATE_PID" 2>/dev/null; then
    wait "$GATE_PID" || status=$?
    echo "socks-gate exited before the SOCKS gate opened (status ${status:-0})" >&2
    exit 1
  fi
  k=$((k + 1))
  sleep 1
done
if ! python3 /usr/local/bin/tor-healthcheck.py --gate; then
  echo "socks-gate did not listen on 127.0.0.1:9050" >&2
  exit 1
fi

wait "$GATE_PID"
