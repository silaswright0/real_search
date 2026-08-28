"""Spawn ephemeral Tor-routed Firefox sandboxes and proxy their noVNC UI."""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import ipaddress
import logging
import os
import re
import secrets
import time
from typing import Any
from urllib.parse import urlparse

import docker
from aiohttp import ClientSession, WSMsgType, web
from docker.errors import APIError, NotFound

HEARTBEAT_TIMEOUT_SEC = int(os.environ.get("HEARTBEAT_TIMEOUT_SEC", "90"))
MAX_SESSION_LIFETIME_SEC = int(os.environ.get("MAX_SESSION_LIFETIME_SEC", "900"))
SANDBOX_IMAGE_PREFIX = "real-search-browser"
SANDBOX_VNC_NETWORK = os.environ.get(
    "SANDBOX_VNC_NETWORK",
    "real-search_sandbox-vnc",
)
SANDBOX_EGRESS_NETWORK = os.environ.get(
    "SANDBOX_EGRESS_NETWORK",
    "real-search_sandbox-egress",
)
SANDBOX_TOR_IP = os.environ.get("SANDBOX_TOR_IP", "172.30.0.2")
SANDBOX_BROKER_IP = os.environ.get("SANDBOX_BROKER_IP", "172.32.0.2")
BROKER_LISTEN_HOST = os.environ.get("BROKER_LISTEN_HOST", "172.31.0.4")
SANDBOX_RUNTIME = os.environ.get("SANDBOX_RUNTIME", "runsc").strip() or "runsc"
BROKER_TOKEN = os.environ.get("CLICK_BROKER_TOKEN", "")
MAX_SESSIONS = int(os.environ.get("MAX_SESSIONS", "3"))
ALLOW_INSECURE_HTTP = os.environ.get("ALLOW_INSECURE_HTTP", "0") == "1"
SANDBOX_LABEL = "real-search.sandbox=true"
PINNED_TAG_RE = re.compile(r"^[0-9a-f]{7,40}-[0-9a-f]{12}$")


def _pinned_browser_image() -> str:
    tag = os.environ.get("SANDBOX_IMAGE_TAG", "").strip()
    image = os.environ.get("BROWSER_IMAGE", "").strip()
    if tag and not PINNED_TAG_RE.fullmatch(tag):
        raise RuntimeError(
            "SANDBOX_IMAGE_TAG must be gitsha-contenthash from ./build-sandbox.sh"
        )
    if not image:
        if not tag:
            raise RuntimeError(
                "SANDBOX_IMAGE_TAG is required; run ./build-sandbox.sh"
            )
        image = f"{SANDBOX_IMAGE_PREFIX}:{tag}"
    name, separator, image_tag = image.partition(":")
    if (
        separator != ":"
        or name != SANDBOX_IMAGE_PREFIX
        or image_tag in {"", "local", "latest"}
        or not PINNED_TAG_RE.fullmatch(image_tag)
    ):
        raise RuntimeError(
            "BROWSER_IMAGE must be real-search-browser:<gitsha-contenthash>"
        )
    if tag and image_tag != tag:
        raise RuntimeError("BROWSER_IMAGE does not match SANDBOX_IMAGE_TAG")
    return image


BROWSER_IMAGE = _pinned_browser_image()

if len(BROKER_TOKEN) < 32:
    raise RuntimeError("CLICK_BROKER_TOKEN must be at least 32 characters")
if SANDBOX_RUNTIME != "runsc":
    raise RuntimeError("SANDBOX_RUNTIME must be runsc")
if MAX_SESSION_LIFETIME_SEC < 60 or MAX_SESSION_LIFETIME_SEC > 3600:
    raise RuntimeError("MAX_SESSION_LIFETIME_SEC must be between 60 and 3600")

ID_RE = re.compile(r"^[a-f0-9]{32}$")

LOGGER = logging.getLogger("click-broker")
docker_client = docker.from_env()
sessions: dict[str, dict[str, Any]] = {}
pending_sessions: dict[str, float] = {}
tombstones: dict[str, dict[str, Any]] = {}
state_lock = asyncio.Lock()
docker_lock = asyncio.Lock()


