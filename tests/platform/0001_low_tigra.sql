CREATE TABLE "platform"."mutation_receipts" (
	"account_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mutation_receipts_account_id_operation_id_pk" PRIMARY KEY("account_id","operation_id")
);
--> statement-breakpoint
CREATE TABLE "platform"."rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."revoked_sessions" (
	"hash" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."revoked_subjects" (
	"hash" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."sync_events" (
	"account_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"entity_id" uuid NOT NULL,
	"type" text NOT NULL,
	"kind" text NOT NULL,
	CONSTRAINT "sync_events_account_id_version_pk" PRIMARY KEY("account_id","version")
);
--> statement-breakpoint
CREATE TABLE "platform"."sync_heads" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"version" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform"."deletion_jobs" DROP CONSTRAINT "job_state";--> statement-breakpoint
ALTER TABLE "platform"."deletion_jobs" DROP CONSTRAINT "deletion_jobs_account_id_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "platform"."deletion_jobs" ALTER COLUMN "account_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "platform"."deletion_jobs" ADD COLUMN "scope" jsonb DEFAULT '{"kind":"account"}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "platform"."deletion_jobs" ADD COLUMN "targets" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "platform"."deletion_jobs" ADD COLUMN "completed_targets" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "platform"."deletion_jobs" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "platform"."deletion_jobs" ADD COLUMN "lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "platform"."deletion_jobs" ADD COLUMN "lease_token" uuid;--> statement-breakpoint
ALTER TABLE "platform"."deletion_jobs" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "platform"."mutation_receipts" ADD CONSTRAINT "mutation_receipts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "platform"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."sync_events" ADD CONSTRAINT "sync_events_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "platform"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."sync_heads" ADD CONSTRAINT "sync_heads_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "platform"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rate_limits_expiry" ON "platform"."rate_limits" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "platform"."deletion_jobs" ADD CONSTRAINT "deletion_jobs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "platform"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."deletion_jobs" ADD CONSTRAINT "job_state" CHECK ("platform"."deletion_jobs"."state" in ('pending', 'running', 'cancelled', 'completed'));
