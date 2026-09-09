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

# Read-only rootfs + cap_drop ALL: nginx cannot mkdir on a 0700 tmpfs it does
# not own, and root cannot write one it does not own without DAC_OVERRIDE.
# Mount cache as root, create the temp dirs, then hand them to nginx (101).
mkdir -p \
  /var/cache/nginx/client_temp \
  /var/cache/nginx/proxy_temp \
  /var/cache/nginx/fastcgi_temp \
  /var/cache/nginx/uwsgi_temp \
  /var/cache/nginx/scgi_temp
# chmod while still root-owned. After chown, cap_drop has no CAP_FOWNER.
chmod 0700 /var/cache/nginx \
  /var/cache/nginx/client_temp \
  /var/cache/nginx/proxy_temp \
  /var/cache/nginx/fastcgi_temp \
  /var/cache/nginx/uwsgi_temp \
  /var/cache/nginx/scgi_temp
chown -R nginx:nginx /var/cache/nginx

exec /docker-entrypoint.sh nginx -g "daemon off;"
