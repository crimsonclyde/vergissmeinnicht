#!/bin/sh
# Checks the restart behaviour of the Unraid template's Extra Parameters (deploy/unraid/vergissmeinnicht.xml):
#   --init --user 0:0 --security-opt no-new-privileges:true --memory=4g --memory-swap=4g --restart=unless-stopped
# on a built image, with a throwaway volume:
#   1. the server process is killed (SIGKILL)            -> Docker starts the container again, data is there
#   2. the server is killed by the kernel for memory     -> the same; done with a 1 GiB limit, because
#      (a real out-of-memory kill, of the server itself)    a kill at 4 GiB cannot be provoked on purpose
#   3. the container is stopped on purpose                -> it stays stopped; started again, data is there
# It does not cover: a restart of the Docker daemon or of the host, Unraid's own start/stop handling,
# or an out-of-memory kill at the 4 GiB limit.
#   deploy/restart-check.sh <image>
# Needs Docker and curl. Takes about two minutes.
set -eu
image="${1:?usage: restart-check.sh <image>}"
name="vmn-restart-$$"
volume="vmn-restart-$$"
port="${VMN_RESTART_CHECK_PORT:-3391}"
origin="http://127.0.0.1:$port"
work="$(mktemp -d)"
password='a restart check passphrase that is long'
cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT INT TERM
fail() { echo "FAILED: $*" >&2; exit 1; }

secret() { head -c 32 /dev/urandom | base64 | tr -d '\n'; }
auth_secret="$(secret)"
data_key="$(secret)"
# The same secrets for every start: sessions and stored data must survive a restart.
set -- \
  -e PUBLIC_ORIGIN="$origin" -e AUTH_SECRET="$auth_secret" -e DATA_ENCRYPTION_KEY="$data_key" \
  -e SMTP_HOST=127.0.0.1 -e SMTP_SECURITY=none -e MAIL_FROM_ADDRESS=noreply@example.org \
  -e PUID=99 -e PGID=100 -e VMN_MIGRATE_ON_START=true \
  -v "$volume:/data"

# The template's Extra Parameters, with the memory limit as a variable for the out-of-memory part.
run_server() { # <memory limit>
  limit="$1"
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker run -d --name "$name" --init --user 0:0 --security-opt no-new-privileges:true \
    --memory="$limit" --memory-swap="$limit" --restart=unless-stopped -p "127.0.0.1:$port:3000" $ENV_ARGS "$image" serve >/dev/null
}
ready() { curl -fsS -m 2 "$origin/api/health/ready" >/dev/null 2>&1; }
wait_ready() {
  for _ in $(seq 1 60); do ready && return 0; sleep 1; done
  return 1
}
restarts() { docker inspect -f '{{.RestartCount}}' "$name"; }
status() { docker inspect -f '{{.State.Status}}' "$name"; }
api() { # <method> <path> [json]
  if [ "$#" -ge 3 ]; then
    curl -sS -m 30 -X "$1" -H "Origin: $origin" -H 'Content-Type: application/json' -b "$work/cookies" -c "$work/cookies" -d "$3" "$origin/api$2"
  else
    curl -sS -m 30 -X "$1" -H "Origin: $origin" -b "$work/cookies" -c "$work/cookies" "$origin/api$2"
  fi
}
# What must still be there after every restart: the account (sign in again) and the Workspace with its Folder.
data_intact() {
  rm -f "$work/cookies"
  api POST /auth/sign-in "{\"email\":\"admin@example.org\",\"password\":\"$password\"}" | grep -q '"user"' || return 1
  api GET /workspaces | grep -q '"name":"Kept across restarts"' || return 1
  api GET "/workspaces/$workspace/document-folders" | grep -q '"name":"Water"' || return 1
}

# Prints the process ids of the server (node … src/main.ts) inside the container — not of the shell that looks for it.
SERVER_PIDS='for p in /proc/[0-9]*; do case "$(tr "\0" " " < "$p/cmdline" 2>/dev/null)" in node\ *src/main.ts*) echo "${p#/proc/}" ;; esac; done'

