#!/bin/sh
set -eu

TOR_HOST="${TOR_HOST:-tor}"
TOR_PORT="${TOR_PORT:-9050}"
TARGET_URL="${TARGET_URL:-}"
VNC_TOKEN="${VNC_TOKEN:-}"
DISPLAY_NUM="${DISPLAY_NUM:-:1}"

if [ -z "$TARGET_URL" ] || [ -z "$VNC_TOKEN" ]; then
  echo "TARGET_URL and VNC_TOKEN are required" >&2
  exit 1
fi

echo "resolving Tor at ${TOR_HOST}"
TOR_IP="$(getent ahostsv4 "$TOR_HOST" | awk '{ print $1; exit }')"
if [ -z "$TOR_IP" ]; then
  echo "could not resolve ${TOR_HOST}" >&2
  exit 1
fi

if ! iptables -F OUTPUT; then
  echo "could not enforce IPv4 Tor-only firewall" >&2
  exit 1
fi
iptables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -o lo -j ACCEPT
iptables -A OUTPUT -p tcp -d "$TOR_IP" --dport "$TOR_PORT" -j ACCEPT
iptables -A OUTPUT -m conntrack --ctstate NEW -d 10.0.0.0/8 -j REJECT
iptables -A OUTPUT -m conntrack --ctstate NEW -d 172.16.0.0/12 -j REJECT
iptables -A OUTPUT -m conntrack --ctstate NEW -d 192.168.0.0/16 -j REJECT
iptables -A OUTPUT -m conntrack --ctstate NEW -d 169.254.0.0/16 -j REJECT
iptables -P OUTPUT DROP

if ! ip6tables -F OUTPUT 2>/dev/null; then
  echo "could not enforce IPv6 deny policy" >&2
  exit 1
fi
ip6tables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
ip6tables -A OUTPUT -o lo -j ACCEPT
ip6tables -P OUTPUT DROP

socat TCP-LISTEN:9050,bind=127.0.0.1,fork,reuseaddr TCP:"${TOR_IP}:${TOR_PORT}" &
SOCAT_PID=$!
sleep 0.2

export DISPLAY="$DISPLAY_NUM"
install -d -o sandbox -g sandbox -m 700 /home/sandbox/profile
install -o sandbox -g sandbox -m 600 /opt/firefox-profile/user.js /home/sandbox/profile/user.js
VNC_PASSWORD="$(printf '%s' "$VNC_TOKEN" | sha256sum | cut -c1-8)"
printf '%s: 127.0.0.1:5900\n' "$VNC_TOKEN" > /tmp/websockify.tokens
chown vnc:vnc /tmp/websockify.tokens
chmod 600 /tmp/websockify.tokens
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

runuser -u sandbox -- env -i DISPLAY="$DISPLAY_NUM" HOME=/home/sandbox \
  LANG=C.UTF-8 PATH=/usr/local/bin:/usr/bin:/bin \
  firefox-esr --profile /home/sandbox/profile --width=1280 --height=800 \
  --new-instance --no-remote "$TARGET_URL" || true

exit 0
