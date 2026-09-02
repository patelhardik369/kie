ALTER TABLE `generations` ADD `nsfw` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `generations_nsfw_idx` ON `generations` (`nsfw`);