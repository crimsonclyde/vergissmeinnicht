#!/usr/bin/env bash
# Stops and removes the local test environment.
#
#   test-env/uninstall.sh          stop the server, stop Mailpit (if install.sh started it) and
#                                  delete .var/test-env (test DB, generated secrets, log, credentials)
#   test-env/uninstall.sh --stop   only stop the server and Mailpit; keep the data for the next install.sh
#
# Never touches your normal development setup (.env, .var/vergissmeinnicht.sqlite, node_modules).
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

keep_data=false
case "${1:-}" in
  '') ;;
  --stop) keep_data=true ;;
  *) die "Usage: $0 [--stop]" ;;
esac

pid="$(server_pid)"
if [[ -n "$pid" ]]; then
  info "Stopping the server (PID $pid)"
  kill -TERM "$pid" 2>/dev/null || true
  for _ in $(seq 1 20); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.25
  done
  if kill -0 "$pid" 2>/dev/null; then
    warn "Server did not stop in time; killing it"
    kill -KILL "$pid" 2>/dev/null || true
  fi
  ok "Server stopped"
else
  ok "Server is not running"
fi
rm -f "$PID_FILE"

if [[ -f "$MAILPIT_MARKER" ]]; then
  info "Stopping Mailpit"
  if command -v docker >/dev/null && compose down >/dev/null 2>&1; then
    ok "Mailpit stopped"
  else
    warn "Could not stop Mailpit; try: docker compose -p $COMPOSE_PROJECT -f compose.dev.yml down"
  fi
  rm -f "$MAILPIT_MARKER"
elif mailpit_running; then
  ok "Leaving the Mailpit alone that was already running before the test environment"
fi

if $keep_data; then
  ok "Stopped. Data kept in $STATE_DIR; run test-env/install.sh to start again."
else
  # Guard against ever deleting anything outside the repository's state directory.
  [[ "$STATE_DIR" == "$REPO_ROOT/.var/test-env" ]] || die "Unexpected state directory: $STATE_DIR"
  rm -rf -- "$STATE_DIR"
  ok "Removed $STATE_DIR (test database, generated secrets, log, credentials)"
fi
