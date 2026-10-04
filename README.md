<p align="center">
  <img src="assets/brand/vergissmeinnicht-hero.png" alt="Forget-me-not flowers with a knotted stem" width="640">
</p>

<h1 align="center">VergissMeinNicht</h1>

<p align="center">
  <strong>A shared place for the things you want to remember.</strong><br>
  Routines, reminders, shopping lists and everyday management — with a history you can trust.
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-blue"></a>
  <a href="https://github.com/crimsonclyde/vergissmeinnicht/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/crimsonclyde/vergissmeinnicht/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="Self-hosted" src="https://img.shields.io/badge/self--hosted-Docker%20Compose-2496ED">
</p>

**VergissMeinNicht** (**VMN**) helps households and teams organise everyday responsibilities in shared Workspaces. Write reusable Procedures, carry them out together, schedule recurring obligations, keep shopping lists and organise Documents, Contacts and Maintenance.

The interface focuses on clear actions, manageable steps and easy undo. Runs preserve what was done, by whom and when, independently of later edits to a Procedure. VMN is self-hosted, open source, and usable on phones and desktops, with Light and Dark themes.

## Screenshots

Actual app captures from the fictional local demo; [capture details and more views](assets/screenshots/workspace-tools-2026-10-04/README.md).

![Today on desktop in Light mode, showing progress, Continue and recent completions](assets/screenshots/workspace-tools-2026-10-04/today-desktop-light.webp)

<p align="center">
  <img src="assets/screenshots/workspace-tools-2026-10-04/today-phone-dark.webp" alt="Today in Dark mode on a phone, with scoped progress and Continue" width="260">
  <img src="assets/screenshots/workspace-tools-2026-10-04/run-phone-light.webp" alt="Phone Run execution in Light mode, with a pending Critical Step and Hold to confirm" width="260">
</p>

## Documentation

| I want to… | Start here |
|---|---|
| Use VMN | [User documentation](docs/user/README.md) |
| Install, configure or maintain an instance | [Admin documentation](docs/admin/README.md) |
| Contribute or develop locally | [Development documentation](docs/development/README.md) |
| Check planned work and known limitations | [Project steps](docs/development/steps.md) |
| Review security policies | [Security policy](docs/development/security.md) |

The [documentation index](docs/README.md) links to all guides. Setup commands, feature details and operational instructions live there rather than being duplicated in this README.

## Project status

VMN is in beta. Procedures, collaborative Runs, scheduling, email and optional Telegram reminders, grocery Lists, Documents, Contacts and Maintenance are implemented. Equipment, text recognition and Mail are planned. The [implementation ledger](docs/development/steps.md) records released work, validation gaps and upcoming changes, including implemented Workspace tool switches and scoped Today progress. New Workspaces start with all functional tools off; admins choose what to enable.

## The name

*Vergissmeinnicht* is German for the **forget-me-not** flower — literally “forget me not.” Say it like **fair-GISS-mine-nikht**. The knotted stem in the logo is a **Forget-Me-Knot**, like a string tied around a finger as a reminder.

## License

Made with 🖤 by CrimsonClyde. Licensed under [GNU AGPL v3](LICENSE) (`AGPL-3.0-only`). If you run a modified version for others over a network, offer its source code; configuration is covered in the [admin guide](docs/admin/deployment.md).

Bundled third-party software, including [Tabler Icons](https://tabler.io/icons) (MIT), is listed with its license texts at `/third-party-notices.txt` in each running instance.
