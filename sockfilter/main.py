"""Allowlist Docker Engine API for spawning only the browser sandbox image."""

from __future__ import annotations

import ipaddress
import json
import os
import re
from typing import Any

from aiohttp import ClientSession, UnixConnector, web

DOCKER_SOCK = os.environ.get("DOCKER_SOCK", "/var/run/docker.sock")
SANDBOX_IMAGE_PREFIX = "real-search-browser"
PINNED_TAG_RE = re.compile(r"^[0-9a-f]{7,40}-[0-9a-f]{12}$")


def _pinned_allowed_image() -> str:
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


ALLOWED_IMAGE = _pinned_allowed_image()
ALLOWED_VNC_NETWORK = os.environ.get(
    "SANDBOX_VNC_NETWORK",
    "real-search_sandbox-vnc",
)
ALLOWED_EGRESS_NETWORK = os.environ.get(
    "SANDBOX_EGRESS_NETWORK",
    "real-search_sandbox-egress",
)
ALLOWED_RUNTIME = os.environ.get("SANDBOX_RUNTIME", "runsc").strip() or "runsc"
ALLOWED_TOR_IP = os.environ.get("SANDBOX_TOR_IP", "172.30.0.2")
ALLOWED_BROKER_IP = os.environ.get("SANDBOX_BROKER_IP", "172.30.0.3")
ALLOWED_TMPFS = {
    "/tmp": "rw,noexec,nosuid,nodev,size=64m",
    "/home/sandbox": "rw,noexec,nosuid,nodev,uid=1000,gid=1000,size=128m",
}
ALLOWED_CREATE_KEYS = {
    "Hostname",
    "Domainname",
    "ExposedPorts",
    "User",
    "Tty",
    "OpenStdin",
    "StdinOnce",
    "AttachStdin",
    "AttachStdout",
    "AttachStderr",
    "Env",
    "Cmd",
    "Image",
    "Volumes",
    "NetworkDisabled",
    "Entrypoint",
    "WorkingDir",
    "HostConfig",
    "NetworkingConfig",
    "MacAddress",
    "Labels",
    "StopSignal",
    "Healthcheck",
    "StopTimeout",
    "Runtime",
}
ALLOWED_HOST_KEYS = {
    "Memory",
    "NanoCpus",
    "NetworkMode",
    "ReadonlyRootfs",
    "CapAdd",
    "CapDrop",
    "SecurityOpt",
    "Tmpfs",
    "PidsLimit",
    "AutoRemove",
    "Runtime",
}
CREATE_NAME_RE = re.compile(r"^click-[a-f0-9]{32}$")
SANDBOX_NAME_RE = re.compile(r"^/?click-[a-f0-9]{32}$")

if ALLOWED_RUNTIME != "runsc":
    raise RuntimeError("SANDBOX_RUNTIME must be runsc")

CREATE_RE = re.compile(r"^(/v[\d.]+)?/containers/create$")
CONTAINER_MUTATE_RE = re.compile(
    r"^(/v[\d.]+)?/containers/[^/]+/(start|stop|kill|wait)$",
)
CONTAINER_GET_RE = re.compile(r"^(/v[\d.]+)?/containers/[^/]+/json$")
CONTAINER_DEL_RE = re.compile(r"^(/v[\d.]+)?/containers/[^/]+$")
CONTAINER_LIST_RE = re.compile(r"^(/v[\d.]+)?/containers/json$")
NETWORK_CONNECT_RE = re.compile(
    rf"^(/v[\d.]+)?/networks/{re.escape(ALLOWED_EGRESS_NETWORK)}/connect$",
)
CONTAINER_REF_RE = re.compile(
    r"^(/v[\d.]+)?/containers/([^/]+)(?:/(start|stop|kill|wait|json))?$",
)
PING_RE = re.compile(r"^(/v[\d.]+)?/(_ping|version)$")
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
    if method == "POST" and NETWORK_CONNECT_RE.match(path):
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
    return await _is_sandbox_ref(http, prefix, cid)


