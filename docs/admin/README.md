# Admin documentation

## Instance operators and server admins

- [Deployment](deployment.md) — Docker Compose, configuration, first account, upgrades, signed images, backups and restore.
- [Installing on Unraid](unraid.md) — Unraid-specific setup and operation.
- [Security policy](../development/security.md) — authentication, authorisation and operational requirements.

## Workspace admins

[The user guide](../user/user-guide.md) covers membership, roles, Workspace settings, optional tools, storage and Trash. A Workspace admin manages that Workspace; a server admin manages the instance and has no automatic access to another Workspace's content.

Currently Documents, Contacts and Maintenance can be switched on or off per Workspace. Disabling keeps their data. Equipment and Mail are planned.

**Planned:** switches for every functional tool, with all tools off in new Workspaces. Today and settings remain available so an admin can choose what the Workspace needs. This is not implemented yet; migration, cross-tool dependencies and notification behaviour are specified in [step 17.1](../development/steps.md#171-every-workspace-tool-is-optional).

## First Workspace setup

1. Open the bootstrap invitation, choose your name and password, and sign in.
2. In **Profile & settings**, enable two-factor authentication (recommended for admins).
3. In **Server admin**, create a Workspace and invite the people who will use it.
4. On the Workspace's **Members** page, assign roles: User can execute, Editor can also write Procedures.
5. In Workspace settings, enable Documents, Contacts or Maintenance if you need them.
6. Create a Procedure and choose **Start**, or create a Reminder or Grocery list.

These steps describe the current beta. The all-tool opt-in setup is planned in step 17.1.
