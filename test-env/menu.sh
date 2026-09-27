#!/usr/bin/env bash
# Menu for the local test environment: install/start, stop, uninstall, status.
#
#   test-env/menu.sh
#
# Uses whiptail when available, a plain numbered menu otherwise.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
HERE="$REPO_ROOT/test-env"

status() {
  local pid
  pid="$(server_pid)"
  if [[ -n "$pid" ]] && server_healthy; then
    echo "Server:   running at $TEST_ORIGIN (PID $pid)"
  elif [[ -d "$STATE_DIR" ]]; then
    echo "Server:   stopped (data kept; choose Install / start)"
  else
    echo "Server:   not installed"
  fi
  if mailpit_running; then echo "Mailpit:  running at $MAILPIT_UI"; else echo "Mailpit:  not running"; fi
  [[ -f "$CREDENTIALS_FILE" ]] && echo "Accounts: see $CREDENTIALS_FILE"
  return 0
}

choose() {
  local current
  current="$(status)"
  # Runs inside $(...): stdout is captured, so check stdin/stderr for a terminal.
  if command -v whiptail >/dev/null && [[ -t 0 && -t 2 ]]; then
    whiptail --title "Vergissmeinnicht test environment" --notags --menu "$current" 20 78 5 \
      install "Install / start (keeps existing demo data)" \
      stop "Stop (keep data)" \
      uninstall "Uninstall (stop and delete all test data)" \
      status "Show status and demo accounts" \
      quit "Quit" 3>&1 1>&2 2>&3 || echo quit
  else
    echo "Vergissmeinnicht test environment" >&2
    echo "$current" >&2
    PS3="Choose: "
    select option in "Install / start" "Stop (keep data)" "Uninstall (delete all test data)" "Status" "Quit"; do
      case "$REPLY" in
        1) echo install ;;
        2) echo stop ;;
        3) echo uninstall ;;
        4) echo status ;;
        *) echo quit ;;
      esac
      break
    done
  fi
}

confirm_uninstall() {
  local question="Delete the test environment, including its database, generated secrets and demo accounts?"
  if command -v whiptail >/dev/null && [[ -t 0 && -t 1 ]]; then
    whiptail --title "Uninstall" --yesno "$question" 10 70
  else
    read -r -p "$question [y/N] " answer
    [[ "$answer" == [yY]* ]]
  fi
}

case "$(choose)" in
  install) "$HERE/install.sh" ;;
  stop) "$HERE/uninstall.sh" --stop ;;
  uninstall)
    if confirm_uninstall; then "$HERE/uninstall.sh"; else echo "Cancelled."; fi
    ;;
  status)
    status
    [[ -f "$CREDENTIALS_FILE" ]] && cat "$CREDENTIALS_FILE"
    ;;
  *) ;;
esac