async def _is_sandbox_ref(http: ClientSession, prefix: str, cid: str) -> bool:
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
    unknown = set(body) - ALLOWED_CREATE_KEYS
    if unknown:
        return f"unknown create keys: {','.join(sorted(unknown))}"
    if body.get("Image") != ALLOWED_IMAGE:
        return f"image must be {ALLOWED_IMAGE}"
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
    if set(env) != {
        "TARGET_URL",
        "TOR_IP",
        "TOR_PORT",
        "TOR_SOCKS_USERNAME",
        "TOR_SOCKS_PASSWORD",
        "BROKER_IP",
        "VNC_TOKEN",
        "VNC_PASSWORD",
    }:
        return "unexpected environment keys"
    if env["TOR_PORT"] != "9050":
        return "fixed Tor endpoint required"
    try:
        addresses = [ipaddress.ip_address(env[key]) for key in ("TOR_IP", "BROKER_IP")]
    except ValueError:
        return "literal Tor and broker IPv4 addresses are required"
    if any(address.version != 4 or not address.is_private for address in addresses):
        return "private Tor and broker IPv4 addresses are required"
    if env["TOR_IP"] != ALLOWED_TOR_IP or env["BROKER_IP"] != ALLOWED_BROKER_IP:
        return "fixed sandbox-network endpoints are required"
    if not re.fullmatch(r"[A-Za-z0-9_-]{43}", env["VNC_TOKEN"]):
        return "VNC relay token has invalid format"
    if not re.fullmatch(r"[A-Za-z0-9]{8}", env["VNC_PASSWORD"]):
        return "VNC password has invalid format"
    for key in ("TOR_SOCKS_USERNAME", "TOR_SOCKS_PASSWORD"):
        if not re.fullmatch(r"[A-Za-z0-9_-]{32}", env[key]):
            return "Tor SOCKS credentials have invalid format"
    if body.get("HostConfig") is None:
        return "HostConfig is required"
    host = body.get("HostConfig") or {}
    unknown_host = set(host) - ALLOWED_HOST_KEYS
    if unknown_host:
        return f"unknown HostConfig keys: {','.join(sorted(unknown_host))}"
    if not host.get("ReadonlyRootfs"):
        return "readonly rootfs required"
    if not host.get("AutoRemove"):
        return "automatic removal required"
    if int(host.get("Memory") or 0) != 1024 * 1024 * 1024:
        return "memory limit must be 1 GiB"
    if int(host.get("NanoCpus") or 0) != 1_000_000_000:
        return "CPU limit must be exactly one core"
    if int(host.get("PidsLimit") or 0) != 256:
        return "PID limit must be 256"
    security_opt = set(_as_list(host.get("SecurityOpt")))
    if security_opt != {"no-new-privileges:true"}:
        return "no-new-privileges is required"
    tmpfs = host.get("Tmpfs") or {}
    if tmpfs != ALLOWED_TMPFS:
        return "sandbox tmpfs mounts must exactly match the bounded policy"
    cap_drop = {str(c).removeprefix("CAP_") for c in _as_list(host.get("CapDrop"))}
    if "ALL" not in cap_drop:
        return "all capabilities must be dropped"
    caps = {str(c).removeprefix("CAP_") for c in _as_list(host.get("CapAdd"))}
    if caps != {"SETGID", "SETUID"}:
        return "only SETGID and SETUID may be added"
    runtime = host.get("Runtime") or ""
    if runtime != ALLOWED_RUNTIME:
        return f"runtime must be {ALLOWED_RUNTIME}"
    mode = (host.get("NetworkMode") or "").strip()
    networking = body.get("NetworkingConfig") or {}
    if set(networking) - {"EndpointsConfig"}:
        return "unknown NetworkingConfig keys"
    endpoints = networking.get("EndpointsConfig") or {}
    if set(endpoints) - {ALLOWED_VNC_NETWORK}:
        return "unexpected network endpoint"
    if any(value not in ({}, None) for value in endpoints.values()):
        return "network endpoint overrides are not allowed"
    nets = {mode} if mode else set()
    nets.update(endpoints)
    nets.discard("")
    if nets != {ALLOWED_VNC_NETWORK}:
        return f"initial network must be only {ALLOWED_VNC_NETWORK}"
    false_only = {
        "Tty",
        "OpenStdin",
        "StdinOnce",
        "AttachStdin",
        "AttachStdout",
        "AttachStderr",
        "NetworkDisabled",
    }
    if any(body.get(key) not in (None, False) for key in false_only):
        return "interactive or attached containers are not allowed"
    empty_only = {
        "Hostname",
        "Domainname",
        "ExposedPorts",
        "WorkingDir",
        "MacAddress",
        "StopSignal",
        "Healthcheck",
        "StopTimeout",
        "Runtime",
    }
    if any(body.get(key) not in (None, "", {}, []) for key in empty_only):
        return "unexpected container configuration"
    return None


