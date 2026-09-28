#!/bin/sh
# Entry point of the VergissMeinNicht image. Every command reads the same runtime configuration
# (environment and *_FILE secrets), so operator commands act on the same database as the server.
set -eu
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
