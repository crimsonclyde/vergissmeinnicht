# Shared settings and helpers for the local test environment. Sourced by install.sh,
# uninstall.sh and menu.sh; not meant to be run directly.
#
# The test environment is isolated from normal development:
#   - own state directory (.var/test-env, git-ignored): config, SQLite DB, logs, PID, credentials
#   - own port (TEST_PORT) instead of 3000/5173
#   - production mode (same code path as a deployment: Secure cookies, no debug logs)
#   - Mailpit from compose.dev.yml under its own Compose project name

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$REPO_ROOT/.var/test-env"
ENV_FILE="$STATE_DIR/server.env"
PID_FILE="$STATE_DIR/server.pid"
LOG_FILE="$STATE_DIR/server.log"
CREDENTIALS_FILE="$STATE_DIR/credentials.txt"
SEEDED_MARKER="$STATE_DIR/seeded"
MAILPIT_MARKER="$STATE_DIR/mailpit-started-by-test-env"

TEST_PORT="${VMN_TEST_PORT:-3200}"
# 127.0.0.1 rather than localhost: the server binds IPv4 loopback only.
TEST_ORIGIN="http://127.0.0.1:$TEST_PORT"
MAILPIT_UI="http://127.0.0.1:8025"
COMPOSE_PROJECT="vmn-testenv"

if [[ -t 1 ]]; then
  BOLD=$'\e[1m' GREEN=$'\e[32m' YELLOW=$'\e[33m' RED=$'\e[31m' RESET=$'\e[0m'
else
  BOLD='' GREEN='' YELLOW='' RED='' RESET=''
fi

info() { printf '%s==>%s %s\n' "$BOLD" "$RESET" "$*"; }
ok() { printf '%s✓%s %s\n' "$GREEN" "$RESET" "$*"; }
warn() { printf '%s!%s %s\n' "$YELLOW" "$RESET" "$*" >&2; }
die() {
  printf '%s✗ %s%s\n' "$RED" "$*" "$RESET" >&2
  exit 1
}

# PID of the running test server, or nothing. Only trusts the PID file if that process really is
# this repository's server, so a recycled PID is never killed by mistake.
server_pid() {
  [[ -f "$PID_FILE" ]] || return 0
  local pid
  pid="$(<"$PID_FILE")"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 0
  if [[ -r "/proc/$pid/cmdline" ]] && tr '\0' ' ' <"/proc/$pid/cmdline" | grep -q "apps/server/src/main.ts"; then
    echo "$pid"
  fi
}

mailpit_running() {
  curl -fsS -m 2 "$MAILPIT_UI/api/v1/info" >/dev/null 2>&1
}

server_healthy() {
  curl -fsS -m 2 "$TEST_ORIGIN/api/health" >/dev/null 2>&1
}

compose() {
  docker compose -p "$COMPOSE_PROJECT" -f "$REPO_ROOT/compose.dev.yml" "$@"
}
