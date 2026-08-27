#!/bin/sh
set -eu

GATEWAY_IP="${GATEWAY_IP:-172.29.0.2}"
CHAIN="REAL_SEARCH_GATEWAY"

if ! command -v iptables >/dev/null 2>&1; then
  echo "iptables is required on the Docker host" >&2
  exit 1
fi

iptables -N "$CHAIN" 2>/dev/null || true
iptables -F "$CHAIN"
iptables -A "$CHAIN" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A "$CHAIN" -j REJECT

if ! iptables -C DOCKER-USER -s "${GATEWAY_IP}/32" -j "$CHAIN" 2>/dev/null; then
  iptables -I DOCKER-USER 1 -s "${GATEWAY_IP}/32" -j "$CHAIN"
fi

echo "blocked new gateway egress from ${GATEWAY_IP}"