def _is_private_host(host: str) -> bool:
    name = host.lower().rstrip(".").removeprefix("[").removesuffix("]")
    if name in {"localhost", "127.0.0.1", "0.0.0.0", "::1", "127.1", "::ffff:127.0.0.1"}:
        return True
    if name.endswith(".local") or name.endswith(".internal") or name.endswith(".localhost"):
        return True
    try:
        address = ipaddress.ip_address(name)
    except ValueError:
        address = None
    if address is not None:
        return address.version == 6 or not address.is_global
    if ":" in name or name.isdigit():
        return True
    parts = name.split(".")
    if all(p.isdigit() for p in parts) and 1 <= len(parts) <= 4:
        return True
    if all(re.fullmatch(r"(?:0x[0-9a-f]+|[0-9]+)", part) for part in parts):
        return True
    return False


def _tor_socks_credentials() -> tuple[str, str]:
    """Unpredictable per-sandbox SOCKS5 credentials for IsolateSOCKSAuth."""
    return secrets.token_urlsafe(24), secrets.token_urlsafe(24)


def validate_target_url(raw: str) -> str:
    parsed = urlparse(raw.strip())
    if parsed.scheme != "https" and not (
        ALLOW_INSECURE_HTTP and parsed.scheme == "http"
    ):
        raise ValueError("HTTPS is required")
    if parsed.username or parsed.password:
        raise ValueError("userinfo in URLs is not allowed")
    if not parsed.hostname:
        raise ValueError("URL host is required")
    if _is_private_host(parsed.hostname):
        raise ValueError("private or loopback hosts are not allowed")
    return parsed.geturl()


def _sandbox_endpoints() -> tuple[str, str]:
    tor_ip = SANDBOX_TOR_IP
    address = ipaddress.ip_address(tor_ip)
    if address.version != 4 or address.is_loopback or not address.is_private:
        raise OSError("Tor endpoint must be a private sandbox-network IPv4 address")
    broker_ip = SANDBOX_BROKER_IP
    broker_address = ipaddress.ip_address(broker_ip)
    if (
        broker_address.version != 4
        or broker_address.is_loopback
        or not broker_address.is_private
    ):
        raise OSError("broker endpoint must be a private sandbox-network IPv4 address")
    return tor_ip, broker_ip


def _container_ip(container: Any) -> str | None:
    container.reload()
    nets = container.attrs.get("NetworkSettings", {}).get("Networks", {})
    net = nets.get(SANDBOX_VNC_NETWORK)
    if not net:
        return None
    return net.get("IPAddress")


async def _docker_call(function: Any, *args: Any, **kwargs: Any) -> Any:
    async with docker_lock:
        task = asyncio.create_task(asyncio.to_thread(function, *args, **kwargs))
        try:
            return await asyncio.shield(task)
        except asyncio.CancelledError:
            await task
            raise


def _sandbox_container_snapshot_sync() -> dict[str, str]:
    snapshot: dict[str, str] = {}
    containers = docker_client.containers.list(
        all=True,
        filters={"label": SANDBOX_LABEL},
    )
    for container in containers:
        match = re.fullmatch(r"/?click-([a-f0-9]{32})", container.name)
        if match:
            snapshot[match.group(1)] = container.id
    return snapshot


async def _sandbox_container_snapshot() -> dict[str, str]:
    return await _docker_call(_sandbox_container_snapshot_sync)


async def _reserve_session(sid: str) -> tuple[bool, str | None]:
    try:
        actual = await _sandbox_container_snapshot()
    except Exception as exc:
        LOGGER.error("could not reconcile sandbox capacity: %s", exc)
        return False, "sandbox capacity is unavailable"
    async with state_lock:
        occupied = set(actual) | set(sessions) | set(pending_sessions)
        if len(occupied) >= MAX_SESSIONS:
            return False, "too many live sessions"
        pending_sessions[sid] = time.time()
    return True, None


