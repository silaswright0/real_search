#!/usr/bin/env python3
"""Probe Tor SOCKS and the loopback gate bind. BusyBox nc -z hangs on SOCKS."""

from __future__ import annotations

import socket
import sys

TOR = (("127.0.0.1", 9051),)
GATE = (("127.0.0.1", 9050),)


def probe(targets: tuple[tuple[str, int], ...]) -> None:
    for address, port in targets:
        conn = socket.create_connection((address, port), 2)
        conn.close()


def main() -> None:
    mode = sys.argv[1] if len(sys.argv) > 1 else "--all"
    if mode == "--tor":
        probe(TOR)
        return
    if mode == "--gate":
        probe(GATE)
        return
    if mode != "--all":
        raise SystemExit(f"unknown mode {mode}")
    probe(TOR + GATE)


if __name__ == "__main__":
    main()
