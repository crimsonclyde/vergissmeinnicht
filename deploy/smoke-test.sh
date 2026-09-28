#!/bin/sh
# Starts a built image with a throwaway production configuration and checks that every runtime path
# loads: migrate, admin bootstrap CLI, backup, the server becoming ready, and a scheduled backup. Used by CI after the
# image build (the image prunes dev-only packages; this proves nothing needed was removed).
#   deploy/smoke-test.sh <image>
set -eu
image="${1:?usage: smoke-test.sh <image>}"
name="vmn-smoke-$$"
volume="vmn-smoke-$$"
cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

secret() { head -c 32 /dev/urandom | base64 | tr -d '\n'; }
set -- \
  -e PUBLIC_ORIGIN=http://127.0.0.1:3000 \
  -e AUTH_SECRET="$(secret)" \
  -e DATA_ENCRYPTION_KEY="$(secret)" \
  -e SMTP_HOST=127.0.0.1 \
  -e SMTP_SECURITY=none \
  -e MAIL_FROM_ADDRESS=noreply@example.org \
  -v "$volume:/data"

docker run --rm "$@" "$image" migrate
docker run --rm "$@" "$image" admin-bootstrap --email admin@example.org | grep -q '/invite/'
docker run --rm "$@" "$image" backup | grep -q 'Backup written and verified'
docker run -d --name "$name" --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges:true \
  -e BACKUP_INTERVAL_HOURS=24 "$@" "$image" serve >/dev/null

for _ in $(seq 1 30); do
  if docker exec "$name" node -e "fetch('http://127.0.0.1:3000/api/health/ready').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"; then
    # The web app and the service worker are served as well.
    docker exec "$name" node -e "Promise.all(['/', '/sw.js', '/manifest.webmanifest', '/third-party-notices.txt'].map((p) => fetch('http://127.0.0.1:3000' + p))).then((rs) => process.exit(rs.every((r) => r.ok) ? 0 : 1), () => process.exit(1))"
    # The scheduled backup ran at start (BACKUP_INTERVAL_HOURS).
    for _ in $(seq 1 10); do
      docker exec "$name" sh -c 'ls /data/backups | grep -q "^vergissmeinnicht-auto-"' && break
      sleep 1
    done
    docker exec "$name" sh -c 'ls /data/backups | grep -q "^vergissmeinnicht-auto-"'
    echo "smoke test passed: $image"
    exit 0
  fi
  sleep 1
done
docker logs "$name" >&2
echo "server did not become ready" >&2
exit 1
