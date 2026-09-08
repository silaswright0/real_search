#!/usr/bin/env python3
"""Probe Tor SOCKS and both public gate binds. BusyBox nc -z is unreliable here."""

from __future__ import annotations

import socket

TARGETS = (
    ("127.0.0.1", 9051),
    ("172.28.0.2", 9050),
    ("172.30.0.2", 9050),
)


def main() -> None:
    for address, port in TARGETS:
        conn = socket.create_connection((address, port), 2)
        conn.close()


if __name__ == "__main__":
    main()
