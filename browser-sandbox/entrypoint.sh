#!/bin/sh
set -eu

TOR_IP="${TOR_IP:-}"
TOR_PORT="${TOR_PORT:-9050}"
TOR_SOCKS_USERNAME="${TOR_SOCKS_USERNAME:-}"
TOR_SOCKS_PASSWORD="${TOR_SOCKS_PASSWORD:-}"
BROKER_IP="${BROKER_IP:-}"
TARGET_URL="${TARGET_URL:-}"
VNC_TOKEN="${VNC_TOKEN:-}"
VNC_PASSWORD="${VNC_PASSWORD:-}"
DISPLAY_NUM="${DISPLAY_NUM:-:1}"
SANDBOX_CANARY="${SANDBOX_CANARY:-0}"

if [ -z "$TARGET_URL" ] || [ -z "$VNC_TOKEN" ] || [ -z "$VNC_PASSWORD" ] \
  || [ -z "$TOR_IP" ] || [ -z "$TOR_SOCKS_USERNAME" ] \
  || [ -z "$TOR_SOCKS_PASSWORD" ] || [ -z "$BROKER_IP" ]; then
  echo "target, relay, VNC, Tor authentication and broker settings are required" >&2
  exit 1
fi

if ! printf '%s\n' "$TOR_IP" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}$' \
  || ! printf '%s\n' "$BROKER_IP" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}$'; then
  echo "TOR_IP and BROKER_IP must be IPv4 literals" >&2
  exit 1
fi
if ! printf '%s\n' "$VNC_TOKEN" | grep -Eq '^[A-Za-z0-9_-]{43}$' \
  || ! printf '%s\n' "$VNC_PASSWORD" | grep -Eq '^[A-Za-z0-9]{8}$' \
  || ! printf '%s\n' "$TOR_SOCKS_USERNAME" | grep -Eq '^[A-Za-z0-9_-]{32}$' \
  || ! printf '%s\n' "$TOR_SOCKS_PASSWORD" | grep -Eq '^[A-Za-z0-9_-]{32}$'; then
  echo "sandbox credentials have invalid format" >&2
  exit 1
fi

net_admin_effective() {
  eff_hex="$(awk '/^CapEff:/ { print $2 }' /proc/self/status)"
  eff="$((0x${eff_hex}))"
  # CAP_NET_ADMIN is capability bit 12.
  [ "$((eff & 4096))" -ne 0 ]
}

if [ "${SANDBOX_NET_ADMIN_DROPPED:-0}" != "1" ]; then
  if ! net_admin_effective; then
    echo "NET_ADMIN is required to install the Tor-only firewall" >&2
    exit 1
  fi
  if ! iptables -P OUTPUT DROP || ! iptables -F OUTPUT; then
    echo "could not enforce IPv4 Tor-only firewall" >&2
    iptables -V >&2 || true
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

  # Docker still grants NET_ADMIN at start so iptables can run. Drop it before
  # Firefox or VNC start so a compromised guest cannot rewrite the filter.
  export SANDBOX_NET_ADMIN_DROPPED=1
  exec setpriv \
    --bounding-set=-net_admin \
    --inh-caps=-net_admin \
    --ambient-caps=-net_admin \
    -- /entrypoint.sh
fi

if net_admin_effective; then
  echo "NET_ADMIN remained effective after capability drop" >&2
  exit 1
fi

socat TCP-LISTEN:9050,bind=127.0.0.1,fork,reuseaddr TCP:"${TOR_IP}:${TOR_PORT}" &
SOCAT_PID=$!
sleep 0.2

export DISPLAY="$DISPLAY_NUM"
runuser -u sandbox -- install -d -m 700 /home/sandbox/profile
runuser -u sandbox -- install -d -m 700 /home/sandbox/Downloads
runuser -u sandbox -- install -m 600 /opt/firefox-profile/user.js /home/sandbox/profile/user.js
runuser -u sandbox -- sh -c '
  printf "user_pref(\"network.proxy.socks_username\", \"%s\");\n" "$1"
  printf "user_pref(\"network.proxy.socks_password\", \"%s\");\n" "$2"
' sh "$TOR_SOCKS_USERNAME" "$TOR_SOCKS_PASSWORD" >> /home/sandbox/profile/user.js
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
  if ! kill -0 "$SOCAT_PID" "$XVFB_PID" "$VNC_PID" "$WS_PID"; then
    echo "canary helper process died" >&2
    cat /tmp/x11vnc.log /tmp/websockify.log 2>/dev/null || true
    exit 1
  fi
  if net_admin_effective; then
    echo "canary still has NET_ADMIN" >&2
    exit 1
  fi
  novnc_ok=0
  n=0
  while [ "$n" -lt 10 ]; do
    if printf 'GET /vnc.html HTTP/1.0\r\n\r\n' \
      | socat -T 3 - TCP:127.0.0.1:6080 \
      | grep -q '200 OK'; then
      novnc_ok=1
      break
    fi
    n=$((n + 1))
    sleep 0.3
  done
  if [ "$novnc_ok" != 1 ]; then
    echo "noVNC canary failed" >&2
    cat /tmp/websockify.log 2>/dev/null || true
    exit 1
  fi
  USER_LENGTH="$(printf '%03o' "${#TOR_SOCKS_USERNAME}")"
  PASS_LENGTH="$(printf '%03o' "${#TOR_SOCKS_PASSWORD}")"
  SOCKS_REPLY="$(
    {
      printf '\005\001\002'
      printf "\\001\\${USER_LENGTH}%s\\${PASS_LENGTH}%s" \
        "$TOR_SOCKS_USERNAME" "$TOR_SOCKS_PASSWORD"
    } \
      | socat -T 3 - TCP:127.0.0.1:9050 \
      | od -An -tx1 \
      | tr -d ' \n'
  )"
  case "$SOCKS_REPLY" in
    05020100*) ;;
    *)
      echo "authenticated Tor SOCKS canary failed (reply=${SOCKS_REPLY:-empty})" >&2
      exit 1
      ;;
  esac
  echo "runsc sandbox canary passed"
  exit 0
fi

runuser -u sandbox -- env -i DISPLAY="$DISPLAY_NUM" HOME=/home/sandbox \
  LANG=C.UTF-8 PATH=/usr/local/bin:/usr/bin:/bin \
  firefox-esr --profile /home/sandbox/profile --width=1280 --height=800 \
  --new-instance --no-remote "$TARGET_URL" || true

exit 0