# docker run takes the environment as separate words; the values contain no spaces.
ENV_ARGS="-e PUBLIC_ORIGIN=$origin -e AUTH_SECRET=$auth_secret -e DATA_ENCRYPTION_KEY=$data_key -e SMTP_HOST=127.0.0.1 -e SMTP_SECURITY=none -e MAIL_FROM_ADDRESS=noreply@example.org -e PUID=99 -e PGID=100 -e VMN_MIGRATE_ON_START=true -v $volume:/data"

docker run --rm "$@" "$image" migrate >/dev/null
invite="$(docker run --rm "$@" "$image" admin-bootstrap --email admin@example.org | grep -o '/invite/[A-Za-z0-9_-]*' | head -n 1)"

echo "== Setting up: container with the template's parameters (4 GiB, restart unless stopped)"
run_server 4g
wait_ready || fail "the server did not become ready"
api POST /invitations/accept "{\"token\":\"${invite#/invite/}\",\"displayName\":\"Restart Check\",\"password\":\"$password\"}" >/dev/null
api POST /auth/sign-in "{\"email\":\"admin@example.org\",\"password\":\"$password\"}" >/dev/null
workspace="$(api POST /workspaces '{"name":"Kept across restarts"}' | grep -o '"id":"[0-9a-f-]*"' | head -n 1 | cut -d'"' -f4)"
[ -n "$workspace" ] || fail "could not create the Workspace"
api POST "/workspaces/$workspace/tools" '{"tool":"DOCUMENTS","enabled":true}' >/dev/null
api POST "/workspaces/$workspace/document-folders" '{"name":"Water","parentId":null}' >/dev/null
data_intact || fail "the data was not written"
echo "   policy: $(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}, memory {{.HostConfig.Memory}}, memory+swap {{.HostConfig.MemorySwap}}' "$name"); application user: $(docker exec "$name" sh -c "$SERVER_PIDS"' | while read -r pid; do awk "/^Uid:/ {print \$2}" "/proc/$pid/status"; done' | head -n 1)"

echo "== 1. The server process is killed (SIGKILL): an unexpected termination"
before="$(restarts)"
docker exec "$name" sh -c "$SERVER_PIDS"' | while read -r pid; do kill -KILL "$pid"; done'
sleep 2
wait_ready || fail "the container did not come back after the server was killed"
[ "$(restarts)" -gt "$before" ] || fail "Docker did not restart the container (RestartCount $(restarts))"
data_intact || fail "data missing after the restart"
echo "   ok: restarted by Docker (RestartCount $before -> $(restarts)), ready again, account, Workspace and Folder still there"

