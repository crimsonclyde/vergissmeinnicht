# Admin documentation

## Instance operators and server admins

- [Deployment](deployment.md) — Docker Compose, configuration, first account, upgrades, signed images, backups and restore.
- [Installing on Unraid](unraid.md) — Unraid-specific setup and operation.
- [Security policy](../development/security.md) — authentication, authorisation and operational requirements.

## Workspace admins

[The user guide](../user/user-guide.md) covers membership, roles, Workspace settings, optional tools, storage and Trash. A Workspace admin manages that Workspace; a server admin manages the instance and has no automatic access to another Workspace's content.

Currently Documents, Contacts, Maintenance and Equipment can be switched on or off per Workspace. Disabling keeps their data. Mail is planned.

**Workspace tools:** all eight implemented functional tools default off for new Workspaces. Workspace admins choose them in Settings → General → Tools; Today and settings stay available. Upgrade migration 0036 enables previously available Procedures, Reminders, Lists and Calendar and preserves house flags. Disabling hides access for every role but keeps data, history and storage usage. Procedures and standalone Reminders own their schedules independently; disabling a source stops its outbound notifications. Calendar disable affects only its view. Reenable catches up the last 24 hours, supersedes older pending notifications and preserves delivery deduplication; it never completes an item. Concurrent settings writes require the revision seen by the admin; a conflict asks for a reload. Mail remains unavailable until implemented. Take and verify the normal pre-upgrade backup before migrating.

Equipment (16.8) adds migration `0037_equipment`: existing flags, tool revision, records and history are preserved; Equipment starts off until a Workspace admin enables it. It adds no file store or worker. Backups cover Equipment through the database. Ordinary linked Reminders keep their own Schedule lifecycle and tool gates when Equipment is disabled. Contact exports remain USER-and-above downloads; `.vcf` is suitable for explicit phone import, with no phone account connection or synchronisation.
