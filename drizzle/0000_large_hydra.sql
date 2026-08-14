CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`action` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text,
	`actor` text NOT NULL,
	`metadata` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `audit_events_user_idx` ON `audit_events` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `connected_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`account_label` text NOT NULL,
	`access_token_encrypted` text,
	`refresh_token_encrypted` text,
	`token_expires_at` integer,
	`granted_scopes` text NOT NULL,
	`last_synced_at` integer,
	`last_sync_error` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `connected_accounts_user_idx` ON `connected_accounts` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `connected_accounts_user_provider_label_idx` ON `connected_accounts` (`user_id`,`provider`,`account_label`);--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `conversations_user_idx` ON `conversations` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `daily_briefings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`local_date` text NOT NULL,
	`short_body` text NOT NULL,
	`expanded_body` text,
	`suggested_order` text NOT NULL,
	`prompt_version` text,
	`model_id` text,
	`delivered_at` integer,
	`spoken_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `daily_briefings_user_date_idx` ON `daily_briefings` (`user_id`,`local_date`);--> statement-breakpoint
CREATE TABLE `draft_approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`draft_id` text NOT NULL,
	`user_id` text NOT NULL,
	`approved_content_hash` text NOT NULL,
	`approved_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`draft_id`) REFERENCES `email_drafts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `draft_approvals_draft_idx` ON `draft_approvals` (`draft_id`);--> statement-breakpoint
CREATE TABLE `email_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`thread_id` text,
	`account_id` text,
	`status` text DEFAULT 'suggested' NOT NULL,
	`to_recipients` text NOT NULL,
	`cc_recipients` text NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`confidence` text NOT NULL,
	`requires_careful_review` integer DEFAULT false NOT NULL,
	`snoozed_until` integer,
	`idempotency_key` text NOT NULL,
	`prompt_version` text,
	`model_id` text,
	`is_demo` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`sent_at` integer,
	`deleted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thread_id`) REFERENCES `email_threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `connected_accounts`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "email_drafts_status_valid" CHECK(status in ('suggested', 'drafted', 'approved', 'sent', 'dismissed', 'snoozed')),
	CONSTRAINT "email_drafts_sent_has_time" CHECK("email_drafts"."status" <> 'sent' or "email_drafts"."sent_at" is not null)
);
--> statement-breakpoint
CREATE INDEX `email_drafts_user_status_idx` ON `email_drafts` (`user_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `email_drafts_idempotency_idx` ON `email_drafts` (`idempotency_key`);--> statement-breakpoint
CREATE TABLE `email_thread_summaries` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`user_id` text NOT NULL,
	`summary` text NOT NULL,
	`needs_reply` integer DEFAULT false NOT NULL,
	`confidence` text NOT NULL,
	`prompt_version` text NOT NULL,
	`model_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `email_threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_summaries_thread_idx` ON `email_thread_summaries` (`thread_id`);--> statement-breakpoint
CREATE TABLE `email_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text,
	`external_thread_id` text NOT NULL,
	`subject` text,
	`participants` text NOT NULL,
	`last_message_at` integer,
	`last_message_from_me` integer DEFAULT false NOT NULL,
	`unread` integer DEFAULT false NOT NULL,
	`category` text DEFAULT 'primary' NOT NULL,
	`sensitivity` text DEFAULT 'normal' NOT NULL,
	`is_demo` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `connected_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `email_threads_user_idx` ON `email_threads` (`user_id`,`last_message_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `email_threads_user_external_idx` ON `email_threads` (`user_id`,`external_thread_id`);--> statement-breakpoint
CREATE TABLE `encouragements` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`body` text NOT NULL,
	`attribution` text,
	`kind` text NOT NULL,
	`local_date` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "encouragements_kind_valid" CHECK("encouragements"."kind" in ('quote', 'original')),
	CONSTRAINT "encouragements_original_unattributed" CHECK("encouragements"."kind" <> 'original' or "encouragements"."attribution" is null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `encouragements_user_date_idx` ON `encouragements` (`user_id`,`local_date`);--> statement-breakpoint
CREATE TABLE `item_audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`user_id` text NOT NULL,
	`action` text NOT NULL,
	`from_value` text,
	`to_value` text,
	`actor` text NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "item_audit_actor_valid" CHECK(actor in ('user', 'ai', 'system'))
);
--> statement-breakpoint
CREATE INDEX `item_audit_item_idx` ON `item_audit_events` (`item_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `items` (
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
	CONSTRAINT "items_ai_requires_confidence" CHECK("items"."origin" <> 'ai' or ("items"."confidence" is not null and "items"."reason" is not null))
);
--> statement-breakpoint
CREATE INDEX `items_user_status_idx` ON `items` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `items_user_kind_idx` ON `items` (`user_id`,`kind`);--> statement-breakpoint
CREATE INDEX `items_user_due_idx` ON `items` (`user_id`,`due_at`);--> statement-breakpoint
CREATE INDEX `items_user_followup_idx` ON `items` (`user_id`,`follow_up_at`);--> statement-breakpoint
CREATE INDEX `items_snoozed_idx` ON `items` (`snoozed_until`);--> statement-breakpoint
CREATE UNIQUE INDEX `items_user_dedupe_idx` ON `items` (`user_id`,`dedupe_key`);--> statement-breakpoint
CREATE TABLE `job_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`job_name` text NOT NULL,
	`status` text NOT NULL,
	`started_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`finished_at` integer,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `job_runs_name_idx` ON `job_runs` (`job_name`,`started_at`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`input_mode` text DEFAULT 'text' NOT NULL,
	`prompt_version` text,
	`model_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "messages_role_valid" CHECK("messages"."role" in ('user', 'assistant'))
);
--> statement-breakpoint
CREATE INDEX `messages_conversation_idx` ON `messages` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `proposed_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`action_type` text NOT NULL,
	`payload` text NOT NULL,
	`summary` text NOT NULL,
	`confidence` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`conversation_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "proposed_actions_status_valid" CHECK("proposed_actions"."status" in ('pending', 'approved', 'rejected', 'expired'))
);
--> statement-breakpoint
CREATE INDEX `proposed_actions_user_status_idx` ON `proposed_actions` (`user_id`,`status`);--> statement-breakpoint
CREATE TABLE `reminder_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`reminder_id` text,
	`event_type` text NOT NULL,
	`local_date` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reminder_id`) REFERENCES `reminders`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `reminder_events_user_day_idx` ON `reminder_events` (`user_id`,`local_date`,`event_type`);--> statement-breakpoint
