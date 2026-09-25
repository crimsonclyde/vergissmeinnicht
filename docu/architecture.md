# Architecture

## Style

Vergissmeinnicht starts as a **modular monolith**.

The goal is strong internal boundaries without unnecessary distributed infrastructure.

## Conceptual layers

```text
Presentation
  routes / web UI / view models

Application
  commands / queries / use cases

Domain
  entities / policies / state transitions

Infrastructure
  SQLite / auth adapters / realtime / logging / import-export
```

Dependencies should point inward. Domain logic must not import the UI framework or database driver.

## Core modules

- Identity
- Workspaces / Memberships / Policies
- Procedures
- Runs
- Audit
- Knots
- Realtime
- Import/Export
- UI/Themes

## Persistence

SQLite is the initial DB.

Requirements:
- migrations from day one;
- foreign keys enabled;
- transactions;
- safe parameterized access;
- WAL where appropriate;
- tested backup/restore.

## Realtime

Commands use authenticated server endpoints.

After successful authoritative mutation, realtime transport fans out canonical Run updates.

The client must always be able to reconnect and refetch current Run state.

The exact WebSocket vs SSE choice will be recorded after stack selection.

## Future extension boundaries

Do not implement now, but avoid coupling that prevents:
- SQLite -> PostgreSQL
- in-process realtime -> shared pub/sub
- local auth -> Apple/GitHub/Microsoft identities

These future options do not justify microservices in V1.
