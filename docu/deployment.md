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

## Backups

Before calling backup support complete, documentation must include:

1. how to create a consistent SQLite backup;
2. what files/data are required;
3. restore steps;
4. a tested restore procedure.

A backup process that has never been restored is not verified.
