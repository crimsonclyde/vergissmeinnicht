# Vergissmeinnicht

<p align="center">
  <img src="assets/brand/vergissmeinnicht-hero.svg" alt="A monochrome forget-me-not flower with a knotted stem" width="520">
</p>

**Vergissmeinnicht** is an ADHD-friendly, security-first app for reliable, repeatable checklists and shared routines.

The German word **Vergissmeinnicht** is the name of the *forget-me-not* flower and literally means **“forget me not” / “do not forget me.”**  
Approximate pronunciation for English speakers: **fair-GISS-mine-nikht**.

The knotted flower in the project identity also keeps a little of the **“Forget Me Knot”** idea.

## What this project is

Vergissmeinnicht is not meant to be another basic todo list.

It is designed for repeatable procedures where it matters that every step is handled and that people can later see:

- what still needs to be done;
- what was done;
- who did it;
- when it was done;
- whether something was skipped or not applicable, and why;
- whether the entire procedure was actually completed.

The first real-world use case is a shared “Leaving Casa Nostra” checklist, but the domain is intentionally general-purpose.

## Documentation

Start here:

- [Agent rules](AGENTS.md)
- [Project steps and objectives](docu/steps.md)
- [Security policy and checks](docu/security.md)
- [Objectives and strategy](docu/objectives-and-strategy.md)
- [Architecture](docu/architecture.md)
- [Local development](docu/local-development.md)
- [Deployment](docu/deployment.md)

## Status

Core features are implemented: invite-only accounts with optional TOTP, Workspaces with roles, Procedures with Sections and Steps, historical Runs with a full audit trail, live collaboration and Knot links. See [docu/steps.md](docu/steps.md) for progress and [Local development](docu/local-development.md) to run it.

## License

Vergissmeinnicht is free software: you can redistribute it and/or modify it under the terms of the [GNU Affero General Public License, version 3](LICENSE) (`AGPL-3.0-only`).

If you run a modified version for others over a network, the AGPL requires you to offer them its source code. The app links to its source in the footer of every page; point `SOURCE_CODE_URL` at your repository (see [Deployment](docu/deployment.md)).
