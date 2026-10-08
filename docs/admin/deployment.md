# Deployment

## Target

The supported V1 deployment is Docker Compose (`deploy/compose.yml`):

```text
Internet ──HTTPS──> Caddy (deploy/Caddyfile, automatic certificates, 172.31.250.2)
                         │  internal network 172.31.250.0/24
                         ▼
                   app container (Dockerfile): Fastify API + web app, user `node`, read-only root FS
                         │
                   volume `data` → /data: SQLite database, WAL files, media/ (instruction photos), documents/ (files of Documents),
                   backups/ (incl. backups/media/ and backups/documents/)
```

- One application container; no ports published except Caddy's 80/443.
- Secrets come from Docker secrets (`*_FILE`), never from the image or the Compose file.
- Only Caddy's fixed address may set the client address (`TRUSTED_PROXIES=172.31.250.2`).
- The app runs as non-root (`node`, uid 1000) with all capabilities dropped, `no-new-privileges`, a read-only root file system and `/tmp` as tmpfs; `/data` is `0700`, database and backups `0600`.

**Unraid:** see [Installing on Unraid](unraid.md) (template, Tailscale Serve or reverse proxy, `appdata`).

## Published images

Version tags (`v1.2.3`) publish a multi-architecture image (`linux/amd64`, `linux/arm64`) to GitHub Container Registry: `ghcr.io/crimsonclyde/vergissmeinnicht:1.2.3` (also `:1.2` and `:latest`). Each architecture is built natively, smoke-tested (migrate, CLI, backup, server ready, scheduled backup, image processing) and scanned (Trivy, no fixable HIGH/CRITICAL findings) before it is pushed. The image is signed keyless with Sigstore and carries a CycloneDX SBOM attestation. Verify before use and pin the digest:

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

