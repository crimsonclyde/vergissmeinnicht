# Admin documentation

## Instance operators and server admins

- [Deployment](deployment.md) — Docker Compose, configuration, first account, upgrades, signed images, backups and restore.
- [Installing on Unraid](unraid.md) — Unraid-specific setup and operation.
- [AI assistant connections (MCP)](mcp.md) — supported actions, account authorization and setup.
- [Connect private VMN to ChatGPT](chatgpt-mcp-tunnel.md) — OpenAI Secure MCP Tunnel setup, an assistant prompt, and troubleshooting.
- [Security policy](../development/security.md) — authentication, authorisation and operational requirements.

## Workspace admins

[The user guide](../user/user-guide.md) covers membership, roles, Workspace settings, optional tools, storage and Trash. A Workspace admin manages that Workspace; a server admin manages the instance and has no automatic access to another Workspace's content.

Workspace admins manage membership and select the tools under **Settings → General → Tools**. Functional tools start off in new Workspaces. Today and settings remain available. Disabling a tool hides it and retains its records, history and storage usage. Existing Workspaces retain their enabled tools on upgrade.

Disabling Procedures or standalone Reminders also stops outbound notifications for that source. Disabling Calendar affects the calendar view. Re-enabling a reminder source catches up the last 24 hours and supersedes older pending notifications. If someone else changes the tool settings first, reload to see the current selection before saving.
