#!/usr/bin/env sh
# Build the gVisor sandbox image tagged with a content pin, not :local.
set -eu

ROOT="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
CONTEXT="${ROOT}/browser-sandbox"

if [ ! -d "${CONTEXT}" ]; then
  echo "browser-sandbox/ is missing" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required to build the sandbox image" >&2
  exit 1
fi

GIT_SHA="$(git -C "${ROOT}" rev-parse --short=12 HEAD)"
CONTENT_HASH="$(
  find "${CONTEXT}" -type f ! -name '.DS_Store' \
    | sort \
    | xargs sha256sum \
    | sha256sum \
    | cut -c1-12
)"
TAG="${GIT_SHA}-${CONTENT_HASH}"
IMAGE="real-search-browser:${TAG}"

echo "building ${IMAGE}"
docker build -t "${IMAGE}" "${CONTEXT}"

upsert_tag() {
  envfile="$1"
  if [ ! -f "${envfile}" ]; then
    return 0
  fi
  tmp="${envfile}.sandbox-tag.$$"
  grep -v '^SANDBOX_IMAGE_TAG=' "${envfile}" > "${tmp}" || true
  printf 'SANDBOX_IMAGE_TAG=%s\n' "${TAG}" >> "${tmp}"
  mv "${tmp}" "${envfile}"
}

printf 'SANDBOX_IMAGE_TAG=%s\n' "${TAG}" > "${ROOT}/.sandbox-image-tag"
upsert_tag "${ROOT}/.env"

echo "pinned ${IMAGE}"
echo "SANDBOX_IMAGE_TAG=${TAG}"
echo "compose interpolation reads this from .env; rerun this script after sandbox file changes."
