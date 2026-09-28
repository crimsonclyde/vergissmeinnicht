<p align="center">
  <img src="assets/brand/vergissmeinnicht-hero.svg" alt="Forget-me-not flowers with sky-blue petals; the green stem is tied into a knot" width="640">
</p>

<h1 align="center">VergissMeinNicht</h1>

<p align="center">
  <strong>Never skip the step that matters.</strong><br>
  Shared checklists for the routines you repeat — with a history you can trust.
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-blue"></a>
  <a href="https://github.com/crimsonclyde/vergissmeinnicht/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/crimsonclyde/vergissmeinnicht/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="Self-hosted" src="https://img.shields.io/badge/self--hosted-Docker%20Compose-2496ED">
  <img alt="Security first" src="https://img.shields.io/badge/security-first-critical">
</p>

---

Was the stove really off? Did anyone lock the back door? Which step of the deployment did we skip last time — and why?

**VergissMeinNicht** (short **VMN**) turns the routines you repeat into checklists that a whole household or team can work through together, step by step, on a phone or a desktop. Every tick is recorded: **what** was done, **who** did it, **when**, and — if something was skipped — **why**. Later, anyone can look back at a run and know exactly what happened.

It is built to be calm and obvious to use (ADHD-friendly by design), self-hosted, open source, and secure from the ground up.

## ✨ What it does

- **Procedures, not to-do lists.** Write a routine once — with sections, steps, optional and critical steps — and run it again and again.
- **Runs you can trust.** Starting a run takes a snapshot. Editing or deleting the procedure later never rewrites history.
- **Four honest states.** Every step is *Pending*, *Done*, *Skipped* or *Not applicable* — skipped is not the same as "didn't apply", and a reason can be required.
- **Critical steps need intent.** Press and hold (or tap, then confirm) so nothing important gets ticked by accident.
- **Together, live.** Several people work on the same run; changes appear instantly with who and when.
- **Works when the Wi-Fi doesn't.** Turned off the router as step 5? Keep going. Changes are saved on the device and sent when you are back online — nothing is overwritten silently.
- **The next step is always obvious.** Big touch targets, a sticky progress bar, "next step" markers, and a full undo.
- **Share with a Knot.** A Knot link opens a procedure or run directly — it still requires signing in, so a leaked link reveals nothing.
- **Your look.** System, Light, Dark, and the pitch-black **Memento Mori** theme — all checked for WCAG AA contrast.

Typical uses: leaving the house, closing a shop or office, maintenance and inspections, onboarding and offboarding, deployments, packing lists, opening and closing routines.

## 🔐 Security is the foundation, not a feature

- Invite-only accounts, Argon2id passwords, optional **TOTP two-factor** with single-use recovery codes.
- Workspaces with **Guest / User / Editor / Admin** roles — every request is authorized on the server.
- An **append-only audit trail**: finished runs and history are protected by the database itself.
- Strict CSP, CSRF protection, rate limits that survive restarts, sessions revoked the moment an account is disabled.
- Release images are scanned, smoke-tested on amd64 and arm64, and **signed** with Sigstore.

Every security decision is written down and tested — see the [security policy and checks](docu/security.md).

## 🚀 Get started

### 1. Install it (once, on your server)

You need a machine with Docker (a small VPS or a Raspberry Pi 4/5 is enough), a domain name pointing at it, and an email account the server can send invitations from. VergissMeinNicht runs as one container with SQLite, behind Caddy with automatic HTTPS.

```bash
git clone https://github.com/crimsonclyde/vergissmeinnicht.git && cd vergissmeinnicht/deploy
cp vergissmeinnicht.env.example vergissmeinnicht.env        # set PUBLIC_ORIGIN, SMTP_*, MAIL_FROM_*
mkdir -p secrets && openssl rand -base64 32 > secrets/auth_secret \
  && openssl rand -base64 32 > secrets/data_encryption_key && chmod 0400 secrets/*
export VMN_DOMAIN=vmn.example.org                            # your domain
export VMN_IMAGE=ghcr.io/crimsonclyde/vergissmeinnicht:<version>   # a published release (or skip and build)
docker compose pull app || docker compose build              # use the release, or build from source
docker compose run --rm app migrate
docker compose up -d
docker compose run --rm app admin-bootstrap --email you@example.org   # prints your first sign-in link
```

On **Unraid**? Follow [Installing on Unraid](docu/unraid.md). Published releases are signed — [verify them](docu/deployment.md#published-images) before use. Turn on automatic backups with `BACKUP_INTERVAL_HOURS=24`, and keep a copy of `secrets/data_encryption_key` somewhere safe.

### 2. First steps in the app

1. Open the link printed by `admin-bootstrap`, choose your name and password, and sign in.
2. **Profile & settings** → enable **two-factor authentication** (strongly recommended for admins).
3. **Server admin** → **Create a Workspace** — for example *Home*.
4. **Server admin** → **Invitations**: invite the people who share your routines. On the Workspace's **Members** page, give them a role (*User* to tick off steps, *Editor* to write checklists).
5. **Procedures** → **New Procedure**: write your first routine, e.g. *Leave the house* with *Close windows* and a critical *Turn off stove*.
6. **Start Run** — and tick it off together, on your phones.

Everything else — roles, critical steps, working offline, Knot links, themes — is in the **[user guide](docu/user-guide.md)**.

Running it for others: [Deployment](docu/deployment.md) covers upgrades, backups and restore, reverse proxies and hardening. Want to hack on it? [Local development](docu/local-development.md).

## 🌼 The name

**Vergissmeinnicht** is German for the *forget-me-not* flower — literally **"forget me not"**.
Say it like **fair-GISS-mine-nikht**.

Look closely at the logo: the flower's stem is tied into a knot — a **Forget-Me-Knot**, the little string you tie around your finger so you don't forget.

**VMN** is the short form used in technical names: cookies (`vmn.*`), deployment variables (`VMN_DOMAIN`, `VMN_IMAGE`) and export files (`*.vmn.json`). Package and image names are the lower-case `vergissmeinnicht`.

## 📚 Documentation

- **[User guide](docu/user-guide.md) — how to use VergissMeinNicht**
- [Deployment](docu/deployment.md) — installing, upgrading, backups

For contributors:

- [Agent rules](AGENTS.md) — how humans and coding agents work on this project
- [Project steps and objectives](docu/steps.md) — what is built, how it was tested, what is next
- [Security policy and checks](docu/security.md)
- [Objectives and strategy](docu/objectives-and-strategy.md)
- [Architecture](docu/architecture.md)
- [Local development](docu/local-development.md)
- [Deployment](docu/deployment.md)

## 📈 Status

The core is complete and tested end to end: accounts with optional TOTP, Workspaces and roles, procedures, historical runs with a full audit trail, live collaboration, offline runs, Knot links, admin tools and signed multi-architecture releases. Sign-in with Apple and GitHub is planned. Progress lives in [docu/steps.md](docu/steps.md).

## 🖤 License

Made with 🖤 by CrimsonClyde.

VergissMeinNicht is free software: you can redistribute it and/or modify it under the terms of the [GNU Affero General Public License, version 3](LICENSE) (`AGPL-3.0-only`).

If you run a modified version for others over a network, the AGPL requires you to offer them its source code. The app links to its source in the page footer; point `SOURCE_CODE_URL` at your repository (see [Deployment](docu/deployment.md)). If a server admin hides the footer, offer the source in another visible way.