async def _release_reservation(sid: str) -> None:
    async with state_lock:
        pending_sessions.pop(sid, None)


async def _wait_for_vnc(ip: str, timeout: float = 45.0) -> None:
    deadline = time.time() + timeout
    url = f"http://{ip}:6080/"
    async with ClientSession() as http:
        while time.time() < deadline:
            try:
                async with http.get(url, timeout=2) as resp:
                    if resp.status < 500:
                        return
            except Exception:
                await asyncio.sleep(0.4)
        raise TimeoutError("sandbox display did not become ready")


def _remove_container_sync(container_id: str) -> None:
    docker_client.containers.get(container_id).remove(force=True)


async def _attempt_removal(container_id: str, force: bool = False) -> bool:
    async with state_lock:
        tombstone = tombstones.get(container_id)
        if not tombstone:
            return True
        if not force and time.time() < tombstone["next_retry"]:
            return False
    try:
        await _docker_call(_remove_container_sync, container_id)
    except NotFound:
        pass
    except Exception as exc:
        async with state_lock:
            current = tombstones.get(container_id)
            if current:
                current["attempts"] += 1
                current["last_error"] = str(exc)
                current["next_retry"] = time.time() + min(
                    60,
                    2 ** min(current["attempts"], 6),
                )
        LOGGER.error("sandbox removal failed for %s: %s", container_id, exc)
        return False
    async with state_lock:
        tombstones.pop(container_id, None)
    LOGGER.info("sandbox container removed: %s", container_id)
    return True


async def _queue_removal(
    sid: str,
    reason: str,
    container_id: str | None = None,
) -> bool:
    async with state_lock:
        meta = sessions.pop(sid, None)
        pending_sessions.pop(sid, None)
        resolved_id = container_id or (str(meta["container_id"]) if meta else "")
        if not resolved_id:
            resolved_id = next(
                (
                    existing_id
                    for existing_id, existing in tombstones.items()
                    if existing["sid"] == sid
                ),
                "",
            )
        if not resolved_id:
            return True
        tombstones.setdefault(
            resolved_id,
            {
                "sid": sid,
                "reason": reason,
                "attempts": 0,
                "next_retry": 0.0,
                "last_error": "",
            },
        )
    return await _attempt_removal(resolved_id, force=True)


async def _reap_expired() -> None:
    now = time.time()
    async with state_lock:
        expired = [
            (
                sid,
                "maximum session lifetime reached"
                if now - meta["created"] > MAX_SESSION_LIFETIME_SEC
                else "heartbeat expired",
            )
            for sid, meta in sessions.items()
            if now - meta["created"] > MAX_SESSION_LIFETIME_SEC
            or now - meta["last_heartbeat"] > HEARTBEAT_TIMEOUT_SEC
        ]
    for sid, reason in expired:
        await _queue_removal(sid, reason)


@web.middleware
async def require_broker_token(
    request: web.Request,
    handler: Any,
) -> web.StreamResponse:
    supplied = request.headers.get("X-Click-Broker-Token", "")
    if not BROKER_TOKEN or not hmac.compare_digest(supplied, BROKER_TOKEN):
        return web.json_response({"error": "unauthorized"}, status=401)
    return await handler(request)


