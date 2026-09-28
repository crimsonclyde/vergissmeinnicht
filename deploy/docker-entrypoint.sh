#!/bin/sh
# Entry point of the VergissMeinNicht image. Every command reads the same runtime configuration
# (environment and *_FILE secrets), so operator commands act on the same database as the server.
set -eu

# The application never runs as root. If the container is started as root — e.g. by Unraid's
# per-container Tailscale, which needs root to set itself up — switch to PUID:PGID (default: the
# image's `node` user, 1000:1000) with no capabilities left, then continue as that user.
if [ "$(id -u)" = "0" ]; then
  uid="${PUID:-1000}"
  gid="${PGID:-1000}"
  case "$uid:$gid" in
    *[!0-9:]* | :* | *:) echo "PUID and PGID must be numeric user and group ids" >&2; exit 2 ;;
  esac
  if [ "$uid" -eq 0 ] || [ "$gid" -eq 0 ]; then
    echo "Refusing to run the application as root (PUID/PGID 0)" >&2
    exit 2
  fi
  # The data directory must belong to that user: a folder created by root on the host, or files left
  # by an earlier start as another user, would otherwise make the database unreadable. Only the data
  # directory is touched — not the Tailscale state Unraid's hook keeps there, never the secrets — and
  # symbolic links are neither followed nor changed.
  data="$(dirname "${DATABASE_PATH:-/data/vergissmeinnicht.sqlite}")"
  if [ -d "$data" ]; then
    find "$data" -path "$data/.tailscale_state" -prune -o \( ! -type l \( ! -user "$uid" -o ! -group "$gid" \) \) -exec chown "$uid:$gid" {} + \
      && chmod 0700 "$data" \
      || echo "Warning: could not give $data to $uid:$gid; the database may not open" >&2
  fi
  exec setpriv --reuid="$uid" --regid="$gid" --clear-groups --inh-caps=-all --bounding-set=-all -- "$0" "$@"
fi

cd /app
command="${1:-serve}"
[ "$#" -gt 0 ] && shift
case "$command" in
  serve)
    # Opt-in for platforms where a separate `migrate` run before starting is impractical (e.g. Unraid):
    # the same command as `migrate` — backup first if anything is pending — then the server.
    if [ "${VMN_MIGRATE_ON_START:-false}" = "true" ]; then
      node packages/database/src/ops-cli.ts migrate
    fi
    exec node apps/server/src/main.ts
    ;;
  migrate | backup | verify | restore | housekeeping) exec node packages/database/src/ops-cli.ts "$command" "$@" ;;
  admin-bootstrap) exec node apps/server/src/cli/admin-bootstrap.ts "$@" ;;
  admin-recover) exec node apps/server/src/cli/admin-recover.ts "$@" ;;
  *)
    echo "Usage: serve | migrate | backup [--out FILE] | verify FILE | restore FILE [--force] | housekeeping | admin-bootstrap --email ADDRESS | admin-recover --email ADDRESS (--password|--totp)" >&2
    exit 2
    ;;
esac
