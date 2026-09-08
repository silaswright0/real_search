#!/bin/sh
set -eu

INGRESS_BRIDGE="${INGRESS_BRIDGE:-br-rs-ingress}"
TOR_BRIDGE="${TOR_BRIDGE:-br-rs-tor}"
SANDBOX_BRIDGE="${SANDBOX_BRIDGE:-br-rs-sandbox}"
VNC_BRIDGE="${VNC_BRIDGE:-br-rs-vnc}"
TOR_CONTAINER_IP="${TOR_CONTAINER_IP:-172.27.0.2}"
TOR_SOCKS_IP="${TOR_SOCKS_IP:-172.30.0.2}"
SANDBOX_EGRESS_NET="${SANDBOX_EGRESS_NET:-172.30.0.0/24}"
BROKER_VNC_IP="${BROKER_VNC_IP:-172.32.0.2}"
SANDBOX_VNC_NET="${SANDBOX_VNC_NET:-172.32.0.0/24}"
TABLE="real_search_gateway"

if ! command -v nft >/dev/null 2>&1; then
  echo "nftables is required on the Docker host" >&2
  exit 1
fi

nft delete table inet "$TABLE" 2>/dev/null || true
nft -f - <<EOF
table inet $TABLE {
  chain forward {
    type filter hook forward priority -20; policy accept;

    # Only replies belonging to Docker's host-port DNAT may leave the ingress
    # interface. New IPv4/IPv6, TCP/UDP and spoofed-source flows are dropped.
    iifname "$INGRESS_BRIDGE" ct state established,related ct status dnat accept
    iifname "$INGRESS_BRIDGE" counter drop

    # The external bridge is exclusive to Tor. Reject source spoofing, IPv6,
    # non-TCP traffic, and every non-global IPv4 destination so a compromised
    # Tor process cannot scan the host, LAN, metadata, multicast, or link-local
    # ranges. Established return traffic is accepted by the normal Docker path.
    iifname "$TOR_BRIDGE" meta nfproto ipv6 counter drop
    iifname "$TOR_BRIDGE" ip saddr != "$TOR_CONTAINER_IP" counter drop
    iifname "$TOR_BRIDGE" ip daddr {
      0.0.0.0/8,
      10.0.0.0/8,
      100.64.0.0/10,
      127.0.0.0/8,
      169.254.0.0/16,
      172.16.0.0/12,
      192.0.0.0/24,
      192.168.0.0/16,
      198.18.0.0/15,
      224.0.0.0/4,
      240.0.0.0/4
    } counter drop
    iifname "$TOR_BRIDGE" meta l4proto tcp accept
    iifname "$TOR_BRIDGE" counter drop

    # gVisor guests cannot load xtables. Same OUTPUT policy on the host:
    # sandbox-egress may only reach Tor SOCKS; sandbox-vnc may only exchange
    # websockify (6080) with the broker.
    iifname "$SANDBOX_BRIDGE" meta nfproto ipv6 counter drop
    ip saddr $SANDBOX_EGRESS_NET ip daddr $TOR_SOCKS_IP tcp dport 9050 accept
    ip saddr $TOR_SOCKS_IP tcp sport 9050 ip daddr $SANDBOX_EGRESS_NET accept
    ip saddr $SANDBOX_EGRESS_NET counter drop
    iifname "$SANDBOX_BRIDGE" counter drop

    iifname "$VNC_BRIDGE" meta nfproto ipv6 counter drop
    ip saddr $BROKER_VNC_IP ip daddr $SANDBOX_VNC_NET tcp dport 6080 accept
    ip saddr $SANDBOX_VNC_NET ip daddr $BROKER_VNC_IP tcp sport 6080 accept
    ip saddr $SANDBOX_VNC_NET counter drop
    iifname "$VNC_BRIDGE" counter drop
  }
}
EOF

nft list table inet "$TABLE" >/dev/null
echo "enforced gateway deny, Tor-only public TCP, and sandbox host firewall"
