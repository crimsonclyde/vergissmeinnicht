# Local Development

The exact commands will be finalized after the implementation stack is selected.

## Target workflow

```bash
git clone https://github.com/crimsonclyde/vergissmeinnicht.git
cd vergissmeinnicht
cp .env.example .env
# install dependencies
# run migrations
# start development server
```

## Principles

- ordinary development must not require external SaaS;
- development uses the real ACL/auth model rather than a production-capable “disable auth” switch;
- local SQLite data lives in an ignored runtime directory such as `.var/`;
- migrations, not manual DB edits, define schema changes;
- safe seed/demo data may create multiple users/roles for authorization testing;
- no production credentials in fixtures or environment examples.

## Required developer commands once implementation begins

The chosen stack should expose obvious commands for:

- development server
- unit tests
- integration tests
- end-to-end tests
- lint
- typecheck
- migrations
- production build

Whenever these commands change, update this file and the relevant task in `steps.md`.