CREATE TABLE `reminders` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`item_id` text,
	`level` text DEFAULT 'gentle' NOT NULL,
	`scheduled_for` integer NOT NULL,
	`body` text NOT NULL,
	`body_hash` text NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`suppression_reason` text,
	`delivered_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "reminders_level_valid" CHECK(level in ('silent', 'gentle', 'direct', 'urgent'))
);
--> statement-breakpoint
CREATE INDEX `reminders_due_idx` ON `reminders` (`status`,`scheduled_for`);--> statement-breakpoint
CREATE INDEX `reminders_user_item_idx` ON `reminders` (`user_id`,`item_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `reminders_user_body_idx` ON `reminders` (`user_id`,`body_hash`);--> statement-breakpoint
CREATE TABLE `source_records` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`external_id` text,
	`external_url` text,
	`title` text,
	`author` text,
	`occurred_at` integer,
	`excerpt` text,
	`excerpt_start` integer,
	`excerpt_end` integer,
	`is_demo` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "source_records_kind_valid" CHECK(kind in ('email', 'calendar', 'task', 'note', 'conversation', 'manual'))
);
--> statement-breakpoint
CREATE INDEX `source_records_user_kind_idx` ON `source_records` (`user_id`,`kind`);--> statement-breakpoint
CREATE UNIQUE INDEX `source_records_user_external_idx` ON `source_records` (`user_id`,`kind`,`external_id`);--> statement-breakpoint
CREATE TABLE `source_references` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`source_record_id` text NOT NULL,
	`item_id` text,
	`draft_id` text,
	`briefing_id` text,
	`relevance` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_record_id`) REFERENCES `source_records`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "source_refs_targets_something" CHECK("source_references"."item_id" is not null or "source_references"."draft_id" is not null or "source_references"."briefing_id" is not null)
);
--> statement-breakpoint
CREATE INDEX `source_refs_item_idx` ON `source_references` (`item_id`);--> statement-breakpoint
CREATE INDEX `source_refs_draft_idx` ON `source_references` (`draft_id`);--> statement-breakpoint
CREATE INDEX `source_refs_source_idx` ON `source_references` (`source_record_id`);--> statement-breakpoint
CREATE TABLE `sync_cursors` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text,
	`resource` text NOT NULL,
	`cursor` text,
	`last_success_at` integer,
	`last_error_at` integer,
	`last_error` text,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `connected_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sync_cursors_scope_idx` ON `sync_cursors` (`user_id`,`account_id`,`resource`);--> statement-breakpoint
CREATE TABLE `user_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`timezone` text DEFAULT 'America/Detroit' NOT NULL,
	`briefing_time` text DEFAULT '08:00' NOT NULL,
	`quiet_hours_start` text DEFAULT '20:00' NOT NULL,
	`quiet_hours_end` text DEFAULT '08:00' NOT NULL,
	`daily_nudge_budget` integer DEFAULT 2 NOT NULL,
	`briefings_per_day` integer DEFAULT 1 NOT NULL,
	`reminder_intensity` text DEFAULT 'gentle' NOT NULL,
	`proactive_reminders_paused` integer DEFAULT false NOT NULL,
	`quotes_enabled` integer DEFAULT true NOT NULL,
	`max_quotes_per_day` integer DEFAULT 1 NOT NULL,
	`weekend_briefings` integer DEFAULT false NOT NULL,
	`weekend_reminders` integer DEFAULT false NOT NULL,
	`voice_enabled` integer DEFAULT true NOT NULL,
	`hands_free_enabled` integer DEFAULT false NOT NULL,
	`store_audio` integer DEFAULT false NOT NULL,
	`drafting_tone` text DEFAULT 'warm, direct, concise' NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "prefs_intensity_valid" CHECK(reminder_intensity in ('silent', 'gentle', 'direct', 'urgent')),
	CONSTRAINT "prefs_nudge_budget_sane" CHECK("user_preferences"."daily_nudge_budget" >= 0 and "user_preferences"."daily_nudge_budget" <= 10)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`email` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
