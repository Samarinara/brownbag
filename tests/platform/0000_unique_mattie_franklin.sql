CREATE SCHEMA "platform";
--> statement-breakpoint
CREATE TABLE "platform"."accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workos_id" text NOT NULL,
	"username" text,
	"display_name" text DEFAULT '' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"delete_after" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_workos_id_unique" UNIQUE("workos_id"),
	CONSTRAINT "account_status" CHECK ("platform"."accounts"."status" in ('active', 'pending_deletion', 'deleting')),
	CONSTRAINT "username_format" CHECK ("platform"."accounts"."username" is null or "platform"."accounts"."username" ~ '^[a-z0-9_]{3,30}$'),
	CONSTRAINT "deletion_state" CHECK (("platform"."accounts"."status" = 'active' and "platform"."accounts"."delete_after" is null) or ("platform"."accounts"."status" <> 'active' and "platform"."accounts"."delete_after" is not null))
);
--> statement-breakpoint
CREATE TABLE "platform"."deletion_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_state" CHECK ("platform"."deletion_jobs"."state" in ('pending', 'cancelled', 'completed'))
);
--> statement-breakpoint
CREATE TABLE "platform"."entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"language" text DEFAULT 'und' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "platform"."relationships" (
	"entity_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"relation" text NOT NULL,
	CONSTRAINT "relationships_entity_id_account_id_relation_pk" PRIMARY KEY("entity_id","account_id","relation"),
	CONSTRAINT "relationship_kind" CHECK ("platform"."relationships"."relation" in ('editor', 'viewer'))
);
--> statement-breakpoint
ALTER TABLE "platform"."deletion_jobs" ADD CONSTRAINT "deletion_jobs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "platform"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."entities" ADD CONSTRAINT "entities_owner_id_accounts_id_fk" FOREIGN KEY ("owner_id") REFERENCES "platform"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."relationships" ADD CONSTRAINT "relationships_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "platform"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."relationships" ADD CONSTRAINT "relationships_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "platform"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_username_unique" ON "platform"."accounts" USING btree ("username");
