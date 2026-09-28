# Deployment

## Target

The supported V1 deployment is Docker Compose (`deploy/compose.yml`):

```text
Internet ──HTTPS──> Caddy (deploy/Caddyfile, automatic certificates, 172.31.250.2)
                         │  internal network 172.31.250.0/24
                         ▼
                   app container (Dockerfile): Fastify API + web app, user `node`, read-only root FS
                         │
                   volume `data` → /data: SQLite database, WAL files, backups/
```

- One application container; no ports published except Caddy's 80/443.
- Secrets come from Docker secrets (`*_FILE`), never from the image or the Compose file.
- Only Caddy's fixed address may set the client address (`TRUSTED_PROXIES=172.31.250.2`).
- The app runs as non-root (`node`, uid 1000) with all capabilities dropped, `no-new-privileges`, a read-only root file system and `/tmp` as tmpfs; `/data` is `0700`, database and backups `0600`.

**Unraid:** see [Installing on Unraid](unraid.md) (template, reverse proxy, `appdata`).

## Published images

Version tags (`v1.2.3`) publish a multi-architecture image (`linux/amd64`, `linux/arm64`) to GitHub Container Registry: `ghcr.io/crimsonclyde/vergissmeinnicht:1.2.3` (also `:1.2` and `:latest`). Each architecture is built natively, smoke-tested (migrate, CLI, backup, server ready, scheduled backup) and scanned (Trivy, no fixable HIGH/CRITICAL findings) before it is pushed. The image is signed keyless with Sigstore and carries a CycloneDX SBOM attestation. Verify before use and pin the digest:

```bash
cosign verify ghcr.io/crimsonclyde/vergissmeinnicht:1.2.3 \
  --certificate-identity-regexp '^https://github.com/crimsonclyde/vergissmeinnicht/\.github/workflows/release\.yml@refs/tags/v' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
cosign verify-attestation --type cyclonedx ghcr.io/crimsonclyde/vergissmeinnicht:1.2.3 \
  --certificate-identity-regexp '^https://github.com/crimsonclyde/vergissmeinnicht/\.github/workflows/release\.yml@refs/tags/v' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com > /dev/null
export VMN_IMAGE=ghcr.io/crimsonclyde/vergissmeinnicht:1.2.3@sha256:<digest shown by cosign>
docker compose pull app      # instead of `docker compose build`
```

Maintainers: push a tag `vX.Y.Z` to release; the first published package is private on GitHub until its visibility is set to public.

## Quick start (Docker Compose)

```bash
cd deploy
cp vergissmeinnicht.env.example vergissmeinnicht.env        # set PUBLIC_ORIGIN, SMTP_*, MAIL_FROM_*
mkdir -p secrets
openssl rand -base64 32 > secrets/auth_secret
openssl rand -base64 32 > secrets/data_encryption_key
chmod 0400 secrets/*                                         # readable by uid 1000 (the container user)
export VMN_DOMAIN=vmn.example.org                            # DNS must point here for certificates
docker compose build
docker compose run --rm app migrate                          # creates / upgrades the database
docker compose up -d
docker compose run --rm app admin-bootstrap --email admin@example.org
```

`deploy/vergissmeinnicht.env` and `deploy/secrets/` are git-ignored. Keep a copy of `data_encryption_key` outside the server (see below). `docker compose ps` shows the app as `healthy` once it is ready.

The image entry point knows these commands (all use the same configuration as the server):

| Command | Purpose |
| --- | --- |
| `serve` (default) | Start the server. |
| `migrate` | Back up the database if migrations are pending (`/data/backups/…-pre-migration.sqlite`), then apply them. |
| `backup [--out FILE]` | Consistent online backup (server may keep running), verified. |
| `verify FILE` | Check a backup (integrity, foreign keys, schema). |
| `restore FILE [--force]` | Replace the database with a backup — **server stopped** (refused while it has the database open). |
| `housekeeping` | Delete expired rows now (the server also does this at start and hourly, see below). |
| `admin-bootstrap --email …` / `admin-recover --email … (--password\|--totp)` | See "First server admin" and "Account recovery". |

Use `docker compose run --rm app <command>` when the app is stopped, or `docker compose exec app vergissmeinnicht <command>` while it runs (backups).

## Configuration

Inject configuration at runtime. The production server never reads `.env` files and refuses to start (exit code 1, listing the invalid variable names) if a required value is missing or invalid.

