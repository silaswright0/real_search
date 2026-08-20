"""Spawn ephemeral Tor-routed Firefox sandboxes and proxy their noVNC UI."""

from __future__ import annotations

import asyncio
import hmac
import os
import re
import secrets
import time
from typing import Any
from urllib.parse import urlparse

import docker
from aiohttp import ClientSession, WSMsgType, web
from docker.errors import APIError, NotFound

HEARTBEAT_TIMEOUT_SEC = int(os.environ.get("HEARTBEAT_TIMEOUT_SEC", "45"))
BROWSER_IMAGE = os.environ.get("BROWSER_IMAGE", "real-search-browser:local")
SANDBOX_NETWORK = os.environ.get("SANDBOX_NETWORK", "real-search_sandbox")
TOR_HOST = os.environ.get("TOR_HOST", "tor")
SANDBOX_RUNTIME = "runsc"
BROKER_TOKEN = os.environ.get("CLICK_BROKER_TOKEN", "")
MAX_SESSIONS = int(os.environ.get("MAX_SESSIONS", "3"))

if len(BROKER_TOKEN) < 32:
    raise RuntimeError("CLICK_BROKER_TOKEN must be at least 32 characters")

ID_RE = re.compile(r"^[a-f0-9]{16}$")

docker_client = docker.from_env()
sessions: dict[str, dict[str, Any]] = {}


def _is_private_host(host: str) -> bool:
    name = host.lower().rstrip(".")
    if name in {"localhost", "127.0.0.1", "0.0.0.0", "::1", "127.1", "::ffff:127.0.0.1"}:
        return True
    if name.endswith(".local") or name.endswith(".internal") or name.endswith(".localhost"):
        return True
    if name.isdigit():
        return True
    parts = name.split(".")
    if all(p.isdigit() for p in parts) and 1 <= len(parts) <= 4:
        first = int(parts[0])
        second = int(parts[1]) if len(parts) > 1 else 0
        if first in {0, 10, 127}:
            return True
        if first == 192 and second == 168:
            return True
        if first == 172 and 16 <= second <= 31:
            return True
        if first == 169 and second == 254:
            return True
        if first == 100 and 64 <= second <= 127:
            return True
    if ":" in name and name.startswith(("fe80:", "fc", "fd", "::ffff:")):
        return True
    return False


def validate_target_url(raw: str) -> str:
    parsed = urlparse(raw.strip())
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("only http/https URLs are allowed")
    if parsed.username or parsed.password:
        raise ValueError("userinfo in URLs is not allowed")
    if not parsed.hostname:
        raise ValueError("URL host is required")
    if _is_private_host(parsed.hostname):
        raise ValueError("private or loopback hosts are not allowed")
    return parsed.geturl()


def _container_ip(container: Any) -> str | None:
    container.reload()
    nets = container.attrs.get("NetworkSettings", {}).get("Networks", {})
    net = nets.get(SANDBOX_NETWORK) or (next(iter(nets.values())) if nets else None)
    if not net:
        return None
    return net.get("IPAddress")


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


def _destroy_sync(sid: str) -> None:
    meta = sessions.pop(sid, None)
    if not meta:
        return
    try:
        docker_client.containers.get(meta["container_id"]).remove(force=True)
    except (NotFound, APIError):
        pass