def _clean_create(body: dict[str, Any]) -> bytes:
    env = sorted(str(item) for item in _as_list(body["Env"]))
    clean = {
        "Image": ALLOWED_IMAGE,
        "User": "0",
        "Env": env,
        "Labels": {"real-search.sandbox": "true"},
        "HostConfig": {
            "Memory": 1024 * 1024 * 1024,
            "NanoCpus": 1_000_000_000,
            "NetworkMode": ALLOWED_VNC_NETWORK,
            "ReadonlyRootfs": True,
            "CapAdd": ["SETGID", "SETUID"],
            "CapDrop": ["ALL"],
            "SecurityOpt": ["no-new-privileges:true"],
            "Tmpfs": ALLOWED_TMPFS,
            "PidsLimit": 256,
            "AutoRemove": True,
            "Runtime": ALLOWED_RUNTIME,
        },
    }
    return json.dumps(clean, separators=(",", ":")).encode("utf-8")


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
        if not isinstance(filters, dict) or set(filters) != {"label"}:
            return web.json_response({"message": "sandbox label filter required"}, status=403)
        label = filters.get("label")
        labels = [label] if isinstance(label, str) else label
        if labels != ["real-search.sandbox=true"]:
            return web.json_response({"message": "sandbox label filter required"}, status=403)

    raw = await request.read()
    if CREATE_RE.match(path) and request.method == "POST":
        if set(request.rel_url.query) != {"name"}:
            return web.json_response({"message": "create query denied"}, status=403)
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
        raw = _clean_create(body)

    unix = UnixConnector(path=DOCKER_SOCK)
    url = f"http://docker{path}{qs}"
    headers = {k: v for k, v in request.headers.items() if k.lower() not in {"host", "content-length"}}
    needs_owner_check = (not CREATE_RE.match(path)) and bool(
        CONTAINER_GET_RE.match(path)
        or CONTAINER_MUTATE_RE.match(path)
        or CONTAINER_DEL_RE.match(path)
    )
    async with ClientSession(connector=unix) as http:
        if NETWORK_CONNECT_RE.match(path) and request.method == "POST":
            if request.rel_url.query:
                return web.json_response(
                    {"message": "network connect query denied"},
                    status=403,
                )
            try:
                connect_body = json.loads(raw.decode("utf-8") or "{}")
            except json.JSONDecodeError:
                return web.json_response(
                    {"message": "invalid network connect body"},
                    status=400,
                )
            if (
                set(connect_body) != {"Container", "EndpointConfig"}
                or connect_body.get("EndpointConfig") != {}
            ):
                return web.json_response(
                    {"message": "network endpoint overrides are not allowed"},
                    status=403,
                )
            cid = str(connect_body.get("Container") or "")
            prefix_match = NETWORK_CONNECT_RE.match(path)
            prefix = prefix_match.group(1) if prefix_match else None
            if not await _is_sandbox_ref(http, prefix or "/v1.41", cid):
                return web.json_response(
                    {"message": "container is not an owned sandbox"},
                    status=403,
                )
            raw = json.dumps(
                {"Container": cid, "EndpointConfig": {}},
                separators=(",", ":"),
            ).encode("utf-8")
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
    if hasattr(os, "geteuid") and os.geteuid() == 0:
        raise RuntimeError("sockfilter must not run as root")
    if not os.access(DOCKER_SOCK, os.R_OK | os.W_OK):
        raise RuntimeError(
            "docker.sock is not writable; set DOCKER_GID to the socket group"
        )
    app = web.Application()
    app.router.add_route("*", "/{tail:.*}", handle)
    web.run_app(app, host="0.0.0.0", port=2375)


if __name__ == "__main__":
    main()