| Variable | Production | Notes |
| --- | --- | --- |
| `NODE_ENV` | `production` (set by `pnpm start`) | Must be exactly `development`, `test` or `production`. |
| `AUTH_SECRET` | **required** | ≥32 characters, e.g. `openssl rand -base64 32`. Treat as a credential; prefer a secret store / Docker secret over plain env where possible. |
| `DATA_ENCRYPTION_KEY` | **required** | ≥32 characters, different from `AUTH_SECRET`. Encrypts TOTP secrets at rest. **Back it up separately from the database and never change it** (see below). |
| `PUBLIC_ORIGIN` | **required** | External origin, e.g. `https://vmn.example.org`. Must be `https` (plain `http` only for loopback). |
| `DATABASE_PATH` | **required** | Absolute path on the persistent volume. |
| `HOST` | optional | Default `127.0.0.1`. In a container set `0.0.0.0` and expose only via the reverse proxy. |
| `PORT` | optional | Default `3000`. |
| `LOG_LEVEL` | optional | `info` (default), `warn`, `error`, `fatal`, `silent`. `debug`/`trace` are rejected in production. |
| `SMTP_HOST` | **required** | Outgoing mail server. |
| `SMTP_PORT` | optional | Default `587`. |
| `SMTP_SECURITY` | optional | `starttls` (default, upgrade required), `tls` (implicit), `none` (only for a loopback relay). Certificates are always verified; TLS ≥1.2. |
| `SMTP_USER` / `SMTP_PASSWORD` | optional | Set both or neither. Treat the password as a credential. |
| `MAIL_FROM_ADDRESS` | **required** | Sender address, e.g. `noreply@vmn.example.org`. |
| `MAIL_FROM_NAME` | optional | Default `VergissMeinNicht`. |
| `INVITATION_TTL_HOURS` | optional | Default `72`, range 1–720. |
| `TRUSTED_PROXIES` | behind a proxy | Comma-separated IPs/CIDR ranges (or `loopback`) of reverse proxies whose `X-Forwarded-For` is trusted. Empty (default): the socket address is the client. Never use broad ranges: every trusted address can claim any client address. `/0` is rejected. |
| `HSTS_MAX_AGE` | optional | Strict-Transport-Security max-age in seconds for https origins (default one year, `0` disables; no `includeSubDomains`/`preload`). |
| `BACKUP_INTERVAL_HOURS` | optional | Automatic backups every N hours into `/data/backups` (`0`/unset = off). See "Backups and restore". |
| `VMN_MIGRATE_ON_START` | optional | `true`: the `serve` command first runs `migrate` (backup first if anything is pending). For platforms where a separate migrate run is impractical (Unraid). Default off. |
| `BACKUP_KEEP` | optional | Number of automatic backups kept (default 14); manual and pre-migration backups are never deleted. |
| `AUTH_SECRET_FILE`, `DATA_ENCRYPTION_KEY_FILE`, `SMTP_PASSWORD_FILE` | recommended | Absolute path of a file holding the secret (Docker secrets: `/run/secrets/…`); a trailing line break is ignored. Set either the variable or its `_FILE`, not both. |
| `SOURCE_CODE_URL` | optional | `https` link to the source of the running version, shown in every page footer (AGPL-3.0 §13). Default: the upstream repository. **Set it to your own repository if you run a modified version.** |

`PUBLIC_ORIGIN` must be exactly the origin users type in the browser: every state-changing request whose `Origin` header differs is rejected (CSRF protection). In production the session cookie is `__Secure-vmn.session_token` (`Secure`, `HttpOnly`, `SameSite=Strict`), so the site must be served over HTTPS (loopback excepted).

### Rotating `AUTH_SECRET`

`AUTH_SECRET` signs session cookies. To rotate it (routinely or after a suspected leak of the secret or of the database): stop the server, replace the secret, start the server. All existing sessions become invalid and every user has to sign in again; no data is lost. Invitation links and TOTP enrollments are unaffected (they are not derived from the secret).

### `DATA_ENCRYPTION_KEY`