async def create_session(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid JSON"}, status=400)
    try:
        target = validate_target_url(str(body.get("url", "")))
    except ValueError as exc:
        return web.json_response({"error": str(exc)}, status=400)
    try:
        tor_ip, broker_ip = _sandbox_endpoints()
    except OSError as exc:
        return web.json_response({"error": str(exc)}, status=502)

    sid = secrets.token_hex(16)
    reserved, reservation_error = await _reserve_session(sid)
    if not reserved:
        status = 429 if reservation_error == "too many live sessions" else 503
        return web.json_response({"error": reservation_error}, status=status)
    viewer_token = secrets.token_urlsafe(32)
    relay_token = secrets.token_urlsafe(32)
    vnc_password = "".join(
        secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789")
        for _ in range(8)
    )
    tor_socks_username, tor_socks_password = _tor_socks_credentials()
    kwargs: dict[str, Any] = {
        "image": BROWSER_IMAGE,
        "detach": True,
        "auto_remove": True,
        "name": f"click-{sid}",
        "labels": {"real-search.sandbox": "true"},
        "network": SANDBOX_VNC_NETWORK,
        "cap_drop": ["ALL"],
        "cap_add": ["NET_ADMIN", "SETGID", "SETUID"],
        "security_opt": ["no-new-privileges:true"],
        "tmpfs": {
            "/tmp": "rw,noexec,nosuid,nodev,size=64m",
            "/home/sandbox": "rw,noexec,nosuid,nodev,uid=1000,gid=1000,size=128m",
        },
        "read_only": True,
        "privileged": False,
        "environment": {
            "TARGET_URL": target,
            "TOR_IP": tor_ip,
            "TOR_PORT": "9050",
            "TOR_SOCKS_USERNAME": tor_socks_username,
            "TOR_SOCKS_PASSWORD": tor_socks_password,
            "BROKER_IP": broker_ip,
            "VNC_TOKEN": relay_token,
            "VNC_PASSWORD": vnc_password,
        },
        "mem_limit": "1g",
        "nano_cpus": 1_000_000_000,
        "pids_limit": 256,
        "user": "0",
        "runtime": SANDBOX_RUNTIME,
    }

    try:
        container = await _docker_call(docker_client.containers.create, **kwargs)
        await _docker_call(
            docker_client.api.connect_container_to_network,
            container.id,
            SANDBOX_EGRESS_NETWORK,
        )
        await _docker_call(container.start)
    except Exception as exc:
        await _release_reservation(sid)
        if "container" in locals():
            await _queue_removal(
                sid,
                "sandbox creation failed",
                container_id=container.id,
            )
        detail = exc.explanation if isinstance(exc, APIError) else str(exc)
        LOGGER.error("sandbox creation failed for %s: %s", sid, exc)
        return web.json_response(
            {"error": f"failed to start sandbox: {detail}"},
            status=502,
        )

    ip = None
    try:
        for _ in range(25):
            ip = await _docker_call(_container_ip, container)
            if ip:
                break
            await asyncio.sleep(0.2)
    except asyncio.CancelledError:
        await asyncio.shield(
            _queue_removal(
                sid,
                "sandbox creation cancelled",
                container_id=container.id,
            )
        )
        raise
    except Exception as exc:
        await _queue_removal(
            sid,
            "sandbox network inspection failed",
            container_id=container.id,
        )
        return web.json_response({"error": str(exc)}, status=502)
    if not ip:
        await _queue_removal(
            sid,
            "sandbox joined no network",
            container_id=container.id,
        )
        return web.json_response({"error": "sandbox joined no network"}, status=502)

    try:
        await _wait_for_vnc(ip)
    except asyncio.CancelledError:
        await asyncio.shield(
            _queue_removal(
                sid,
                "sandbox startup cancelled",
                container_id=container.id,
            )
        )
        raise
    except Exception as exc:
        await _queue_removal(
            sid,
            "sandbox display failed",
            container_id=container.id,
        )
        status = 504 if isinstance(exc, TimeoutError) else 502
        return web.json_response({"error": str(exc)}, status=status)

    async with state_lock:
        pending_sessions.pop(sid, None)
        sessions[sid] = {
            "container_id": container.id,
            "ip": ip,
            "created": time.time(),
            "last_heartbeat": time.time(),
            "url": target,
            "viewer_token_hash": hashlib.sha256(viewer_token.encode()).digest(),
            "viewer_claimed": False,
            "viewer_connections": 0,
            "relay_token": relay_token,
        }
    return web.json_response(
        {
            "id": sid,
            "view": f"/view/{sid}",
            "viewerToken": viewer_token,
            "vncPassword": vnc_password,
        }
    )


async def _retry_tombstones(force: bool = False) -> None:
    async with state_lock:
        container_ids = list(tombstones)
    for container_id in container_ids:
        await _attempt_removal(container_id, force=force)


async def _reconcile_sandboxes(force_retry: bool = False) -> bool:
    try:
        actual = await _sandbox_container_snapshot()
    except Exception as exc:
        LOGGER.error("sandbox reconciliation failed: %s", exc)
        return False
    actual_ids = set(actual.values())
    async with state_lock:
        now = time.time()
        for sid, started_at in list(pending_sessions.items()):
            if now - started_at > 90:
                LOGGER.error("stale sandbox reservation released: %s", sid)
                pending_sessions.pop(sid, None)
        known_sids = set(sessions) | set(pending_sessions)
        for sid, container_id in actual.items():
            if sid not in known_sids:
                tombstones.setdefault(
                    container_id,
                    {
                        "sid": sid,
                        "reason": "orphan reconciliation",
                        "attempts": 0,
                        "next_retry": 0.0,
                        "last_error": "",
                    },
                )
        for container_id in list(tombstones):
            if container_id not in actual_ids:
                tombstones.pop(container_id, None)
        for sid, meta in list(sessions.items()):
            if str(meta["container_id"]) not in actual_ids:
                LOGGER.error("sandbox disappeared before cleanup: %s", sid)
                sessions.pop(sid, None)
    await _retry_tombstones(force=force_retry)
    async with state_lock:
        return not tombstones


async def delete_session(request: web.Request) -> web.Response:
    sid = request.match_info["id"]
    if not ID_RE.match(sid):
        return web.json_response({"error": "invalid id"}, status=400)
    removed = await _queue_removal(sid, "explicit deletion")
    return web.json_response({"ok": removed}, status=200 if removed else 503)


async def get_session(request: web.Request) -> web.Response:
    sid = request.match_info["id"]
    meta = sessions.get(sid)
    if not meta:
        return web.json_response({"error": "not found"}, status=404)
    return web.json_response({"id": sid, "url": meta["url"]})


async def proxy_vnc(request: web.Request) -> web.StreamResponse:
    sid = request.match_info["id"]
    rest = request.match_info.get("tail", "")
    meta = sessions.get(sid)
    if not meta:
        return web.Response(status=404, text="session gone")
    if not ID_RE.match(sid):
        return web.Response(status=400, text="invalid id")

    if request.headers.get("Upgrade", "").lower() == "websocket":
        supplied = request.query.get("token", "")
        if not re.fullmatch(r"[A-Za-z0-9_-]{43}", supplied):
            return web.Response(status=401, text="invalid viewer credential")
        supplied_hash = hashlib.sha256(supplied.encode()).digest()
        async with state_lock:
            current = sessions.get(sid)
            if not current or not hmac.compare_digest(
                supplied_hash,
                current["viewer_token_hash"],
            ):
                return web.Response(status=401, text="viewer credential unavailable")
        return await proxy_ws(request, meta["ip"], rest)

    target = f"http://{meta['ip']}:6080/{rest}"
    if request.query_string:
        target = f"{target}?{request.query_string}"

    skip = {"host", "connection", "content-length"}
    headers = {k: v for k, v in request.headers.items() if k.lower() not in skip}
    async with ClientSession() as http:
        async with http.request(
            request.method,
            target,
            headers=headers,
            data=await request.read(),
            allow_redirects=False,
        ) as resp:
            out_headers = {
                k: v
                for k, v in resp.headers.items()
                if k.lower() not in {"transfer-encoding", "connection", "content-encoding"}
            }
            out = web.StreamResponse(status=resp.status, headers=out_headers)
            await out.prepare(request)
            async for chunk in resp.content.iter_chunked(8192):
                await out.write(chunk)
            await out.write_eof()
            return out


async def proxy_ws(request: web.Request, ip: str, rest: str) -> web.WebSocketResponse:
    sid = request.match_info["id"]
    meta = sessions.get(sid)
    if not meta:
        raise web.HTTPNotFound(text="session gone")
    ws_server = web.WebSocketResponse()
    await ws_server.prepare(request)
    path = rest if rest else "websockify"
    url = f"http://{ip}:6080/{path}?token={meta['relay_token']}"
    claimed = False
    try:
        async with state_lock:
            current = sessions.get(sid)
            if not current:
                raise web.HTTPNotFound(text="session gone")
            current["viewer_connections"] = int(current.get("viewer_connections", 0)) + 1
            current["viewer_claimed"] = True
            current["last_heartbeat"] = time.time()
            claimed = True
        async with ClientSession() as http:
            async with http.ws_connect(url) as ws_client:
                meta["last_heartbeat"] = time.time()

                async def hold_lease() -> None:
                    while True:
                        meta["last_heartbeat"] = time.time()
                        await asyncio.sleep(15)

                async def from_client() -> None:
                    async for msg in ws_server:
                        if msg.type == WSMsgType.BINARY:
                            await ws_client.send_bytes(msg.data)
                        elif msg.type == WSMsgType.TEXT:
                            await ws_client.send_str(msg.data)
                        elif msg.type in {WSMsgType.CLOSE, WSMsgType.ERROR}:
                            break

                async def from_sandbox() -> None:
                    async for msg in ws_client:
                        if msg.type == WSMsgType.BINARY:
                            await ws_server.send_bytes(msg.data)
                        elif msg.type == WSMsgType.TEXT:
                            await ws_server.send_str(msg.data)
                        elif msg.type in {WSMsgType.CLOSE, WSMsgType.ERROR}:
                            break

                tasks = [
                    asyncio.create_task(hold_lease()),
                    asyncio.create_task(from_client()),
                    asyncio.create_task(from_sandbox()),
                ]
                done, pending = await asyncio.wait(
                    tasks,
                    return_when=asyncio.FIRST_COMPLETED,
                )
                for task in pending:
                    task.cancel()
                await asyncio.gather(*pending, return_exceptions=True)
                for task in done:
                    task.exception() if not task.cancelled() else None
    finally:
        if claimed:
            async with state_lock:
                current = sessions.get(sid)
                if current:
                    remaining = max(0, int(current.get("viewer_connections", 1)) - 1)
                    current["viewer_connections"] = remaining
                    current["viewer_claimed"] = remaining > 0
                    if remaining == 0:
                        current["last_heartbeat"] = time.time()
                        LOGGER.info(
                            "viewer disconnected from %s; sandbox kept for %ss",
                            sid,
                            HEARTBEAT_TIMEOUT_SEC,
                        )
    return ws_server


async def reap_sessions(_app: web.Application) -> None:
    while True:
        await asyncio.sleep(5)
        await _reap_expired()
        await _reconcile_sandboxes()


async def reaper_context(app: web.Application):
    if not await _reconcile_sandboxes(force_retry=True):
        raise RuntimeError("could not remove orphaned sandbox containers")
    task = asyncio.create_task(reap_sessions(app))
    try:
        yield
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        for sid in list(sessions):
            await _queue_removal(sid, "broker shutdown")
        await _retry_tombstones(force=True)
        if tombstones:
            LOGGER.error("sandbox tombstones remain at shutdown: %s", tombstones)


def build_app() -> web.Application:
    app = web.Application(middlewares=[require_broker_token])
    app.cleanup_ctx.append(reaper_context)
    app.router.add_post("/sessions", create_session)
    app.router.add_get("/sessions/{id}", get_session)
    app.router.add_delete("/sessions/{id}", delete_session)
    app.router.add_route("*", "/sessions/{id}/vnc", proxy_vnc)
    app.router.add_route("*", "/sessions/{id}/vnc/{tail:.*}", proxy_vnc)
    return app


def main() -> None:
    # nginx converts the HttpOnly cookie to websockify's internal token query.
    # Keep that request line out of container logs.
    web.run_app(
        build_app(),
        host=BROKER_LISTEN_HOST,
        port=int(os.environ.get("PORT", "8080")),
        access_log=None,
    )


if __name__ == "__main__":
    main()
