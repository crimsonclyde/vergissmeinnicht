#!/usr/bin/env bash
# Upgrade check with data (section 18c): a data volume populated through the HTTP API of a published image is
# upgraded by a new image — row counts, foreign keys and integrity compared — and the upgraded server then makes a
# Workspace backup of the old Workspace and restores it. Uses only fictional data and throw-away secrets.
# Usage: deploy/upgrade-check.sh <new image> [<published image, default 0.6.0-beta.2>]
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
NEW="${1:?usage: upgrade-check.sh <new image> [<published image>]}"
OLD="${2:-ghcr.io/crimsonclyde/vergissmeinnicht:0.6.0-beta.2}"
VOL=vmn-upgrade-check
PORT=3298
ENVS=(-e NODE_ENV=production -e PUBLIC_ORIGIN=http://localhost:$PORT -e AUTH_SECRET=8c0c6d3e0a9b4f7aa1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718 -e DATA_ENCRYPTION_KEY=q6Zr3lWb0n0b1i1o2u3yGmZ0c2VjcmV0a2V5MTIzNDU= -e SMTP_HOST=localhost -e SMTP_SECURITY=none -e MAIL_FROM_ADDRESS=vmn@example.org)
COUNT_JS='const D=require("better-sqlite3");const d=new D("/data/vergissmeinnicht.sqlite",{readonly:true});const t=d.prepare("SELECT name FROM sqlite_master WHERE type=? AND name NOT LIKE ? AND name NOT LIKE ? ORDER BY name").all("table","sqlite_%","__drizzle%").map(r=>r.name);const o={};for(const n of t)o[n]=d.prepare("SELECT count(*) AS c FROM \""+n+"\"").get().c;o.__level=d.prepare("SELECT count(*) AS c FROM __drizzle_migrations").get().c;o.__fk=d.pragma("foreign_key_check").length;o.__integrity=d.pragma("integrity_check",{simple:true});console.log(JSON.stringify(o));'
count() { docker run --rm -v $VOL:/data -w /app/packages/database --entrypoint node "$1" -e "$COUNT_JS"; }
wait_ready() { for _ in $(seq 1 60); do curl -sf http://localhost:$PORT/api/health/ready >/dev/null && return 0; sleep 1; done; echo "not ready"; docker logs "$1" | tail -20; return 1; }
cleanup() { docker rm -f vmn-upgrade-old vmn-upgrade-new >/dev/null 2>&1 || true; docker volume rm -f $VOL >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup; docker volume rm -f $VOL >/dev/null

echo "== beta.2: migrate, bootstrap, serve, populate"
docker run --rm -v $VOL:/data "${ENVS[@]}" $OLD migrate | tail -1
link=$(docker run --rm -v $VOL:/data "${ENVS[@]}" $OLD admin-bootstrap --email admin@example.org | grep -o '/invite/[A-Za-z0-9_-]*')
docker run -d --name vmn-upgrade-old -v $VOL:/data -p $PORT:3000 "${ENVS[@]}" $OLD >/dev/null
wait_ready vmn-upgrade-old
node "$here/upgrade-check-client.mjs" populate http://localhost:$PORT "$link"
docker rm -f vmn-upgrade-old >/dev/null
before=$(count $OLD); echo "before: $before"

echo "== new image: migrate (backup first), check rows, serve, export + restore"
docker run --rm -v $VOL:/data "${ENVS[@]}" "$NEW" migrate | tail -2
after=$(count "$NEW"); echo "after:  $after"
# Every row that existed is still there; foreign keys and integrity hold.
node -e 'const [b,a]=process.argv.slice(1).map((x)=>JSON.parse(x));const bad=Object.keys(b).filter((k)=>k!=="__level"&&b[k]!==a[k]);if(bad.length>0||a.__fk!==0||a.__integrity!=="ok"||a.__level<=b.__level){console.error("upgrade changed:",bad,a.__fk,a.__integrity);process.exit(1)}' "$before" "$after"
docker run -d --name vmn-upgrade-new -v $VOL:/data -p $PORT:3000 "${ENVS[@]}" "$NEW" >/dev/null
wait_ready vmn-upgrade-new
node "$here/upgrade-check-client.mjs" verify http://localhost:$PORT
final=$(count "$NEW"); echo "final:  $final"
node -e 'const f=JSON.parse(process.argv[1]);if(f.__fk!==0||f.__integrity!=="ok"||f.workspace_restore_marks!==0||f.workspaces!==2){console.error("after restore:",f);process.exit(1)}' "$final"
docker run --rm -v $VOL:/data --entrypoint sh "$NEW" -c 'ls /data/backups | head -5; ls -la /data/workspace-backups 2>/dev/null | wc -l'
docker logs vmn-upgrade-new 2>&1 | grep -c '"level":50' || true
echo "upgrade check passed: $OLD → $NEW"
