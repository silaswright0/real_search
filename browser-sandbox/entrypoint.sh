#!/bin/sh
set -eu

TOR_IP="${TOR_IP:-}"
TOR_PORT="${TOR_PORT:-9050}"
BROKER_IP="${BROKER_IP:-}"
TARGET_URL="${TARGET_URL:-}"
VNC_TOKEN="${VNC_TOKEN:-}"
DISPLAY_NUM="${DISPLAY_NUM:-:1}"
SANDBOX_CANARY="${SANDBOX_CANARY:-0}"

if [ -z "$TARGET_URL" ] || [ -z "$VNC_TOKEN" ] || [ -z "$TOR_IP" ] || [ -z "$BROKER_IP" ]; then
  echo "TARGET_URL, VNC_TOKEN, TOR_IP and BROKER_IP are required" >&2
  exit 1
fi

if ! printf '%s\n' "$TOR_IP" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}$' \
  || ! printf '%s\n' "$BROKER_IP" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}$'; then
  echo "TOR_IP and BROKER_IP must be IPv4 literals" >&2
  exit 1
fi

if ! iptables -P OUTPUT DROP || ! iptables -F OUTPUT; then
  echo "could not enforce IPv4 Tor-only firewall" >&2
  exit 1
fi
iptables -A OUTPUT -o lo -j ACCEPT
iptables -A OUTPUT -p tcp -d "$TOR_IP" --dport "$TOR_PORT" -j ACCEPT
# Statelessly permit only replies from websockify to the broker. gVisor does
# not implement the Linux conntrack matcher.
iptables -A OUTPUT -p tcp -s 0.0.0.0/0 --sport 6080 -d "$BROKER_IP" -j ACCEPT

if ip6tables -P OUTPUT DROP 2>/dev/null && ip6tables -F OUTPUT 2>/dev/null; then
  ip6tables -A OUTPUT -o lo -j ACCEPT
elif [ -s /proc/net/if_inet6 ] \
  && awk '$2 != "01" { found=1 } END { exit found ? 0 : 1 }' /proc/net/if_inet6; then
  echo "could not enforce IPv6 deny policy on an IPv6-enabled interface" >&2
  exit 1
fi

socat TCP-LISTEN:9050,bind=127.0.0.1,fork,reuseaddr TCP:"${TOR_IP}:${TOR_PORT}" &
SOCAT_PID=$!
sleep 0.2

export DISPLAY="$DISPLAY_NUM"
runuser -u sandbox -- install -d -m 700 /home/sandbox/profile
runuser -u sandbox -- install -d -m 700 /home/sandbox/Downloads
runuser -u sandbox -- install -m 600 /opt/firefox-profile/user.js /home/sandbox/profile/user.js
VNC_PASSWORD="$(printf '%s' "$VNC_TOKEN" | sha256sum | cut -c1-8)"
runuser -u vnc -- sh -c 'umask 077; printf "%s: 127.0.0.1:5900\n" "$1" > /tmp/websockify.tokens' sh "$VNC_TOKEN"
runuser -u vnc -- x11vnc -storepasswd "$VNC_PASSWORD" /tmp/vnc.pass >/dev/null
runuser -u vnc -- Xvfb "$DISPLAY_NUM" -screen 0 1280x800x24 -nolisten tcp -ac &
XVFB_PID=$!
sleep 0.6

# Disable X selection exchange at the VNC server boundary. noVNC cannot
# re-enable clipboard synchronization when x11vnc never exposes it.
runuser -u vnc -- x11vnc -display "$DISPLAY_NUM" -forever -shared -rfbauth /tmp/vnc.pass -nosel -localhost -rfbport 5900 >/tmp/x11vnc.log 2>&1 &
VNC_PID=$!

runuser -u vnc -- websockify --web /usr/share/novnc \
  --token-plugin TokenFile --token-source /tmp/websockify.tokens \
  6080 >/tmp/websockify.log 2>&1 &
WS_PID=$!

cleanup() {
  kill "$SOCAT_PID" "$XVFB_PID" "$VNC_PID" "$WS_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

if [ "$SANDBOX_CANARY" = "1" ]; then
  sleep 0.5
  kill -0 "$SOCAT_PID" "$XVFB_PID" "$VNC_PID" "$WS_PID"
  if ! printf 'GET /vnc.html HTTP/1.0\r\n\r\n' \
    | socat -T 3 - TCP:127.0.0.1:6080 \
    | grep -q '200 OK'; then
    echo "noVNC canary failed" >&2
    exit 1
  fi
  SOCKS_REPLY="$(
    printf '\005\001\000' \
      | socat -T 3 - TCP:127.0.0.1:9050 \
      | od -An -tx1 \
      | tr -d ' \n'
  )"
  if [ "$SOCKS_REPLY" != "0500" ]; then
    echo "Tor SOCKS canary failed" >&2
    exit 1
  fi
  echo "runsc sandbox canary passed"
  exit 0
fi

runuser -u sandbox -- env -i DISPLAY="$DISPLAY_NUM" HOME=/home/sandbox \
  LANG=C.UTF-8 PATH=/usr/local/bin:/usr/bin:/bin \
  firefox-esr --profile /home/sandbox/profile --width=1280 --height=800 \
  --new-instance --no-remote "$TARGET_URL" || true

exit 0
