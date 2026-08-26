"""Allowlist Docker Engine API for spawning only the browser sandbox image."""

from __future__ import annotations

import json
import os
import re
from typing import Any

from aiohttp import ClientSession, UnixConnector, web

DOCKER_SOCK = os.environ.get("DOCKER_SOCK", "/var/run/docker.sock")
ALLOWED_IMAGE = os.environ.get("BROWSER_IMAGE", "real-search-browser:local")
ALLOWED_NETWORK = os.environ.get("SANDBOX_NETWORK", "real-search_sandbox")
ALLOWED_RUNTIME = os.environ.get("SANDBOX_RUNTIME", "runc").strip() or "runc"
ALLOWED_TMPFS = {"/tmp", "/home/sandbox"}
CREATE_NAME_RE = re.compile(r"^click-[a-f0-9]{32}$")
SANDBOX_NAME_RE = re.compile(r"^/?click-[a-f0-9]{32}$")

if ALLOWED_RUNTIME not in {"runc", "runsc"}:
    raise RuntimeError("SANDBOX_RUNTIME must be runc or runsc")

CREATE_RE = re.compile(r"^(/v[\d.]+)?/containers/create$")
CONTAINER_MUTATE_RE = re.compile(
    r"^(/v[\d.]+)?/containers/[^/]+/(start|stop|kill|wait)$",
)
CONTAINER_GET_RE = re.compile(r"^(/v[\d.]+)?/containers/[^/]+/json$")
CONTAINER_DEL_RE = re.compile(r"^(/v[\d.]+)?/containers/[^/]+$")
CONTAINER_LIST_RE = re.compile(r"^(/v[\d.]+)?/containers/json$")
CONTAINER_REF_RE = re.compile(
    r"^(/v[\d.]+)?/containers/([^/]+)(?:/(start|stop|kill|wait|json))?$",
)
PING_RE = re.compile(r"^(/v[\d.]+)?/(_ping|version|info)$")
PING_BARE_RE = re.compile(r"^/_ping$")


def _allowed_path(method: str, path: str) -> bool:
    if method == "GET" and (
        PING_RE.match(path)
        or PING_BARE_RE.match(path)
        or CONTAINER_GET_RE.match(path)
        or CONTAINER_LIST_RE.match(path)
    ):
        return True
    if method == "POST" and (CREATE_RE.match(path) or CONTAINER_MUTATE_RE.match(path)):
        return True
    if method == "DELETE" and CONTAINER_DEL_RE.match(path):
        return True
    return False


def _image_ok(image: str) -> bool:
    return image == ALLOWED_IMAGE or image.startswith(ALLOWED_IMAGE + "@")


async def _is_sandbox_container(http: ClientSession, path: str) -> bool:
    match = CONTAINER_REF_RE.match(path)
    if not match:
        return False
    prefix = match.group(1) or "/v1.41"
    cid = match.group(2)
    async with http.get(f"http://docker{prefix}/containers/{cid}/json") as resp:
        if resp.status != 200:
            return False
        data = await resp.json()
    name = str(data.get("Name") or "")
    image = str((data.get("Config") or {}).get("Image") or "")
    return bool(SANDBOX_NAME_RE.match(name)) and _image_ok(image)


