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

# Temp files go on the 1777 /tmp tmpfs. Do not chown /var/cache/nginx to
# 0700 nginx: nginx still starts as root and cannot mkdir inside that.
mkdir -p /tmp/nginx_client_temp /tmp/nginx_proxy_temp \
  /tmp/nginx_fastcgi_temp /tmp/nginx_uwsgi_temp /tmp/nginx_scgi_temp
chown nginx:nginx /tmp/nginx_client_temp /tmp/nginx_proxy_temp \
  /tmp/nginx_fastcgi_temp /tmp/nginx_uwsgi_temp /tmp/nginx_scgi_temp

exec /docker-entrypoint.sh nginx -g "daemon off;"
