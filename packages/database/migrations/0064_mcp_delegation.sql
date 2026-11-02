CREATE TABLE `mcp_authorization_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`params` text NOT NULL,
	`expires_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`used_at` integer,
	FOREIGN KEY (`client_id`) REFERENCES `mcp_clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `mcp_clients` (
	`id` text PRIMARY KEY NOT NULL,
	`metadata` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mcp_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`client_id` text NOT NULL,
	`workspace_ids` text NOT NULL,
	`scopes` text NOT NULL,
	`resource` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`expires_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `mcp_clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `mcp_grant_user` ON `mcp_grants` (`user_id`);--> statement-breakpoint
CREATE TABLE `mcp_tokens` (
	`hash` text PRIMARY KEY NOT NULL,
	`grant_id` text NOT NULL,
	`kind` text NOT NULL,
	`expires_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`used_at` integer,
	`code_challenge` text,
	`redirect_uri` text,
	FOREIGN KEY (`grant_id`) REFERENCES `mcp_grants`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "mcp_token_kind" CHECK("mcp_tokens"."kind" in ('code','access','refresh'))
);
--> statement-breakpoint
CREATE INDEX `mcp_token_grant` ON `mcp_tokens` (`grant_id`);
--> statement-breakpoint
CREATE TRIGGER mcp_grant_identity_immutable BEFORE UPDATE OF id,user_id,client_id,workspace_ids,scopes,resource,created_at,expires_at ON mcp_grants BEGIN SELECT RAISE(ABORT,'immutable delegation'); END;
--> statement-breakpoint
CREATE TRIGGER mcp_revoke_disabled AFTER UPDATE OF status ON users WHEN NEW.status <> 'ACTIVE' BEGIN UPDATE mcp_grants SET revoked_at=cast(unixepoch('subsecond')*1000 as integer) WHERE user_id=NEW.id AND revoked_at IS NULL; END;
--> statement-breakpoint
CREATE TRIGGER mcp_revoke_password AFTER UPDATE OF password ON accounts WHEN NEW.password IS NOT OLD.password BEGIN UPDATE mcp_grants SET revoked_at=cast(unixepoch('subsecond')*1000 as integer) WHERE user_id=NEW.user_id AND revoked_at IS NULL; END;
--> statement-breakpoint
CREATE TRIGGER mcp_revoke_mfa_added AFTER INSERT ON totp_credentials BEGIN UPDATE mcp_grants SET revoked_at=cast(unixepoch('subsecond')*1000 as integer) WHERE user_id=NEW.user_id AND revoked_at IS NULL; END;
--> statement-breakpoint
CREATE TRIGGER mcp_revoke_mfa_removed AFTER DELETE ON totp_credentials BEGIN UPDATE mcp_grants SET revoked_at=cast(unixepoch('subsecond')*1000 as integer) WHERE user_id=OLD.user_id AND revoked_at IS NULL; END;

--> statement-breakpoint
CREATE TRIGGER mcp_grant_active BEFORE INSERT ON mcp_grants WHEN NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND status='ACTIVE') BEGIN SELECT RAISE(ABORT,'delegation requires active identity'); END;
--> statement-breakpoint
CREATE TRIGGER mcp_revoke_mfa_changed AFTER UPDATE OF sealed_secret,enabled_at ON totp_credentials WHEN NEW.sealed_secret IS NOT OLD.sealed_secret OR NEW.enabled_at IS NOT OLD.enabled_at BEGIN UPDATE mcp_grants SET revoked_at=cast(unixepoch('subsecond')*1000 as integer) WHERE user_id=NEW.user_id AND revoked_at IS NULL; END;
