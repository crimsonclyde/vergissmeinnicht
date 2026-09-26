# Deployment

## Target

A simple self-hosted deployment:

```text
HTTPS reverse proxy
       |
Vergissmeinnicht container
       |
persistent volume
  SQLite + runtime data
```

## Requirements

- HTTPS is mandatory in production.
- Application authentication/ACLs remain required even on Tailscale/private networks.
- Persistent data survives container replacement.
- Secrets are injected at runtime and never baked into images.
- Run non-root where practical.
- Restrict writable filesystem paths.
- Explicitly configure trusted reverse proxies.
- Do not trust spoofable forwarded headers.
- Apply controlled DB migrations.
- Protect backups as sensitive data.

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
| `MAIL_FROM_NAME` | optional | Default `Vergissmeinnicht`. |
| `INVITATION_TTL_HOURS` | optional | Default `72`, range 1–720. |

`PUBLIC_ORIGIN` must be exactly the origin users type in the browser: every state-changing request whose `Origin` header differs is rejected (CSRF protection). In production the session cookie is `__Secure-vmn.session_token` (`Secure`, `HttpOnly`, `SameSite=Strict`), so the site must be served over HTTPS (loopback excepted).

### Rotating `AUTH_SECRET`

`AUTH_SECRET` signs session cookies. To rotate it (routinely or after a suspected leak of the secret or of the database): stop the server, replace the secret, start the server. All existing sessions become invalid and every user has to sign in again; no data is lost. Invitation links and TOTP enrollments are unaffected (they are not derived from the secret).

### `DATA_ENCRYPTION_KEY`

TOTP authenticator secrets are encrypted with this key. If it is lost or changed, every enrolled authenticator stops working: users can still sign in with a recovery code and re-enroll, otherwise an admin reset (Step 2.5) is needed. A re-encryption tool for planned key rotation does not exist yet — do not rotate it. Keep a copy of the key outside the server (e.g. in the operator's password manager) and store it separately from database backups: the encryption protects stolen database files only as long as the key is not stored alongside them.

## Migrations

The server does not migrate the database on startup. Apply committed migrations before starting a new version, with the production environment:

```bash
NODE_ENV=production DATABASE_PATH=/data/vergissmeinnicht.sqlite node packages/database/src/migrate.ts
```

Back up the database first (see Backups). The controlled production procedure (container entrypoint) follows in Step 10.1.

## Reverse proxy and rate limits

Sign-in, invitation and global request limits are counted per client address. The application does not yet trust forwarding headers (`trustProxy: false`, Step 10.3): behind a reverse proxy every request appears to come from the proxy, so all users share one limit and a single attacker can temporarily block everyone's sign-in. Until trusted-proxy configuration exists, treat proxied production deployments as not ready.

## First server admin

After the first deployment and migrations, create the first server admin from a shell with the production environment:

```bash
NODE_ENV=production node apps/server/src/cli/admin-bootstrap.ts --email admin@example.org
```

The command prints a single-use invitation link to the terminal (it is not emailed or logged). Treat it like a password. Running it again replaces the previous link. Open the link, choose a display name and a password (at least 15 characters), then sign in. Once a server admin exists, the command refuses to run and unused bootstrap links stop working; further accounts are invited by a server admin (`POST /api/admin/invitations`; a web UI follows).

## Backups

Before calling backup support complete, documentation must include:

1. how to create a consistent SQLite backup;
2. what files/data are required;
3. restore steps;
4. a tested restore procedure.

A backup process that has never been restored is not verified.