TOTP authenticator secrets are encrypted with this key. If it is lost or changed, every enrolled authenticator stops working: users can still sign in with a recovery code and re-enroll, otherwise an admin or operator TOTP reset is needed (see Account recovery). A re-encryption tool for planned key rotation does not exist yet — do not rotate it. Keep a copy of the key outside the server (e.g. in the operator's password manager) and store it separately from database backups: the encryption protects stolen database files only as long as the key is not stored alongside them.

## Migrations and upgrades

The server never migrates on its own; it reports pending migrations as not ready (`GET /api/health/ready` → `503 migrations_pending`, container `unhealthy`). Upgrade procedure:

```bash
git pull                                   # or fetch the new release
docker compose build
docker compose stop app
docker compose run --rm app migrate        # automatic backup first if anything is pending
docker compose up -d
```

Without Docker: `NODE_ENV=production DATABASE_PATH=/data/vergissmeinnicht.sqlite node packages/database/src/ops-cli.ts migrate`. Migrations are committed files; a failed migration leaves the pre-migration backup to restore (see Backups).

## Reverse proxy, HTTPS and rate limits

HTTPS is mandatory; the Compose setup uses Caddy, which obtains and renews certificates automatically. Sign-in, invitation, Knot and global request limits count per client address, so the app must know the real client:

- `TRUSTED_PROXIES` lists exactly the proxy's address. The app then takes the client from `X-Forwarded-For` as set by that proxy; headers from any other address are ignored (tested: a client cannot escape its limit by sending the header itself).
- With your own proxy instead of Caddy: terminate TLS there, forward to the app's port 3000 on a private network, **overwrite** (not append to) `X-Forwarded-For` or make sure the proxy's own address is the one in `TRUSTED_PROXIES`, disable response buffering for `/api/workspaces/*/runs/*/events` (Server-Sent Events; nginx: the app sends `X-Accel-Buffering: no`), and do not enable response compression.
- Access logs: the app redacts `/knot/{token}` and link tokens from its own request logs. Proxy access logs would contain them — keep them off (the Caddyfile has none) or filter the URI.
- The app sends HSTS (one year) for https origins, CSP without inline styles/scripts, `Referrer-Policy: no-referrer`, `Permissions-Policy`, `X-Content-Type-Options`, `Cache-Control: no-store` on the API.
- Limits of security-sensitive routes (sign-in per client and per account, second factor, recovery and invitation links, password/TOTP changes, admin recovery/invitations/account status, Knot resolution) are kept in the database (`rate_limits`, key hashes only), so a restart does not reset them. The global per-client limit and other route limits are in memory. All of it is per server process/database: multi-node deployments need a reviewed shared store.
- Private networks (VPN, Tailscale) do not replace the application's authentication; keep HTTPS and the normal configuration there too.

## Footer

Every page shows "VergissMeinNicht (VMN) with 🖤 by CrimsonClyde - Licence: AGPL-3.0", the name linking to the source code (`SOURCE_CODE_URL`). A server admin can hide it for everyone under *Server admin → This server*; it then stays in the page source with the `hidden` attribute. If you run a **modified** version for others, the AGPL still requires you to offer its source in a visible way.

## Offline use

The web app installs a service worker (production builds) that keeps the app shell, so Runs opened on a device can be executed without a connection (steps.md 8.5). Service workers require HTTPS (or `localhost`); nothing needs to be configured. Reverse proxies must not cache `/api/*` (the app sends `Cache-Control: no-store`) and should pass `/sw.js` through unchanged. After an upgrade, browsers pick up the new app shell on their next online page load.

## Housekeeping

The server deletes rows that can no longer be used at start and then hourly: expired sessions and verification values, used or expired sign-in challenges, TOTP enrollments not confirmed within 10 minutes, expired rate-limit windows, and invitations / account-recovery links that were accepted, revoked or expired **more than 30 days ago**. Security events, audit history, Runs and Knots are never deleted. Only counts are logged. `pnpm db:housekeeping` (or the `housekeeping` image command) runs the same purge on demand.

## Health checks

- `GET /api/health` — liveness (process answers).
- `GET /api/health/ready` — readiness: database reachable and all migrations applied; `503` with a reason code otherwise. The image's `HEALTHCHECK` uses it.

## First server admin

After the first deployment and migrations, create the first server admin from a shell with the production environment:

```bash
docker compose run --rm app admin-bootstrap --email admin@example.org
# without Docker: NODE_ENV=production node apps/server/src/cli/admin-bootstrap.ts --email admin@example.org
```

The command prints a single-use invitation link to the terminal (it is not emailed or logged). Treat it like a password. Running it again replaces the previous link. Open the link, choose a display name and a password (at least 15 characters), then sign in. Once a server admin exists, the command refuses to run and unused bootstrap links stop working; further accounts are invited by a server admin on the "Server admin" page.

## Account recovery

There is no self-service "forgot password" email. A server admin starts a recovery on the "Server admin" page (password reset, two-factor reset or both; requires the admin's password and TOTP code) and the user receives a single-use link valid for 60 minutes at their own email address. Before starting one, verify the request through a second channel (in person, phone) — recovery requests are a classic social-engineering target.

If no admin can act (e.g. the only server admin lost the authenticator), use the operator CLI with the production environment:

```bash
docker compose run --rm app admin-recover --email admin@example.org --totp       # lost authenticator
docker compose run --rm app admin-recover --email admin@example.org --password   # forgotten password
```

It prints the link to the terminal (not emailed, not logged). A two-factor-only reset asks the user for their current password. Completing a recovery signs the account out everywhere.

## Backups and restore

A backup is a complete copy of everything sensitive: accounts and password hashes, session tokens, encrypted TOTP secrets, Workspace content and the audit history. Treat backups like the live database: private storage, encrypted when they leave the server (e.g. `age`/`gpg` or an encrypted backup tool), access restricted.

**What to back up**

1. The database, via the backup command (never by copying the live file: a copy taken while the server writes can be inconsistent, and the WAL file holds recent changes).
2. `DATA_ENCRYPTION_KEY` — separately (password manager). Without it, restored TOTP enrollments do not work (users fall back to recovery codes/admin reset); stored together with the database it would defeat the encryption.
3. Your configuration (`vergissmeinnicht.env`, Caddyfile). `AUTH_SECRET` does not need a backup: a new one only signs everyone out.

**Create a backup** (the server keeps running):

```bash
docker compose exec app vergissmeinnicht backup                        # → /data/backups/vergissmeinnicht-<UTC time>.sqlite
docker compose cp app:/data/backups/<file> ./                          # copy it off the server, then encrypt it
```

The backup uses SQLite's online backup API (consistent, includes the WAL), is written with mode `0600`, converted to a single self-contained file and verified (integrity check, foreign keys, expected tables) before the command reports success.

**Scheduled backups** (built in, off by default): set `BACKUP_INTERVAL_HOURS` (e.g. `24`) and optionally `BACKUP_KEEP` (default `14`). The server checks every 10 minutes and writes `/data/backups/vergissmeinnicht-auto-<UTC time>.sqlite` whenever the newest automatic backup is older than the interval (so restarts neither skip nor repeat one), then keeps the newest `BACKUP_KEEP` automatic backups. Manual (`vergissmeinnicht-<time>.sqlite`) and pre-migration backups are never deleted by the app. The backups stay on the same volume as the database: they protect against mistakes and corruption, not against losing the server — copy them off the host **encrypted**, with established tools, for example:

```bash
# on the host, e.g. daily from cron/systemd, after the scheduled backup
docker compose cp app:/data/backups/. ./vmn-backups/
age -r <recipient public key> -o vmn-$(date +%F).tar.age <(tar -C ./vmn-backups -c .)   # or: restic backup ./vmn-backups
```

The app does no encryption of its own (no home-made cryptography); keep the private key of the recipient off the server.

**Restore**

```bash
docker compose cp ./vergissmeinnicht-<time>.sqlite app:/data/backups/  # if it is not on the volume
docker compose run --rm app verify /data/backups/vergissmeinnicht-<time>.sqlite
docker compose stop app
docker compose run --rm app restore /data/backups/vergissmeinnicht-<time>.sqlite
docker compose run --rm app migrate                                     # if the backup is from an older version
docker compose up -d
```

`restore` refuses to run while any process has the database open (it needs an exclusive SQLite lock), verifies the backup first, and keeps the replaced database as `vergissmeinnicht.sqlite.before-restore-<time>` (plus its WAL/SHM files) — delete that manually once the restore is confirmed. Sessions in the backup are valid again after a restore; rotate `AUTH_SECRET` if you restore after a suspected compromise.

**Tested procedure** (2026-09-27, `docu/steps.md` 10.2): automated tests back up a database with uncheckpointed WAL changes, restore it, and check contents, file modes, refusal while the database is open (also idle with an empty WAL) and rejection of damaged or foreign files. The full container drill — migrate, start behind Caddy, create data, `backup` while running, change data, restore refused while running, stop, restore, start, data back to the backup state, healthy — was run against the image. Repeat a restore drill on a spare machine regularly: a backup that was never restored is not verified.
