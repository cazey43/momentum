PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_items` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'inbox' NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`title` text NOT NULL,
	`detail` text,
	`due_at` integer,
	`follow_up_at` integer,
	`snoozed_until` integer,
	`counterpart_name` text,
	`counterpart_email` text,
	`project` text,
	`origin` text DEFAULT 'user' NOT NULL,
	`confidence` text,
	`reason` text,
	`reminder_level` text DEFAULT 'gentle' NOT NULL,
	`remind_once` integer DEFAULT false NOT NULL,
	`reminders_muted` integer DEFAULT false NOT NULL,
	`nudge_count` integer DEFAULT 0 NOT NULL,
	`last_nudged_at` integer,
	`last_engaged_at` integer,
	`dedupe_key` text NOT NULL,
	`is_demo` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`completed_at` integer,
	`deleted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "items_kind_valid" CHECK(kind in ('task', 'commitment', 'waiting_for', 'delegated', 'follow_up', 'someday', 'note')),
	CONSTRAINT "items_status_valid" CHECK(status in ('inbox', 'open', 'in_progress', 'blocked', 'snoozed', 'done', 'dismissed')),
	CONSTRAINT "items_priority_valid" CHECK(priority in ('low', 'normal', 'high')),
	CONSTRAINT "items_origin_valid" CHECK(origin in ('user', 'ai', 'system')),
	CONSTRAINT "items_confidence_valid" CHECK(confidence is null or confidence in ('low', 'medium', 'high')),
	CONSTRAINT "items_ai_requires_confidence" CHECK("__new_items"."origin" <> 'ai' or ("__new_items"."confidence" is not null and "__new_items"."reason" is not null))
);
--> statement-breakpoint
INSERT INTO `__new_items`("id", "user_id", "kind", "status", "priority", "title", "detail", "due_at", "follow_up_at", "snoozed_until", "counterpart_name", "counterpart_email", "project", "origin", "confidence", "reason", "reminder_level", "remind_once", "reminders_muted", "nudge_count", "last_nudged_at", "last_engaged_at", "dedupe_key", "is_demo", "created_at", "updated_at", "completed_at", "deleted_at") SELECT "id", "user_id", "kind", "status", "priority", "title", "detail", "due_at", "follow_up_at", "snoozed_until", "counterpart_name", "counterpart_email", "project", "origin", "confidence", "reason", "reminder_level", "remind_once", "reminders_muted", "nudge_count", "last_nudged_at", "last_engaged_at", "dedupe_key", "is_demo", "created_at", "updated_at", "completed_at", "deleted_at" FROM `items`;--> statement-breakpoint
DROP TABLE `items`;--> statement-breakpoint
ALTER TABLE `__new_items` RENAME TO `items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `items_user_status_idx` ON `items` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `items_user_kind_idx` ON `items` (`user_id`,`kind`);--> statement-breakpoint
CREATE INDEX `items_user_due_idx` ON `items` (`user_id`,`due_at`);--> statement-breakpoint
CREATE INDEX `items_user_followup_idx` ON `items` (`user_id`,`follow_up_at`);--> statement-breakpoint
CREATE INDEX `items_snoozed_idx` ON `items` (`snoozed_until`);--> statement-breakpoint
CREATE UNIQUE INDEX `items_user_dedupe_idx` ON `items` (`user_id`,`dedupe_key`);