The Node base is pinned by digest. The runtime layer upgrades PCRE2 from Debian’s signed repositories and refuses a package older than `10.42-1+deb12u2` (CVE-2026-103111); the final image is still scanned on both architectures before publication.

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
| `DATA_ENCRYPTION_KEY` | **required** | ≥32 characters, different from `AUTH_SECRET`. Encrypts TOTP secrets and the Telegram bot token at rest. **Back it up separately from the database and never change it** (see below). |
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
| `PUID`, `PGID` | optional | Only when the container is **started as root** (e.g. Unraid's Tailscale): the entrypoint runs everything as this user/group with no capabilities (default `1000`/`1000`; `0` is refused). Ignored when the container already runs as a non-root user. |
| `VMN_MIGRATE_ON_START` | optional | `true`: the `serve` command first runs `migrate` (backup first if anything is pending). For platforms where a separate migrate run is impractical (Unraid). Default off. |
| `BACKUP_KEEP` | optional | Number of automatic backups kept (default 14); manual and pre-migration backups are never deleted. |
| `API_RATE_LIMIT_PER_MINUTE` | optional | Global limit of `/api` requests per minute and client (default `300`, range 60–10000). Raise it only if many people share one address and `TRUSTED_PROXIES` cannot be used; the limits of sign-in, second factor, recovery and other sensitive routes are separate and unaffected. |
| `AUTH_SECRET_FILE`, `DATA_ENCRYPTION_KEY_FILE`, `SMTP_PASSWORD_FILE` | recommended | Absolute path of a file holding the secret (Docker secrets: `/run/secrets/…`); a trailing line break is ignored. Set either the variable or its `_FILE`, not both. |
| `SOURCE_CODE_URL` | optional | `https` link to the source of the running version, shown in every page footer (AGPL-3.0 §13). Default: the upstream repository. **Set it to your own repository if you run a modified version.** |

`PUBLIC_ORIGIN` must be exactly the origin users type in the browser: every state-changing request whose `Origin` header differs is rejected (CSRF protection). In production the session cookie is `__Secure-vmn.session_token` (`Secure`, `HttpOnly`, `SameSite=Strict`), so the site must be served over HTTPS (loopback excepted).

### Rotating `AUTH_SECRET`

`AUTH_SECRET` signs session cookies. To rotate it (routinely or after a suspected leak of the secret or of the database): stop the server, replace the secret, start the server. All existing sessions become invalid and every user has to sign in again; no data is lost. Invitation links and TOTP enrollments are unaffected (they are not derived from the secret).

### `DATA_ENCRYPTION_KEY`

TOTP authenticator secrets, the Telegram bot token (13.7) and weather provider credentials (19.4b) are encrypted with this key. If it is lost or changed, every enrolled authenticator stops working: users can still sign in with a recovery code and re-enroll, otherwise an admin or operator TOTP reset is needed (see Account recovery); the Telegram bot token must then be entered again under *Server admin → Notification providers*, and weather credentials (server-wide and everyone's own) show *needs to be entered again*. A re-encryption tool for planned key rotation does not exist yet — do not rotate it. Keep a copy of the key outside the server (e.g. in the operator's password manager) and store it separately from database backups: the encryption protects stolen database files only as long as the key is not stored alongside them.

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
- **Uploads of documents** (16.1) are single requests of up to 50 MB by default (the limit a server admin sets, at most 100 MB) that may take minutes on a phone connection. Caddy forwards them as they are (no body limit, no buffering). With your own proxy: allow request bodies of at least that size (nginx: `client_max_body_size 100m;`), do not buffer request bodies to disk or memory (nginx: `proxy_request_buffering off;`), and allow the request to take up to 15 minutes (nginx: `proxy_read_timeout`/`client_body_timeout`; Cloudflare's free plan stops at 100 MB per request). The app itself gives an upload 15 minutes, closes a connection that is silent for one minute, and keeps the 30-second limit for every other request.
- **Memory.** The `app` container has a memory limit of **4 GiB** (`mem_limit` / `memswap_limit` in `compose.yml`; no swap on top). The reason: reading a PDF for its previews can take up to about 2.4 GB for a few seconds in the worst case (one file at a time; a hostile file is stopped after 30 seconds, and a watchdog usually stops it far earlier, but that is not guaranteed) — the limit makes the worst case end at the container instead of the host. Measured with `deploy/memory-check.sh` (large and deliberately hostile PDFs and 48-megapixel photos uploaded together while ordinary requests kept coming): the container peaked at 2.9 GB, 68 % of the limit, with nothing killed and no request failing — and, since text recognition (0.5.0-beta.6) runs OCR alongside, at **3.5 GB, 82 %**, still with nothing killed and no request failing; idle it uses about 0.3 GB. The limit is a ceiling, not a reservation — the host needs that much free memory only while such files are processed. If the limit is ever reached, the kernel ends the server process and Docker starts the container again (`restart: unless-stopped`); nothing stored is lost, and an upload in progress has to be repeated. On a host with less than about 6 GB of memory, lower the limit rather than removing it (3 GiB is the least that leaves room for the worst case) and expect very large or hostile PDFs to restart the app. Run `deploy/memory-check.sh <image>` on your own hardware before relying on it. `deploy/restart-check.sh <image>` checks the restart behaviour with the Unraid template's parameters (which now include `--restart=unless-stopped`, as the Compose file always had): a killed server process and a real out-of-memory kill — provoked at a limit lowered to 1 GiB — each bring the container back with its data, and a container stopped on purpose stays stopped.
- **Documents are not scanned for malware.** The app accepts only PDF, JPEG, PNG and HEIC files, checks that a file really is one of them, never executes or renders an uploaded file, and hands originals out only as downloads. A file can still be harmful to the program that opens it after downloading (for example a PDF reader); keep the devices that open downloads up to date. A scanner is not part of the deployment.
- Access logs: the app redacts `/knot/{token}` and link tokens from its own request logs. Proxy access logs would contain them — keep them off (the Caddyfile has none) or filter the URI.
- The app sends HSTS (one year) for https origins, CSP without inline styles/scripts, `Referrer-Policy: no-referrer`, `Permissions-Policy`, `X-Content-Type-Options`, `Cache-Control: no-store` on the API.
- Limits of security-sensitive routes (sign-in per client and per account, second factor, recovery and invitation links, password/TOTP changes, admin recovery/invitations/account status, Knot resolution) are kept in the database (`rate_limits`, key hashes only), so a restart does not reset them. The global per-client limit and other route limits are in memory. All of it is per server process/database: multi-node deployments need a reviewed shared store.
- Private networks (VPN, Tailscale) do not replace the application's authentication; keep HTTPS and the normal configuration there too.

## Footer

Every page shows "VergissMeinNicht (VMN) with 🖤 by CrimsonClyde - Licence: AGPL-3.0", the name linking to the source code (`SOURCE_CODE_URL`). A server admin can hide it for everyone under *Server admin → This server*; it then stays in the page source with the `hidden` attribute. If you run a **modified** version for others, the AGPL still requires you to offer its source in a visible way.

## Offline use

The web app installs a service worker (production builds) that keeps the app shell, so Runs opened on a device can be executed and Grocery Lists used without a connection (steps.md 8.5, 17.5). List data and unsent changes live in the browser's IndexedDB per account, never in the service worker cache, and are removed on sign-out. Upgrading the server needs migration 0040 for offline Lists; changes waiting on devices are kept across the upgrade and sent afterwards. Open tabs learn about a new version by loading the app page (`/?vmn-version-check=1`) now and then and show a reload note; a reverse proxy must not cache `/` for long (the server sends it with `max-age=0`). Service workers require HTTPS (or `localhost`); nothing needs to be configured. Reverse proxies must not cache `/api/*` (the app sends `Cache-Control: no-store`) and should pass `/sw.js` through unchanged. After an upgrade, browsers pick up the new app shell on their next online page load.

## Reminders and notification providers

Schedules (steps.md 14.1 — standalone Reminders and scheduled Procedures, once or repeating) send reminders to the responsible person, otherwise to whoever created the schedule. Everything runs inside the server process — no queue, worker or extra container:

- Every minute the server first creates the next dates of repeating schedules (idempotent), then sends due reminders (at most 50 per minute) through the channels each person enabled. Each reminder is recorded and claimed in the database before it is sent, so it goes out at most once per channel in normal operation — also across restarts and with two server processes on the same database; temporary failures are retried after 1 minute, 10 minutes and 1 hour, then given up. **Limit:** if the process dies after the mail server or Telegram accepted a message but before VMN recorded it, that one message can arrive twice (emails carry the same `Message-ID`). Only counts are logged.
- **Downtime:** reminders up to a day late are sent normally after a restart. Older missed reminders are not sent one by one: each person gets one short catch-up summary per channel describing the current status of what was missed (earlier offsets of the same date are skipped, and nothing is sent for dates already done, skipped or paused). The Home page stays the reliable overview.
- **Upgrade to 0.3.0-beta.1 (migration 0024):** turns every scheduled Procedure into a one-time Schedule with one date, keeps ids, reminders and delivery records, and sends nothing again that was already sent. `migrate` backs up first (or `VMN_MIGRATE_ON_START=true` on Unraid).
- **Email** uses the SMTP settings above (the same as invitations). It is on by default; a server admin can switch email reminders off, and everyone can switch them off for themselves.
- **Telegram** is optional and set up in **two stages**: the server admin sets up one bot for the whole instance, then **every person connects their own Telegram chat**. Saving the bot token alone sends nothing to anyone.

  **Server administrator (once per instance):**
  1. Create a bot with [@BotFather](https://t.me/BotFather) (`/newbot`) and copy its token.
  2. *Server admin → Notification providers → Telegram*: paste it into **Bot token**, tick *Enable Telegram on this server*, save. The server checks the token with Telegram (`getMe`), stores it encrypted with `DATA_ENCRYPTION_KEY` and never shows it again; the page then says "Bot connected: @YourBot".
  3. The page now shows **Next step** — connect your own account like everyone else (*Go to my notification settings*). **Send test message to my Telegram** stays disabled until your own account is connected, because it goes to *your personal chat*, not to a server-wide chat.

  **Each user (including the admin):**
  1. Open *Profile & settings → Notifications*.
  2. Select **Connect Telegram**.
  3. Open the generated Telegram link and press **Start** (Telegram answers "Almost done: go back to VergissMeinNicht and confirm this chat …").
  4. Return to VergissMeinNicht — the page notices the chat by itself.
  5. **Confirm** the pending Telegram connection (only if the named chat is yours; otherwise *Not me*). Telegram answers "Connected to VergissMeinNicht …".
  6. Keep *Procedure reminders* under Telegram switched on.

  - The bot token is **global** for the VMN instance; each user has **their own** Telegram destination.
  - Nobody enters a Telegram **chat ID**: VMN learns the chat during pairing from the one-time `/start` link and links it only after the signed-in person confirms it.
  - The server needs **outgoing HTTPS to `api.telegram.org`**; no inbound connection is needed. It asks Telegram for messages (polling every 3 seconds) only while someone is connecting a chat — so it works behind a VPN/Tailscale.
  - Do not set a webhook for the bot elsewhere (polling does not work while a webhook is set), and use the bot for VMN only.
  - Telegram (and mail servers) see the reminder text: the Procedure title, date and Workspace name.

## Weather (19.4)

Weather is personal: each person chooses a place, a provider and (for Open-Meteo) a model under **Profile & settings → Weather** and shows the card on their own Today. As server admin you decide under **Server admin → Weather** whether this server fetches weather at all (**on** by default) and from which providers.

- **Outbound connections.** Only the server talks to providers — browsers and phones never do — and only to hosts fixed in the code: `api.open-meteo.com` and `geocoding-api.open-meteo.com` (Open-Meteo), `api.met.no` (MET Norway). HTTPS only, no redirects followed, 8 s timeout, at most 512 KiB per answer. Requests happen only when someone looks at Today or the Weather page (no background polling); forecasts are cached in the server process (Open-Meteo 30 minutes, MET Norway as long as its `Expires` header says) and one request serves everyone asking for the same place. If your firewall restricts outbound traffic, allow those hosts on port 443 — or switch Weather off.
- **What providers learn:** this server's IP address and the places people chose, rounded to about 1 km (and typed place names when someone searches). Not who is looking.
- **Terms.** Open-Meteo's free API is for **non-commercial** use only (a household or private installation is fine; running VMN commercially needs an Open-Meteo plan). MET Norway requires every application to identify itself: VMN sends `VergissMeinNicht (+https://github.com/crimsonclyde/vergissmeinnicht)` and, if you enter one, your contact address. Both data sets are CC BY 4.0; VMN shows the attribution with every forecast.
- **Switched off**, no weather request of any kind is made and nobody sees weather settings or the card; people's saved settings are kept for when you switch it on again.
- **Optional commercial providers** — OpenWeather and Meteomatics — work only with credentials and are never needed. People can store their own (Profile → Weather → *Optional providers*), and you can store server-wide ones under **Server admin → Weather** and tick *People without their own credentials may use these*; a person's own always come first. Credentials are tested with one request before they are saved, stored encrypted with `DATA_ENCRYPTION_KEY`, and never shown again — not even to server admins (personal ones are invisible to you altogether). Outbound hosts, when used: `api.openweathermap.org`, `api.meteomatics.com`.
- **Costs and terms of the commercial providers.** OpenWeather's One Call 3.0 needs a "One Call by Call" subscription with a payment card: 1 000 calls a day are free, calls above are **charged automatically** at month end (OpenWeather's default cap is 2 000 a day — lower it to 1 000 in your OpenWeather account). Meteomatics' free *Basic* account is non-commercial only, 500 queries a day, 10 days ahead. VMN keeps a **daily call budget per credential** (default 500 for OpenWeather, 250 for Meteomatics; at most the free allowance, 1 000 / 500) and stops *before* calling when it is used up; a Meteomatics refresh uses 2 queries. Forecasts are cached for 30 minutes, and Today and the detailed forecast share one cached answer.
- **Comparing forecasts** (Profile → Weather) uses the same caches and budgets: paid providers are fetched only when the person explicitly asks (the button says how many paid requests it uses), never by opening the view.
- **Forecast length** follows the provider and model: Open-Meteo up to 16 days (regional models fewer, e.g. ItaliaMeteo ARPAE ICON-2I 3), MET Norway about 10, OpenWeather 8, Meteomatics up to 10. Nothing is invented beyond what a provider offers.

## Text recognition (16.9)

The server reads the text of uploaded Document files so they can be found by words printed on them: the text a PDF page contains (MuPDF), and **OCR** for scans and photos (Tesseract 5 compiled to WebAssembly, English + German + Italian + French). **Everything runs inside the app container; no file, page or text leaves the server, and recognition opens no network connection** — the language data ships in the image (`/app/packages/media/tessdata`, from `tesseract-ocr/tessdata_best`, pinned and checked by SHA-256 when the image is built; licence in `third-party-notices-server.txt`). There is no setting to use an outside service.

- **On by default** in every Workspace with Documents (owner's decision P5); a Workspace admin switches it off for that Workspace under *Workspace settings → General*. There is no server-wide switch yet.
- **After upgrading to the release with migration 0038, existing files are read too** — behind new uploads, one file at a time. A Workspace with thousands of scanned pages keeps one CPU core busy for hours after the upgrade (about 2 s per scanned page on a fast desktop CPU; expect 2–4× that on a NAS). Embedded PDF text costs almost nothing.
- **Resources:** one file at a time; OCR takes about **255 MB** of memory while it runs (its worker thread stops when idle and returns the memory), at most 120 s per page, at most 50 scanned pages and 500 pages per file, 200 000 characters stored per file. Recognised text counts towards the Workspace's storage. `deploy/memory-check.sh` now waits for the text of everything it uploaded, so its result covers previews and OCR together — run it on your own hardware.
- **Image size:** about 40 MB more (the OCR engine and the four languages).
- **Failures** are shown on the file with *Retry*; the Document stays fully usable. If the language data were missing (a broken image), files wait without using up their attempts and the log says `text recognition failed` with the code `unavailable`.
- Recognised text is in the database and therefore in every backup. Building from source outside Docker: run `pnpm ocr:data` once (downloads and verifies the language data into `packages/media/tessdata`).

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

1. The database with its instruction photos and document files, via the backup command (never by copying the live file: a copy taken while the server writes can be inconsistent, and the WAL file holds recent changes). The command also puts every photo the backup uses into `/data/backups/media/` and every document file into `/data/backups/documents/` (next to the backup files, shared between backups): **a backup is the `.sqlite` file together with the `media/` and `documents/` directories next to it** — always copy all three. The simplest rule: copy the whole `/data/backups` directory; it is complete by itself, and `/data/media` and `/data/documents` need no separate copy.
2. `DATA_ENCRYPTION_KEY` — separately (password manager). Without it, restored TOTP enrollments do not work (users fall back to recovery codes/admin reset); stored together with the database it would defeat the encryption.
3. Your configuration (`vergissmeinnicht.env`, Caddyfile). `AUTH_SECRET` does not need a backup: a new one only signs everyone out.

**Create a backup** (the server keeps running):

```bash
docker compose exec app vergissmeinnicht backup                        # → /data/backups/vergissmeinnicht-<UTC time>.sqlite
docker compose cp app:/data/backups/<file> ./                          # copy it off the server, then encrypt it
docker compose cp app:/data/backups/media ./                           # … together with the photos it uses
docker compose cp app:/data/backups/documents ./                       # … and the document files (may be gigabytes)
```

The backup uses SQLite's online backup API (consistent, includes the WAL), is written with mode `0600`, converted to a single database file and verified (integrity check, foreign keys, expected tables, and every instruction photo present in `backups/media` with the right SHA-256) before the command reports success. Photos are immutable and named by their hash, so consecutive backups share them instead of copying them again; the scheduled backup removes a photo from `backups/media` once no backup file in `/data/backups` uses it any more.

**Document files** (originals of up to 50 MB each, previews; up to the storage limit of each Workspace, 5 GB by default) are handled the same way in `backups/documents`, with two differences that keep backups fast and small:

- A file enters `backups/documents` as a **hard link** to the file in `/data/documents` — the same data on disk under a second name, so a backup needs **no additional space and no copying** for documents (measured on a development machine: 1 GB of 50 MB files linked in under a millisecond; reading and hashing the same gigabyte once took 0.6 s on an SSD — expect roughly ten seconds per gigabyte on a single hard disk). Where the backups are on another file system than the data, the files are copied instead and then take their size again. Each file is read and hashed **once**, when it first enters the backup store; later backups only check that it is still there with the right size.
- `verify` and `restore` read and hash **every** file, so they take time in proportion to the data (the server is not blocked by `verify`; `restore` runs while it is stopped).

What this means: a file that is deleted permanently in the app (or lost through a mistake) stays in `backups/documents` until the last backup that contains it has rotated out — `BACKUP_KEEP` backups later for scheduled backups, never for manual and pre-migration backups, which the app does not delete. **Deleting something in the app therefore does not remove it from existing backups or from copies you made of them.** A hard link does not protect against a failing disk: both names point to the same data. That protection is the off-host copy, as for the database. Copy tools that do not know hard links (`docker compose cp`, `cp`, `scp`) write ordinary files, which is fine; `rsync -H` and `tar` keep the links. Copy `/data/backups` only — copying `/data/documents` as well would store every document twice.

**Disk space is yours to provide.** A Workspace has **one storage limit for everything it stores** — instruction photos, documents with their previews, and what is in Trash (5 GB by default; a server admin sets it per Workspace under *Server admin → Server & storage*, between 100 MB and 1000 GB, and a Workspace admin may set a lower one). It is a usage limit, not reserved space: nothing is set aside, and the limits of several Workspaces can add up to more than the volume holds. Lowering a limit deletes nothing; it only refuses new files. Watch the free space of the data volume (documents, previews, the database and its backups, and — if backups are on another file system — a second copy of every document).

**Permanent deletion and backups are separate things.** When a Workspace admin deletes documents from Trash for good, VMN removes the records at once and the files from `/data/documents` at the next hourly housekeeping (a file uploaded less than a day ago is kept until it is a day old — the same grace period that keeps a running backup consistent). **Existing backups are not changed:** the files stay in `backups/documents` until the backups that contain them rotate out (`BACKUP_KEEP`; manual and pre-migration backups are never removed by the app), and in every copy you made elsewhere. If something has to be erased everywhere, the backups that hold it must be deleted as well — VMN tells people this in the confirmation, and cannot do it for them.

**Contacts deleted for good** (Workspace admins, from Trash) are gone from the application at once — including from its history, which never holds a contact’s name; existing backups keep them until they rotate.

**Removing a document from a finished execution** (Workspace admins) behaves the same way towards backups: the application forgets the kept version at once, existing backups keep it until they rotate.

**Exports** (the ZIP download under Documents) are made on request and streamed to the browser; they are never stored on the server and are no substitute for a backup: they hold the documents a person may see, not the database.

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
docker compose cp ./media app:/data/backups/                            # … and the photos next to it
docker compose cp ./documents app:/data/backups/                        # … and the document files
docker compose run --rm app verify /data/backups/vergissmeinnicht-<time>.sqlite
docker compose stop app
docker compose run --rm app restore /data/backups/vergissmeinnicht-<time>.sqlite
docker compose run --rm app migrate                                     # if the backup is from an older version
docker compose up -d
```

`restore` refuses to run while any process has the database open (it needs an exclusive SQLite lock), verifies the backup first (a missing or altered photo or document file refuses the restore), puts the backup's photos into `/data/media` and its document files into `/data/documents`, and keeps the replaced database as `vergissmeinnicht.sqlite.before-restore-<time>` (plus its WAL/SHM files) — delete that manually once the restore is confirmed. Sessions in the backup are valid again after a restore; rotate `AUTH_SECRET` if you restore after a suspected compromise.

**Tested procedure** (2026-09-27, `docs/development/steps.md` 10.2): automated tests back up a database with uncheckpointed WAL changes, restore it, and check contents, file modes, refusal while the database is open (also idle with an empty WAL) and rejection of damaged or foreign files. The full container drill — migrate, start behind Caddy, create data, `backup` while running, change data, restore refused while running, stop, restore, start, data back to the backup state, healthy — was run against the image. Repeat a restore drill on a spare machine regularly: a backup that was never restored is not verified.
