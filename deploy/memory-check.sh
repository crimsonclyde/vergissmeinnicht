#!/bin/sh
# Checks the container memory limit of the deployment (4 GiB, deploy/compose.yml and the Unraid
# template) against document processing: starts a built image with that limit and the hardening of the
# Compose file, then runs deploy/memory-check.ts — large and hostile PDFs and photos uploaded while
# ordinary requests keep coming. Fails if the kernel killed anything in the container, the container
# restarted, an ordinary request failed, or an upload did not end as expected.
#   deploy/memory-check.sh <image> [limit, default 4g]
# Needs Docker and Node 24+ with the repository's dependencies installed (the script builds its test
# files with sharp). Not part of CI: it needs several gigabytes of memory and a few minutes.
set -eu
image="${1:?usage: memory-check.sh <image> [limit]}"
limit="${2:-4g}"
name="vmn-memory-$$"
volume="vmn-memory-$$"
port="${VMN_MEMORY_CHECK_PORT:-3390}"
cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

secret() { head -c 32 /dev/urandom | base64 | tr -d '\n'; }
set -- \
  -e PUBLIC_ORIGIN="http://127.0.0.1:$port" \
  -e AUTH_SECRET="$(secret)" \
  -e DATA_ENCRYPTION_KEY="$(secret)" \
  -e SMTP_HOST=127.0.0.1 \
  -e SMTP_SECURITY=none \
  -e MAIL_FROM_ADDRESS=noreply@example.org \
  -e API_RATE_LIMIT_PER_MINUTE=10000 \
  -v "$volume:/data"

docker run --rm "$@" "$image" migrate >/dev/null
invite="$(docker run --rm "$@" "$image" admin-bootstrap --email admin@example.org | grep -o '/invite/[A-Za-z0-9_-]*' | head -n 1)"
docker run -d --name "$name" --init --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges:true \
  --memory="$limit" --memory-swap="$limit" -p "127.0.0.1:$port:3000" "$@" "$image" serve >/dev/null

for _ in $(seq 1 30); do
  if docker exec "$name" node -e "fetch('http://127.0.0.1:3000/api/health/ready').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))" 2>/dev/null; then
    node "$(dirname "$0")/memory-check.ts" "http://127.0.0.1:$port" "${invite#/invite/}" "$name"
    exit $?
  fi
  sleep 1
done
echo "the server did not become ready" >&2
exit 1