echo "== 2. The kernel kills the server for memory (limit lowered to 1 GiB for this part)"
# Files that need far more memory to draw than they weigh, made in a helper container without a limit.
docker run --rm --entrypoint node -v "$work:/out" --user "$(id -u):$(id -g)" "$image" -e "
const { createRequire } = require('node:module');
const { deflateSync } = require('node:zlib');
const fs = require('node:fs');
const sharp = createRequire('/app/packages/media/package.json')('sharp');
const pdf = (image) => {
  const head = Buffer.from('%PDF-1.4\n', 'latin1'); const parts = [head]; const offsets = []; let length = head.length;
  const add = (id, text, stream) => { offsets[id] = length; const chunks = stream ? [Buffer.from(id + ' 0 obj\n' + text + '\nstream\n', 'latin1'), stream, Buffer.from('\nendstream\nendobj\n', 'latin1')] : [Buffer.from(id + ' 0 obj\n' + text + '\nendobj\n', 'latin1')]; for (const c of chunks) { parts.push(c); length += c.length; } };
  const content = Buffer.from('q 595 0 0 842 0 0 cm /Im0 Do Q', 'latin1');
  add(1, '<< /Type /Catalog /Pages 2 0 R >>'); add(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  add(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >>');
  add(4, '<< /Length ' + content.length + ' >>', content);
  add(5, '<< /Type /XObject /Subtype /Image /Width ' + image.width + ' /Height ' + image.height + ' /ColorSpace /' + image.space + ' /BitsPerComponent 8 /Filter /' + image.filter + ' /Length ' + image.data.length + ' >>', image.data);
  let xref = 'xref\n0 6\n0000000000 65535 f \n'; for (let id = 1; id < 6; id++) xref += String(offsets[id]).padStart(10, '0') + ' 00000 n \n';
  parts.push(Buffer.from(xref + 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + length + '\n%%EOF\n', 'latin1'));
  return Buffer.concat(parts);
};
(async () => {
  for (const edge of [20000, 24000, 28000]) {
    const data = await sharp({ create: { width: edge, height: edge, channels: 3, background: '#7a1f2b' }, limitInputPixels: false }).jpeg({ progressive: true, quality: 50 }).toBuffer();
    fs.writeFileSync('/out/progressive-' + edge + '.pdf', pdf({ width: edge, height: edge, space: 'DeviceRGB', filter: 'DCTDecode', data }));
  }
  fs.writeFileSync('/out/bitmap.pdf', pdf({ width: 46000, height: 46000, space: 'DeviceGray', filter: 'FlateDecode', data: deflateSync(Buffer.alloc(46000 * 46000), { level: 6 }) }));
})();
"
run_server 1g
wait_ready || fail "the server did not become ready with the 1 GiB limit"
data_intact || fail "data missing after starting with the 1 GiB limit"
since="$(date +%s)"
killed=no
for file in "$work"/progressive-20000.pdf "$work"/bitmap.pdf "$work"/progressive-24000.pdf "$work"/progressive-28000.pdf; do
  code="$(curl -s -m 120 -o /dev/null -w '%{http_code}' -X POST -H "Origin: $origin" -H 'Content-Type: application/octet-stream' -H "X-File-Name: $(basename "$file")" -b "$work/cookies" --data-binary "@$file" "$origin/api/workspaces/$workspace/document-files" || true)"
  echo "   upload $(basename "$file") ($(($(wc -c < "$file") / 1000)) kB): HTTP ${code:-none}"
  sleep 3
  if [ "$(restarts)" -gt 0 ]; then killed=yes; break; fi
done
if [ "$killed" = yes ]; then
  oom_events="$(docker events --since "$since" --until "$(date +%s)" --filter "container=$name" --filter event=oom --format '{{.Action}}' | wc -l)"
  [ "$oom_events" -gt 0 ] || fail "the container restarted, but Docker reported no out-of-memory event"
  wait_ready || fail "the container did not come back after the out-of-memory kill"
  data_intact || fail "data missing after the out-of-memory restart"
  echo "   ok: the kernel killed the server for memory (Docker 'oom' events: $oom_events), Docker restarted it (RestartCount $(restarts)), ready again, data still there"
else
  echo "   NOT PROVOKED: none of the files made the server exceed 1 GiB — the out-of-memory path was not exercised"
fi

echo "== 3. An intentional stop stays stopped; starting again keeps the data"
run_server 4g
wait_ready || fail "the server did not become ready"
before="$(restarts)"
docker stop "$name" >/dev/null
sleep 20
[ "$(status)" = exited ] || fail "the container is '$(status)' 20 seconds after docker stop"
[ "$(restarts)" = "$before" ] || fail "Docker restarted a container that was stopped on purpose"
ready && fail "the server still answers after docker stop"
docker start "$name" >/dev/null
wait_ready || fail "the server did not become ready after docker start"
data_intact || fail "data missing after stop and start"
echo "   ok: it stayed stopped for 20 s (RestartCount unchanged) and ran again only after an explicit start; the data is there"

[ "$killed" = yes ] && echo "restart check passed" || echo "restart check passed, except that no out-of-memory kill could be provoked"
