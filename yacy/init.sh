#!/bin/sh
set -eu

YACY_HOME="/opt/yacy_search_server"
YACY_URL="${YACY_URL:-http://127.0.0.1:8090}"
YACY_USER="${YACY_ADMIN_USER:?YACY_ADMIN_USER is required}"
YACY_PASS="${YACY_ADMIN_PASSWORD:?YACY_ADMIN_PASSWORD is required}"
PASSWD_SH="${YACY_HOME}/bin/passwd.sh"
APICALL_SH="${YACY_HOME}/bin/apicall.sh"

if [ "${#YACY_PASS}" -le 2 ]; then
  echo "YACY_ADMIN_PASSWORD must be longer than 2 characters" >&2
  exit 1
fi

if [ ! -f "${PASSWD_SH}" ]; then
  echo "YaCy passwd.sh is missing at ${PASSWD_SH}" >&2
  exit 1
fi

echo "waiting for YaCy at ${YACY_URL}"
i=0
while [ "$i" -lt 60 ]; do
  if bash -c 'echo > /dev/tcp/127.0.0.1/8090' >/dev/null 2>&1; then
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

echo "rotating YaCy administrator password via passwd.sh"
if [ -x "${PASSWD_SH}" ]; then
  "${PASSWD_SH}" "${YACY_PASS}"
else
  /bin/sh "${PASSWD_SH}" "${YACY_PASS}"
fi

set_prop() {
  key="$1"
  value="$2"
  if [ -x "${APICALL_SH}" ]; then
    if "${APICALL_SH}" "ConfigProperties_p.html?key=${key}&value=${value}" >/dev/null; then
      echo "set ${key}=${value}"
      return 0
    fi
  fi
  if command -v curl >/dev/null 2>&1; then
    if curl -sf -u "${YACY_USER}:${YACY_PASS}" \
      --get \
      --data-urlencode "key=${key}" \
      --data-urlencode "value=${value}" \
      "${YACY_URL}/ConfigProperties_p.html" >/dev/null 2>&1; then
      echo "set ${key}=${value}"
      return 0
    fi
  fi
  echo "failed to set ${key}" >&2
  return 1
}

set_prop "cluster.mode" "privatepeer"
set_prop "allowDistributeIndex" "false"
set_prop "allowReceiveIndex" "false"
set_prop "allowDistributeIndexWhileCrawling" "false"
set_prop "network.unit.domain" "robinson"

echo "YaCy admin password rotated; Robinson mode locked on the internal network"
