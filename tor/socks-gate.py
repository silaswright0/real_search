#!/usr/bin/env python3
"""Require SOCKS5 username/password before any Tor circuit is used."""

from __future__ import annotations

import ipaddress
import os
import secrets
import socket
import threading


TOR_HOST = os.environ.get("TOR_SOCKS_HOST", "127.0.0.1")
TOR_PORT = int(os.environ.get("TOR_SOCKS_PORT", "9051"))
LISTEN_PORT = int(os.environ.get("SOCKS_GATE_PORT", "9050"))
SEARCH_ALLOW = ipaddress.ip_network(os.environ.get("SEARCH_SOCKS_ALLOW", "172.28.0.3/32"))
SANDBOX_ALLOW = ipaddress.ip_network(os.environ.get("SANDBOX_SOCKS_ALLOW", "172.30.0.0/24"))
HANDSHAKE_TIMEOUT = 10.0


def _recv_exact(conn: socket.socket, size: int) -> bytes:
    chunks = bytearray()
    while len(chunks) < size:
        piece = conn.recv(size - len(chunks))
        if not piece:
            raise ConnectionError("connection closed during SOCKS handshake")
        chunks.extend(piece)
    return bytes(chunks)


def _send_all(conn: socket.socket, payload: bytes) -> None:
    conn.sendall(payload)


def _read_rfc1929(conn: socket.socket) -> tuple[str, str]:
    header = _recv_exact(conn, 2)
    if header[0] != 0x01:
        raise ConnectionError("invalid SOCKS5 username/password version")
    user_len = header[1]
    username = _recv_exact(conn, user_len).decode("utf-8", "strict") if user_len else ""
    pass_len = _recv_exact(conn, 1)[0]
    password = _recv_exact(conn, pass_len).decode("utf-8", "strict") if pass_len else ""
    if not username or not password:
        raise ConnectionError("empty SOCKS credentials are not allowed")
    if len(username) > 255 or len(password) > 255:
        raise ConnectionError("SOCKS credentials are too long")
    return username, password


def _client_auth(conn: socket.socket) -> tuple[str, str]:
    greeting = _recv_exact(conn, 2)
    if greeting[0] != 0x05:
        raise ConnectionError("only SOCKS5 is allowed")
    methods = set(_recv_exact(conn, greeting[1]))
    if 0x02 not in methods:
        _send_all(conn, b"\x05\xff")
        raise ConnectionError("unauthenticated SOCKS is rejected")
    _send_all(conn, b"\x05\x02")
    username, password = _read_rfc1929(conn)
    _send_all(conn, b"\x01\x00")
    return username, password


def _tor_auth(tor: socket.socket, username: str, password: str) -> None:
    user_b = username.encode("utf-8")
    pass_b = password.encode("utf-8")
    _send_all(tor, b"\x05\x01\x02")
    reply = _recv_exact(tor, 2)
    if reply != b"\x05\x02":
        raise ConnectionError("Tor did not accept username/password authentication")
    _send_all(tor, bytes([0x01, len(user_b)]) + user_b + bytes([len(pass_b)]) + pass_b)
    status = _recv_exact(tor, 2)
    if status != b"\x01\x00":
        raise ConnectionError("Tor rejected SOCKS credentials")


def _splice(left: socket.socket, right: socket.socket) -> None:
    def pump(src: socket.socket, dst: socket.socket) -> None:
        try:
            while True:
                data = src.recv(65536)
                if not data:
                    break
                dst.sendall(data)
        except OSError:
            pass
        finally:
            try:
                dst.shutdown(socket.SHUT_WR)
            except OSError:
                pass

    threads = [
        threading.Thread(target=pump, args=(left, right), daemon=True),
        threading.Thread(target=pump, args=(right, left), daemon=True),
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()


def _allowed(peer: str, network: ipaddress.IPv4Network) -> bool:
    try:
        return ipaddress.ip_address(peer) in network
    except ValueError:
        return False


def _handle(conn: socket.socket, mint_isolation: bool, allow: ipaddress.IPv4Network) -> None:
    tor: socket.socket | None = None
    try:
        conn.settimeout(HANDSHAKE_TIMEOUT)
        peer = conn.getpeername()[0]
        if not _allowed(peer, allow):
            return
        username, password = _client_auth(conn)
        if mint_isolation:
            username = secrets.token_urlsafe(24)
            password = secrets.token_urlsafe(24)
        tor = socket.create_connection((TOR_HOST, TOR_PORT), timeout=HANDSHAKE_TIMEOUT)
        tor.settimeout(HANDSHAKE_TIMEOUT)
        _tor_auth(tor, username, password)
        conn.settimeout(None)
        tor.settimeout(None)
        _splice(conn, tor)
    except Exception:
        return
    finally:
        conn.close()
        if tor is not None:
            tor.close()


def _dispatch(conn: socket.socket) -> None:
    try:
        peer = conn.getpeername()[0]
    except OSError:
        conn.close()
        return
    if _allowed(peer, SEARCH_ALLOW):
        _handle(conn, True, SEARCH_ALLOW)
        return
    if _allowed(peer, SANDBOX_ALLOW):
        _handle(conn, False, SANDBOX_ALLOW)
        return
    conn.close()


def main() -> None:
    print(f"socks-gate starting uid={os.getuid()}", flush=True)
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    # One wildcard bind. Search vs sandbox is decided by source IP allowlists,
    # not by which container address the client targeted.
    server.bind(("0.0.0.0", LISTEN_PORT))
    server.listen(128)
    print(f"socks-gate listening on 0.0.0.0:{LISTEN_PORT}", flush=True)
    while True:
        conn, _addr = server.accept()
        threading.Thread(target=_dispatch, args=(conn,), daemon=True).start()


if __name__ == "__main__":
    main()
