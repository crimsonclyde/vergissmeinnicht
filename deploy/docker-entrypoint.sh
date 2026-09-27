#!/bin/sh
# Entry point of the VergissMeinNicht image. Every command reads the same runtime configuration
# (environment and *_FILE secrets), so operator commands act on the same database as the server.
set -eu
cd /app
command="${1:-serve}"
[ "$#" -gt 0 ] && shift
case "$command" in
  serve) exec node apps/server/src/main.ts ;;
  migrate | backup | verify | restore) exec node packages/database/src/ops-cli.ts "$command" "$@" ;;
  admin-bootstrap) exec node apps/server/src/cli/admin-bootstrap.ts "$@" ;;
  admin-recover) exec node apps/server/src/cli/admin-recover.ts "$@" ;;
  *)
    echo "Usage: serve | migrate | backup [--out FILE] | verify FILE | restore FILE [--force] | admin-bootstrap --email ADDRESS | admin-recover --email ADDRESS (--password|--totp)" >&2
    exit 2
    ;;
esac
