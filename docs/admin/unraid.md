# Installing on Unraid

VergissMeinNicht runs on Unraid as one ordinary container. HTTPS is required (sign-in cookies are `Secure`, and the app refuses a plain-HTTP address), and on Unraid the simplest way to get it is **Unraid's built-in Tailscale for containers with Tailscale Serve**: the app gets its own name in your tailnet, e.g. `https://vergissmeinnicht.your-tailnet.ts.net`, with a valid certificate — no reverse proxy, no open ports on your LAN. A variant with a reverse proxy is at the end.

## What you need

- Unraid 7 (Tailscale integration for containers) and a Tailscale account; in the Tailscale admin console **MagicDNS** and **HTTPS certificates** enabled (*DNS* page).
- The devices that should use VMN in your tailnet (phones: the Tailscale app).
- An email account the server can send from (SMTP) — for invitations and account recovery. Without it the first admin still works, but you cannot invite anyone.

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
ls -ln secrets    # must show 99 100 and -r-------- for every file
```

**Copy `secrets/data_encryption_key` somewhere safe outside the server** (password manager). Without it, two-factor authentication of every user stops working after a restore.

## 2. Add the container

1. **Put the template where Unraid looks for it.** Unraid keeps its settings on the USB flash drive it boots from, mounted as `/boot`; user templates live in `/boot/config/plugins/dockerMan/templates-user/`. In the Unraid **Terminal** (top right, `>_`):

   ```bash
   wget -O /boot/config/plugins/dockerMan/templates-user/my-VergissMeinNicht.xml \
     https://raw.githubusercontent.com/crimsonclyde/vergissmeinnicht/main/deploy/unraid/vergissmeinnicht.xml
   ```

   (Without the terminal: the flash drive is also the network share `flash` — copy [`deploy/unraid/vergissmeinnicht.xml`](../../deploy/unraid/vergissmeinnicht.xml) into `config/plugins/dockerMan/templates-user/` there and rename it to `my-VergissMeinNicht.xml`.)
2. **Docker** tab → **Add Container** (button at the bottom) → **Template** drop-down → under *User templates* choose **VergissMeinNicht**. The form fills itself from the template.
3. Fill in:
   - **Repository:** `ghcr.io/crimsonclyde/vergissmeinnicht:0.6.0-beta.2` (or a newer release — pin an exact version, not `latest`).
   - **Use Tailscale:** *Yes*. **Tailscale Hostname:** `vergissmeinnicht`. **Tailscale Serve:** *Serve* (port `3000`, taken from the WebUI field). Leave *Funnel* off — that would publish the app on the internet.
   - **Tailscale State Directory** (Tailscale settings, if shown): `/data/.tailscale_state` — keeps the container's Tailscale identity across updates.
   - **Public address:** `https://vergissmeinnicht.<your-tailnet>.ts.net` — exactly the name Tailscale shows for the container.
   - **Trusted proxy:** `loopback` (Tailscale Serve forwards from inside the container).
   - **SMTP host / port / security**, **Sender address**.
   - **SMTP user** only if your mail server needs a login. Then *both*: put the password into `secrets/smtp_password` (step 1) **and** set **SMTP password file** to `/run/secrets/smtp_password`. Otherwise leave both empty — one without the other stops the start with `SMTP_USER and SMTP_PASSWORD … must be set together`.
   - Keep **Extra Parameters** as in the template (`--init --user 0:0 --security-opt no-new-privileges:true --memory=4g --memory-swap=4g --restart=unless-stopped`: a 4 GiB memory limit without extra swap, and an automatic restart if the server ends unexpectedly — see *Memory limit and automatic restart* below), *Backups every (hours)* = `24`, *Migrate on start* = `true`, *Run as user/group id* = `99`/`100`.
   - Leave **Privileged** *off*.
4. **Apply.** On the first start Unraid sets up Tailscale inside the container (you may have to approve the new machine in the Tailscale admin console). The log shows `Executing Unraid Docker Hook for Tailscale` without errors and ends with `Server listening`.

**Why `--user 0:0`, and why not "Privileged":** Unraid's Tailscale hook installs Tailscale into the container every time it starts, and it refuses with `ERROR: No root privileges!` unless the container starts as root. The image itself starts as an unprivileged user by default, so the template asks for root with `--user 0:0` — only for that setup step. Before VergissMeinNicht runs, the image's entrypoint switches to `99:100` (*Run as user/group id*) and drops every capability; the application never runs as root, and `0` is refused. *Privileged* mode is something else — it would hand the container nearly full control of the host — and is not needed.

