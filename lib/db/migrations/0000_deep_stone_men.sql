CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`generation_id` text NOT NULL,
	`kind` text NOT NULL,
	`local_path` text NOT NULL,
	`remote_url` text NOT NULL,
	`mime` text,
	`bytes` integer,
	`width` integer,
	`height` integer,
	`duration_ms` integer,
	`idx` integer DEFAULT 0 NOT NULL,
	`layer_meta` text,
	`downloaded_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`generation_id`) REFERENCES `generations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `assets_generation_id_idx` ON `assets` (`generation_id`);--> statement-breakpoint
CREATE TABLE `credit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`balance` real NOT NULL,
	`recorded_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `generations` (
	`id` text PRIMARY KEY NOT NULL,
	`kie_task_id` text,
	`model_slug` text NOT NULL,
	`family` text NOT NULL,
	`capability` text NOT NULL,
	`input_json` text NOT NULL,
	`state` text DEFAULT 'draft' NOT NULL,
	`result_json_raw` text,
	`credits_consumed` real,
	`cost_time_ms` integer,
	`fail_code` text,
	`fail_msg` text,
	`poll_attempts` integer DEFAULT 0 NOT NULL,
	`preset_id` text,
	`parent_id` text,
	`batch_id` text,
	`favorite` integer DEFAULT false NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`submitted_at` integer,
	`completed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `generations_kie_task_id_unique` ON `generations` (`kie_task_id`);--> statement-breakpoint
CREATE INDEX `generations_state_idx` ON `generations` (`state`);--> statement-breakpoint
CREATE INDEX `generations_created_at_idx` ON `generations` (`created_at`);--> statement-breakpoint
CREATE INDEX `generations_model_slug_idx` ON `generations` (`model_slug`);--> statement-breakpoint
CREATE INDEX `generations_parent_id_idx` ON `generations` (`parent_id`);--> statement-breakpoint
CREATE INDEX `generations_batch_id_idx` ON `generations` (`batch_id`);--> statement-breakpoint
CREATE TABLE `input_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`local_path` text NOT NULL,
	`sha256` text NOT NULL,
	`kind` text NOT NULL,
	`mime` text,
	`bytes` integer,
	`kie_file_url` text,
	`expires_at` integer,
	`label` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `input_assets_sha256_idx` ON `input_assets` (`sha256`);--> statement-breakpoint
CREATE INDEX `input_assets_expires_at_idx` ON `input_assets` (`expires_at`);--> statement-breakpoint
CREATE TABLE `models_cache` (
	`slug` text PRIMARY KEY NOT NULL,
	`family` text NOT NULL,
	`capability` text NOT NULL,
	`params_json` text NOT NULL,
	`doc_url` text NOT NULL,
	`fetched_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `presets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`model_slug` text NOT NULL,
	`params_json` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `presets_model_slug_idx` ON `presets` (`model_slug`);--> statement-breakpoint
CREATE TABLE `prompts` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
