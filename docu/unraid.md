# Installing on Unraid

VergissMeinNicht runs on Unraid as one container. Because Unraid's own web interface normally uses ports 80/443, it runs **behind the reverse proxy you already use** (Nginx Proxy Manager or SWAG) instead of the Caddy from the Compose setup. HTTPS is required: sign-in cookies are `Secure`, and the app refuses a plain-HTTP address.

Tested with the image run exactly as the template does it: user `99:100` (Unraid's `nobody:users`), read-only root file system, no capabilities, `appdata` bind mounts, secrets from files, database updates on start.

## What you need

- A domain (or subdomain), e.g. `vmn.example.org`, pointing at your Unraid server, and a reverse proxy with Let's Encrypt (Nginx Proxy Manager or SWAG) on a **custom Docker network** (below: `proxynet`).
- An email account the server can send from (SMTP) — for invitations and account recovery.

## 1. Folders and secrets

Unraid **Terminal**:

```bash
mkdir -p /mnt/user/appdata/vergissmeinnicht/data /mnt/user/appdata/vergissmeinnicht/secrets
cd /mnt/user/appdata/vergissmeinnicht
openssl rand -base64 32 > secrets/auth_secret
openssl rand -base64 32 > secrets/data_encryption_key
# only if your mail server needs a login:
# printf '%s' 'the-smtp-password' > secrets/smtp_password
chown -R 99:100 . && chmod 0700 data secrets && chmod 0400 secrets/*
```

**Copy `secrets/data_encryption_key` somewhere safe outside the server** (password manager). Without it, two-factor authentication of every user stops working after a restore.

If you do not have a custom network yet: `docker network create proxynet`, and put your reverse proxy container on it (Network type: `proxynet`) with a **fixed IP** (e.g. `172.18.0.2`) — you need that IP in step 3.

## 2. The image

- **When a release is published:** use `ghcr.io/crimsonclyde/vergissmeinnicht:<version>` (e.g. `0.1.0-beta.1`). Pin an exact version rather than `latest`; releases are signed — see [Deployment → Published images](deployment.md#published-images).
- **Before the first release** (or to test your own build): build on your computer and copy it to Unraid:

  ```bash
  docker build --tag vergissmeinnicht:local .                  # in the repository
  docker save vergissmeinnicht:local | ssh root@tower docker load
  ```

  and use `vergissmeinnicht:local` as *Repository* in the template.

## 3. Add the container

1. Copy the template [`deploy/unraid/vergissmeinnicht.xml`](../deploy/unraid/vergissmeinnicht.xml) to `/boot/config/plugins/dockerMan/templates-user/my-VergissMeinNicht.xml` (flash drive, share `flash` → `config/plugins/dockerMan/templates-user/`).
2. **Docker → Add Container → Template:** *VergissMeinNicht*.
3. Fill in:
   - **Repository:** the image from step 2.
   - **Network type:** `proxynet`.
   - **Public address:** `https://vmn.example.org`
   - **Trusted proxy IP:** the fixed IP of your reverse proxy (e.g. `172.18.0.2`). Leave empty if you have none — it still works, but all users then share one rate-limit budget.
   - **SMTP host / port / security / user**, **Sender address**.
   - Keep *Backups every (hours)* = `24` and *Migrate on start* = `true`.
4. **Apply.** The log should end with `Server listening`. The container publishes no port; only the reverse proxy reaches it.

## 4. Reverse proxy

**Nginx Proxy Manager** → *Hosts → Proxy Hosts → Add*:

- Domain: `vmn.example.org`; Scheme `http`; Forward hostname `VergissMeinNicht` (the container name); port `3000`.
- *SSL*: request a Let's Encrypt certificate, **Force SSL**, **HTTP/2**, **HSTS**.
- *Advanced* (recommended): `access_log off;` — access logs would otherwise record Knot link tokens (`/knot/…`).
- Live updates (Server-Sent Events) work without extra settings: the app tells nginx not to buffer them.

**SWAG**: copy any `*.subdomain.conf.sample` to `vergissmeinnicht.subdomain.conf`, set `server_name vmn.*;`, `set $upstream_app VergissMeinNicht;`, `set $upstream_port 3000;`, `set $upstream_proto http;`, add `access_log off;`, restart SWAG.

## 5. First sign-in

Docker tab → *VergissMeinNicht* icon → **Console**:

```bash
vergissmeinnicht admin-bootstrap --email you@example.org
```

Open the printed link (valid once), choose your password — then continue with the [first steps in the README](../README.md#2-first-steps-in-the-app) and the [user guide](user-guide.md).

## Updating

Change the version in *Repository* (or load a new local build) and **Apply**. With *Migrate on start* the container backs up the database, applies pending updates, then starts. Before big upgrades you can also make a backup yourself from the console: `vergissmeinnicht backup`.

## Backups

- Automatic, verified backups land in `appdata/vergissmeinnicht/data/backups` (newest 14 kept). They contain everything sensitive — copy them **encrypted** to another machine.
- The *Appdata Backup* plugin can include the folder; it stops the container first, so the copy is consistent. Keep `secrets/data_encryption_key` **separately** from those copies.
- Restore: stop the container, then from the Unraid terminal:

  ```bash
  docker run --rm --user 99:100 -v /mnt/user/appdata/vergissmeinnicht/data:/data <image> restore /data/backups/<file>.sqlite
  ```

  The replaced database is kept next to it (`….before-restore-<time>`);
  then start the container again.

## Only inside your home network or Tailscale?

The app still needs HTTPS. Options: a reverse proxy with a certificate for an internal name (DNS challenge), or Tailscale (`tailscale serve` giving `https://<name>.<tailnet>.ts.net`). With Unraid's per-container Tailscale option, the container must be allowed to start as root with a writable file system — remove `--user 99:100 --read-only` from *Extra Parameters* in that case, set **Public address** to the `ts.net` address and **Trusted proxy IP** to `loopback`. This variant is not tested yet; the reverse-proxy route above is.

A private network never replaces the app's own sign-in; keep two-factor authentication on for admins.