## 3. First sign-in

Docker tab → *VergissMeinNicht* icon → **Console**:

```bash
vergissmeinnicht admin-bootstrap --email you@example.org
```

Open the printed link (valid once, on a device in your tailnet), choose your password, then continue with the [first Workspace setup](README.md#first-workspace-setup) and the [user guide](../user/user-guide.md). On phones: open the address in the browser and *Add to Home Screen* — Runs you opened keep working offline.

## Updating

Change the version in *Repository* and **Apply**. With *Migrate on start* the container backs up the database, applies pending updates, then starts. Releases are signed — see [Deployment → Published images](deployment.md#published-images) to verify one first.

## Backups

- Automatic, verified backups land in `appdata/vergissmeinnicht/data/backups` (newest 14 kept); the instruction photos they use are in `data/backups/media` and the files of Documents in `data/backups/documents` (both shared between backups). The live files are in `data/media` and `data/documents`. Backups contain everything sensitive — copy the whole `backups` folder (with `media` and `documents`) **encrypted** to another machine; it is complete by itself.
- **Memory limit and automatic restart:** the template's *Extra Parameters* contain `--memory=4g --memory-swap=4g --restart=unless-stopped`.
  - *Memory:* the container may use at most 4 GiB, with no swap on top, so that one very large or damaged PDF cannot take the server's memory. Normally the app uses about 0.3 GB.
  - *Restart:* if the server ends unexpectedly — a crash, or the kernel ending it because the memory limit was reached — Docker starts the container again by itself, usually within a few seconds. Nothing stored is lost; an upload that was running has to be repeated. **A container you stop yourself stays stopped** (Docker tab → Stop), also after the Docker service or the server restarts; Unraid's *Autostart* switch still decides whether it starts with the array.
  - **Installed before this version? Add them yourself** — an existing container keeps its old settings, and updating the image does not change them: Docker tab → click the VergissMeinNicht icon → **Edit** → switch **Basic View** to **Advanced View** (top right) → in **Extra Parameters** append ` --memory=4g --memory-swap=4g --restart=unless-stopped` to what is there (keep `--init --user 0:0 --security-opt no-new-privileges:true`) → **Apply**. Unraid recreates the container with the same data. Check with `docker inspect -f '{{.HostConfig.RestartPolicy.Name}} {{.HostConfig.Memory}}' VergissMeinNicht` in the Unraid terminal: it should print `unless-stopped 4294967296`.
  - If the container keeps restarting (the Docker tab shows it starting again and again — for example after a failed update), stop it there and read its log (*Logs*); a stopped container is not restarted.
- **Documents and disk space:** document files can add up to gigabytes (5 GB per Workspace by default, for documents and instruction photos together — a usage limit, nothing is reserved; change it per Workspace under *Server admin → Server & storage*). Deleting documents for good in the app frees the space in `data/documents` within about an hour (a day after the upload for files added today), but **not** in existing backups: those keep the files until the backups are replaced. In `data/backups/documents` they are hard links to the files in `data/documents`, so backups need no extra space for them — as long as `appdata/vergissmeinnicht` stays on one disk or pool (the usual case for appdata on the cache pool) and hard links are enabled (*Settings → Global Share Settings → Tunable (support Hard Links)*: Yes, the default). Otherwise they are copied and take their size a second time. A file deleted in the app stays in the backups until the backups that contain it have rotated out. Keep an eye on the free space of the pool.
- The *Appdata Backup* plugin can include the folder (with `data/media`); it stops the container first, so the copy is consistent. Keep `secrets/data_encryption_key` **separately** from those copies.
- A backup on demand: Console → `vergissmeinnicht backup`.
- Restore: stop the container, then in the Unraid terminal

  ```bash
  docker run --rm --user 99:100 -v /mnt/user/appdata/vergissmeinnicht/data:/data \
    ghcr.io/crimsonclyde/vergissmeinnicht:<version> restore /data/backups/<file>.sqlite
  ```

  (the replaced database is kept next to it as `….before-restore-<time>`), then start the container again.

## Troubleshooting

- **"Email or password is not correct" for the first admin, although the password is right:** look at the line `Server-admin invitation created for …` — an address with an odd character (e.g. `�` from a paste) is a different address. Since 0.1.0-beta.4 such addresses are refused. On a fresh install without other data: stop the container, delete only `data/vergissmeinnicht.sqlite*` (keep `.tailscale_state` and `backups`), start it and run `admin-bootstrap` again with the address typed by hand.
- **`SqliteError: unable to open database file` (`SQLITE_CANTOPEN`):** the data folder or database belongs to another user (e.g. created before `--user 0:0` was set). Since 0.1.0-beta.4 the container fixes the ownership of the data folder itself when it starts as root; with older versions stop the container and run `chown -R 99:100 /mnt/user/appdata/vergissmeinnicht/data`.
- **`AUTH_SECRET_FILE: file cannot be read`:** the secrets must be readable by 99:100 — `chown -R 99:100 /mnt/user/appdata/vergissmeinnicht/secrets && chmod 0700 /mnt/user/appdata/vergissmeinnicht/secrets && chmod 0400 /mnt/user/appdata/vergissmeinnicht/secrets/*` (not `rw-rw-rw-`: nobody else should read them).
- **`ERROR: Can't generate certificates!` from the Tailscale hook:** in the Tailscale admin console, *DNS* page, enable **HTTPS Certificates**. Fetching the first certificate can take a minute or two — the hook stops waiting, but Tailscale keeps trying; open the `https://…ts.net` address to check.
- **The Tailscale name differs from the template** (e.g. `vmn` instead of `vergissmeinnicht`): the *Public address* must use the name the log prints under `Available within your tailnet:`.
- **`ERROR: No root privileges!` / "Starting container without Tailscale":** *Extra Parameters* must contain `--user 0:0` (see step 2) — not *Privileged*.
- **`SMTP_USER and SMTP_PASSWORD … must be set together`:** either fill in *SMTP user* and *SMTP password file* (`/run/secrets/smtp_password`, with the password in `secrets/smtp_password`), or leave both empty.
- **"Sign in" does nothing / is refused:** the address in the browser must be exactly the *Public address* (same host name, `https`).
- **Page not reachable:** is the device in your tailnet, and does the Tailscale admin console list the `vergissmeinnicht` machine? Are HTTPS certificates enabled?
- **"Send test message to my Telegram" is disabled / "your account is not connected to Telegram yet":** the bot token only sets up the bot for the server. Connect your own chat under *Profile & settings → Notifications → Connect Telegram* (press *Start* in Telegram, then confirm in VMN); the test goes to that chat.
- **Telegram test fails / "could not be reached":** the container needs outgoing HTTPS to `api.telegram.org` (check firewall/VPN exit rules); remove a webhook set for the bot elsewhere.
- **The Docker tab shows the generic Docker icon:** Unraid only displays the icon if it can load it as a PNG. The template uses `assets/brand/vergissmeinnicht-icon.png` (earlier templates pointed to an SVG). For an existing container: *Edit* → switch to *Advanced View* → set **Icon URL** to `https://raw.githubusercontent.com/crimsonclyde/vergissmeinnicht/main/assets/brand/vergissmeinnicht-icon.png` → *Apply*. If the old icon (or no icon at all) still shows, Unraid is showing a broken cached copy of an earlier download: delete both copies in the Unraid terminal — `rm -f /var/lib/docker/unraid/images/VergissMeinNicht-icon.png /var/local/emhttp/plugins/dynamix.docker.manager/images/VergissMeinNicht-icon.png` — and reload the Docker tab (Ctrl+Shift+R).
- **Invitation emails do not arrive:** check the SMTP settings and the container log; the admin page says "the email could not be sent" and offers *Send again*.

## Alternative: reverse proxy instead of Tailscale

With Nginx Proxy Manager or SWAG on a custom Docker network (e.g. `proxynet`): set *Use Tailscale* to *No*, *Network type* `proxynet`, *Public address* to your domain, *Trusted proxy* to the proxy's fixed IP, and harden the container further with *Extra Parameters*
`--init --user 99:100 --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges:true`. In the proxy, forward your domain to `VergissMeinNicht:3000` with a Let's Encrypt certificate and add `access_log off;` (access logs would record Knot link tokens).

## Tested

The image was run as the template does it: started as root with `PUID=99`/`PGID=100` (application process as 99:100, no effective or bounding capabilities), `TRUSTED_PROXIES=loopback`, secrets from files, migration on start, scheduled backup, `admin-bootstrap` from the console, restore; and in the hardened reverse-proxy variant (`--user 99:100 --read-only --cap-drop ALL`). Unraid's Tailscale setup itself runs only on Unraid and was not part of these tests — please report anything that differs.

A private network never replaces the app's own sign-in; keep two-factor authentication on for admins.
