#!/bin/sh
set -eu

QDRANT_URL="${QDRANT_URL:-http://qdrant:6333}"
QDRANT_API_KEY="${QDRANT_API_KEY:?QDRANT_API_KEY is required}"

echo "waiting for Qdrant at ${QDRANT_URL}"
i=0
while [ "$i" -lt 30 ]; do
  if curl -sf -H "api-key: ${QDRANT_API_KEY}" "${QDRANT_URL}/readyz" >/dev/null 2>&1; then
    echo "Qdrant is up"
    break
  fi
  i=$((i + 1))
  sleep 2
done

if [ "$i" -ge 30 ]; then
  echo "Qdrant did not become ready" >&2
  exit 1
fi

code="$(curl -s -o /tmp/qdrant-pages.json -w "%{http_code}" \
  -X PUT "${QDRANT_URL}/collections/pages" \
  -H "api-key: ${QDRANT_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "vectors": {
      "content": {
        "size": 384,
        "distance": "Cosine"
      }
    }
  }')"

if [ "$code" = "200" ] || [ "$code" = "201" ]; then
  echo "created pages collection"
  exit 0
fi

if grep -q "already exists" /tmp/qdrant-pages.json 2>/dev/null; then
  echo "pages collection already exists"
  exit 0
fi

echo "Qdrant collection response ${code}:" >&2
cat /tmp/qdrant-pages.json >&2 || true
# Treat conflict as success if the collection is already there.
if [ "$code" = "409" ]; then
  exit 0
fi
exit 1
