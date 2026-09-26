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

Rotating `AUTH_SECRET` invalidates existing sessions; a documented rotation procedure follows with authentication (Step 2.x).

## Backups

Before calling backup support complete, documentation must include:

1. how to create a consistent SQLite backup;
2. what files/data are required;
3. restore steps;
4. a tested restore procedure.

A backup process that has never been restored is not verified.
