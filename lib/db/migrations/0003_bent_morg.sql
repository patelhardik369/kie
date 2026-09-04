CREATE TABLE `favorite_models` (
	`slug` text PRIMARY KEY NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `favorite_models_position_idx` ON `favorite_models` (`position`);