def _as_list(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    if isinstance(value, (list, tuple)):
        return list(value)
    return [value]


def _validate_create(body: dict[str, Any]) -> str | None:
    if body.get("Image") != ALLOWED_IMAGE:
        return f"image must be {ALLOWED_IMAGE}"
    if body.get("Mounts"):
        return "mounts not allowed"
    if body.get("Volumes"):
        return "volumes not allowed"
    if body.get("Labels") != {"real-search.sandbox": "true"}:
        return "sandbox label is required"
    if body.get("Cmd") or body.get("Entrypoint"):
        return "command and entrypoint overrides are not allowed"
    if str(body.get("User") or "") != "0":
        return "root bootstrap user is required"
    env_items = _as_list(body.get("Env"))
    env: dict[str, str] = {}
    for item in env_items:
        key, separator, value = str(item).partition("=")
        if not separator or key in env:
            return "invalid environment"
        env[key] = value
    if set(env) != {"TARGET_URL", "TOR_HOST", "TOR_PORT", "VNC_TOKEN"}:
        return "unexpected environment keys"
    if env["TOR_HOST"] != "tor" or env["TOR_PORT"] != "9050":
        return "fixed Tor endpoint required"
    if len(env["VNC_TOKEN"]) < 32:
        return "VNC token is too short"
    if body.get("HostConfig") is None:
        return "HostConfig is required"
    host = body.get("HostConfig") or {}
    if host.get("Privileged"):
        return "privileged not allowed"
    if host.get("Binds") or host.get("Mounts") or host.get("VolumesFrom") or host.get("Links"):
        return "binds/mounts/links not allowed"
    if host.get("Devices") or host.get("DeviceRequests") or host.get("DeviceCgroupRules"):
        return "devices not allowed"
    if host.get("ExtraHosts"):
        return "extra hosts not allowed"
    if host.get("Dns") or host.get("DnsSearch") or host.get("DnsOptions"):
        return "custom DNS not allowed"
    if host.get("PidMode") in {"host", "container"}:
        return "host pid namespace not allowed"
    if host.get("IpcMode") == "host" or host.get("UTSMode") == "host":
        return "host namespaces not allowed"
    if host.get("UsernsMode") in {"host", "container"}:
        return "host userns not allowed"
    if host.get("PublishAllPorts") or host.get("PortBindings"):
        return "published ports not allowed"
    if not host.get("ReadonlyRootfs"):
        return "readonly rootfs required"
    if not host.get("AutoRemove"):
        return "automatic removal required"
    if int(host.get("Memory") or 0) != 1024 * 1024 * 1024:
        return "memory limit must be 1 GiB"
    if int(host.get("PidsLimit") or 0) != 256:
        return "PID limit must be 256"
    security_opt = set(_as_list(host.get("SecurityOpt")))
    if security_opt != {"no-new-privileges:true"}:
        return "no-new-privileges is required"
    tmpfs = host.get("Tmpfs") or {}
    if set(tmpfs) != ALLOWED_TMPFS:
        return "only the required sandbox tmpfs mounts are allowed"
    if any(
        flag not in str(options).split(",")
        for options in tmpfs.values()
        for flag in ("noexec", "nosuid", "nodev")
    ):
        return "sandbox tmpfs mounts require noexec,nosuid,nodev"
    cap_drop = {str(c).removeprefix("CAP_") for c in _as_list(host.get("CapDrop"))}
    if "ALL" not in cap_drop:
        return "all capabilities must be dropped"
    caps = {str(c).removeprefix("CAP_") for c in _as_list(host.get("CapAdd"))}
    if caps != {"NET_ADMIN"}:
        return "exactly NET_ADMIN must be added"
    runtime = host.get("Runtime") or ""
    if runtime != ALLOWED_RUNTIME:
        return f"runtime must be {ALLOWED_RUNTIME}"
    mode = (host.get("NetworkMode") or "").strip()
    endpoints = ((body.get("NetworkingConfig") or {}).get("EndpointsConfig") or {})
    nets = {mode} if mode else set()
    nets.update(endpoints)
    nets.discard("")
    if nets != {ALLOWED_NETWORK}:
        return f"network must be only {ALLOWED_NETWORK}"
    return None


async def handle(request: web.Request) -> web.StreamResponse:
    path = request.rel_url.path
    if request.rel_url.query_string:
        qs = f"?{request.rel_url.query_string}"
    else:
        qs = ""
    if not _allowed_path(request.method, path):
        return web.json_response({"message": "docker API path denied"}, status=403)
    if request.method == "GET" and CONTAINER_LIST_RE.match(path):
        try:
            filters = json.loads(request.rel_url.query.get("filters", "{}"))
        except json.JSONDecodeError:
            return web.json_response({"message": "invalid list filters"}, status=400)
        allowed_keys = {"all", "filters", "limit", "size"}
        if set(request.rel_url.query) - allowed_keys:
            return web.json_response({"message": "container list query denied"}, status=403)
        if filters != {"label": ["real-search.sandbox=true"]}:
            return web.json_response({"message": "sandbox label filter required"}, status=403)

    raw = await request.read()
    if CREATE_RE.match(path) and request.method == "POST":
        name = request.rel_url.query.get("name", "")
        if not CREATE_NAME_RE.match(name):
            return web.json_response({"message": "sandbox name required"}, status=403)
        try:
            body = json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            return web.json_response({"message": "invalid create body"}, status=400)
        err = _validate_create(body)
        if err:
            return web.json_response({"message": err}, status=403)

    unix = UnixConnector(path=DOCKER_SOCK)
    url = f"http://docker{path}{qs}"
    headers = {k: v for k, v in request.headers.items() if k.lower() not in {"host", "content-length"}}
    needs_owner_check = (not CREATE_RE.match(path)) and bool(
        CONTAINER_GET_RE.match(path)
        or CONTAINER_MUTATE_RE.match(path)
        or CONTAINER_DEL_RE.match(path)
    )
    async with ClientSession(connector=unix) as http:
        if needs_owner_check and not await _is_sandbox_container(http, path):
            return web.json_response({"message": "container not a sandbox"}, status=403)
        async with http.request(request.method, url, headers=headers, data=raw) as resp:
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


def main() -> None:
    app = web.Application()
    app.router.add_route("*", "/{tail:.*}", handle)
    web.run_app(app, host="0.0.0.0", port=2375)


if __name__ == "__main__":
    main()
