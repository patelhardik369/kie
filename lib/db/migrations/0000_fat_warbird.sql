CREATE TABLE "assets" (
	"id" text PRIMARY KEY NOT NULL,
	"generation_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"kind" text NOT NULL,
	"storage_path" text,
	"storage_state" text DEFAULT 'stored' NOT NULL,
	"remote_url" text NOT NULL,
	"mime" text,
	"bytes" bigint,
	"width" integer,
	"height" integer,
	"duration_ms" integer,
	"idx" integer DEFAULT 0 NOT NULL,
	"layer_meta" text,
	"downloaded_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"balance" double precision NOT NULL,
	"recorded_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "favorite_models" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"slug" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generations" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"kie_task_id" text,
	"model_slug" text NOT NULL,
	"family" text NOT NULL,
	"capability" text NOT NULL,
	"input_json" text NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"result_json_raw" text,
	"credits_consumed" double precision,
	"cost_time_ms" integer,
	"fail_code" text,
	"fail_msg" text,
	"poll_attempts" integer DEFAULT 0 NOT NULL,
	"preset_id" text,
	"parent_id" text,
	"batch_id" text,
	"favorite" boolean DEFAULT false NOT NULL,
	"nsfw" boolean DEFAULT false NOT NULL,
	"notes" text,
	"kie_key_enc" text,
	"lease_owner" text,
	"lease_expires_at" bigint,
	"next_poll_at" bigint,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"submitted_at" bigint,
	"completed_at" bigint,
	CONSTRAINT "generations_kie_task_id_unique" UNIQUE("kie_task_id")
);
--> statement-breakpoint
CREATE TABLE "input_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"storage_path" text NOT NULL,
	"sha256" text NOT NULL,
	"kind" text NOT NULL,
	"mime" text,
	"bytes" bigint,
	"kie_file_url" text,
	"expires_at" bigint,
	"label" text,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "models_cache" (
	"slug" text PRIMARY KEY NOT NULL,
	"family" text NOT NULL,
	"capability" text NOT NULL,
	"params_json" text NOT NULL,
	"doc_url" text NOT NULL,
	"fetched_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "presets" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"model_slug" text NOT NULL,
	"params_json" text NOT NULL,
	"nsfw" boolean DEFAULT false NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"updated_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompts" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"tags_json" text DEFAULT '[]' NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"last_seen_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"stored_bytes" bigint DEFAULT 0 NOT NULL,
	"label" text
);
--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_generation_id_generations_id_fk" FOREIGN KEY ("generation_id") REFERENCES "public"."generations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assets_generation_id_idx" ON "assets" USING btree ("generation_id");--> statement-breakpoint
CREATE INDEX "assets_workspace_idx" ON "assets" USING btree ("workspace_id","downloaded_at");--> statement-breakpoint
CREATE INDEX "assets_storage_path_idx" ON "assets" USING btree ("storage_path");--> statement-breakpoint
CREATE INDEX "credit_log_workspace_idx" ON "credit_log" USING btree ("workspace_id","recorded_at");--> statement-breakpoint
CREATE INDEX "favorite_models_workspace_position_idx" ON "favorite_models" USING btree ("workspace_id","position");--> statement-breakpoint
CREATE INDEX "generations_workspace_created_idx" ON "generations" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "generations_state_idx" ON "generations" USING btree ("state");--> statement-breakpoint
CREATE INDEX "generations_created_at_idx" ON "generations" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "generations_model_slug_idx" ON "generations" USING btree ("model_slug");--> statement-breakpoint
CREATE INDEX "generations_parent_id_idx" ON "generations" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "generations_batch_id_idx" ON "generations" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "generations_nsfw_idx" ON "generations" USING btree ("nsfw");--> statement-breakpoint
CREATE INDEX "generations_due_idx" ON "generations" USING btree ("state","next_poll_at");--> statement-breakpoint
CREATE INDEX "input_assets_workspace_sha_idx" ON "input_assets" USING btree ("workspace_id","sha256");--> statement-breakpoint
CREATE INDEX "input_assets_expires_at_idx" ON "input_assets" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "input_assets_storage_path_idx" ON "input_assets" USING btree ("storage_path");--> statement-breakpoint
CREATE INDEX "presets_workspace_model_idx" ON "presets" USING btree ("workspace_id","model_slug");--> statement-breakpoint
CREATE INDEX "prompts_workspace_idx" ON "prompts" USING btree ("workspace_id","created_at");