def _reap_expired() -> None:
    now = time.time()
    for sid in [
        s
        for s, meta in sessions.items()
        if now - meta["last_heartbeat"] > HEARTBEAT_TIMEOUT_SEC
    ]:
        _destroy_sync(sid)


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
    _reap_expired()
    if len(sessions) >= MAX_SESSIONS:
        return web.json_response({"error": "too many live sessions"}, status=429)
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid JSON"}, status=400)
    try:
        target = validate_target_url(str(body.get("url", "")))
    except ValueError as exc:
        return web.json_response({"error": str(exc)}, status=400)

    sid = secrets.token_hex(8)
    kwargs: dict[str, Any] = {
        "image": BROWSER_IMAGE,
        "detach": True,
        "auto_remove": True,
        "name": f"click-{sid}",
        "network": SANDBOX_NETWORK,
        "cap_drop": ["ALL"],
        "cap_add": ["NET_ADMIN"],
        "security_opt": ["no-new-privileges:true"],
        "tmpfs": {
            "/tmp": "rw,noexec,nosuid,nodev,size=64m",
            "/home/sandbox": "rw,noexec,nosuid,nodev,uid=1000,gid=1000,size=128m",
        },
        "read_only": True,
        "privileged": False,
        "environment": {
            "TARGET_URL": target,
            "TOR_HOST": TOR_HOST,
            "TOR_PORT": "9050",
        },
        "mem_limit": "1g",
        "pids_limit": 256,
        "user": "0",
        "runtime": SANDBOX_RUNTIME,
    }

    try:
        container = docker_client.containers.run(**kwargs)
    except APIError as exc:
        return web.json_response(
            {"error": f"failed to start sandbox: {exc.explanation}"},
            status=502,
        )

    ip = None
    for _ in range(25):
        ip = _container_ip(container)
        if ip:
            break
        await asyncio.sleep(0.2)
    if not ip:
        _destroy_sync_container(container.id)
        return web.json_response({"error": "sandbox joined no network"}, status=502)

    try:
        await _wait_for_vnc(ip)
    except TimeoutError as exc:
        _destroy_sync_container(container.id)
        return web.json_response({"error": str(exc)}, status=504)

    sessions[sid] = {
        "container_id": container.id,
        "ip": ip,
        "created": time.time(),
        "last_heartbeat": time.time(),
        "url": target,
    }
    return web.json_response({"id": sid, "view": f"/view/{sid}"})


def _destroy_sync_container(container_id: str) -> None:
    try:
        docker_client.containers.get(container_id).remove(force=True)
    except (NotFound, APIError):
        pass


async def delete_session(request: web.Request) -> web.Response:
    sid = request.match_info["id"]
    if not ID_RE.match(sid):
        return web.json_response({"error": "invalid id"}, status=400)
    _destroy_sync(sid)
    return web.json_response({"ok": True})


async def get_session(request: web.Request) -> web.Response:
    sid = request.match_info["id"]
    meta = sessions.get(sid)
    if not meta:
        return web.json_response({"error": "not found"}, status=404)
    return web.json_response({"id": sid, "url": meta["url"]})


async def heartbeat_session(request: web.Request) -> web.Response:
    sid = request.match_info["id"]
    if not ID_RE.match(sid):
        return web.json_response({"error": "invalid id"}, status=400)
    meta = sessions.get(sid)
    if not meta:
        return web.json_response({"error": "not found"}, status=404)
    meta["last_heartbeat"] = time.time()
    return web.json_response({"ok": True})


async def proxy_vnc(request: web.Request) -> web.StreamResponse:
    sid = request.match_info["id"]
    rest = request.match_info.get("tail", "")
    meta = sessions.get(sid)
    if not meta:
        return web.Response(status=404, text="session gone")
    if not ID_RE.match(sid):
        return web.Response(status=400, text="invalid id")

    if request.headers.get("Upgrade", "").lower() == "websocket":
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
    ws_server = web.WebSocketResponse()
    await ws_server.prepare(request)
    path = rest if rest else "websockify"
    url = f"http://{ip}:6080/{path}"
    async with ClientSession() as http:
        async with http.ws_connect(url) as ws_client:

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
                asyncio.create_task(from_client()),
                asyncio.create_task(from_sandbox()),
            ]
            done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in pending:
                task.cancel()
            for task in done:
                task.exception() if not task.cancelled() else None
    return ws_server


async def reap_sessions(_app: web.Application) -> None:
    while True:
        await asyncio.sleep(5)
        _reap_expired()


async def reaper_context(app: web.Application):
    task = asyncio.create_task(reap_sessions(app))
    try:
        yield
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        for sid in list(sessions):
            _destroy_sync(sid)


def build_app() -> web.Application:
    app = web.Application(middlewares=[require_broker_token])
    app.cleanup_ctx.append(reaper_context)
    app.router.add_post("/sessions", create_session)
    app.router.add_get("/sessions/{id}", get_session)
    app.router.add_post("/sessions/{id}/heartbeat", heartbeat_session)
    app.router.add_delete("/sessions/{id}", delete_session)
    app.router.add_route("*", "/sessions/{id}/vnc", proxy_vnc)
    app.router.add_route("*", "/sessions/{id}/vnc/{tail:.*}", proxy_vnc)
    return app


def main() -> None:
    web.run_app(build_app(), host="0.0.0.0", port=int(os.environ.get("PORT", "8080")))


if __name__ == "__main__":
    main()
