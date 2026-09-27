# Local test environment

A ready-to-use instance for trying the app by hand. It comes with demo accounts for every role.

```bash
test-env/menu.sh        # menu: Install / start · Stop · Uninstall · Status
test-env/install.sh     # install and start (again after a reboot: keeps the demo data)
test-env/uninstall.sh   # stop and delete everything the test environment created
test-env/uninstall.sh --stop   # stop only, keep data
```

Requirements: Node.js 24+, `curl`, `openssl`, Docker (for Mailpit, unless one already runs on port 8025). pnpm is needed only if `node_modules` is missing. The menu uses `whiptail` when installed and a numbered menu otherwise.

## What `install.sh` does

1. Installs dependencies if needed and builds the web app.
2. Creates `.var/test-env/` (git-ignored, `0700`) with generated `AUTH_SECRET` / `DATA_ENCRYPTION_KEY` in `server.env` (`0600`).
3. Starts Mailpit from `compose.dev.yml` under the Compose project `vmn-testenv`, or reuses a Mailpit that is already running.
4. Migrates a separate SQLite database (`.var/test-env/vergissmeinnicht.sqlite`) and starts the server in **production mode** on **http://127.0.0.1:3200** (override the port with `VMN_TEST_PORT`).
5. On first install, creates demo data through the normal HTTP API and the real invitation emails (`seed.ts`): the bootstrap admin, four invited accounts and two Workspaces. All accounts share one random password. It is printed at the end and kept in `.var/test-env/credentials.txt` (`0600`).

| Account | Server admin | Demo Household | Demo Office |
|---|---|---|---|
| admin@vmn.test | yes | ADMIN | ADMIN |
| editor@vmn.test | – | EDITOR | – |
| user@vmn.test | – | USER | – |
| guest@vmn.test | – | GUEST | – |
| outsider@vmn.test | – | – | USER |

Open **http://127.0.0.1:3200** exactly. Other spellings such as `localhost` fail the server's Origin check. Use a private window or another browser profile to be signed in as two people at once. Emails (new invitations, recovery links) arrive at http://127.0.0.1:8025.

## Isolation

The test environment never uses or modifies your development `.env`, `.var/vergissmeinnicht.sqlite` or ports 3000/5173. `uninstall.sh`:

- stops only the server whose PID it recorded, after checking that it is this repository's server;
- stops Mailpit only if `install.sh` started it;
- deletes only `.var/test-env/`.

This is a local testing aid, not a deployment. The generated secrets and the demo password protect nothing but throwaway data. Never point it at real data and never expose port 3200 beyond your machine.
