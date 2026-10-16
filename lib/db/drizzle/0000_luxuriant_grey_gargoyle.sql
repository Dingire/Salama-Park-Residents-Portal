CREATE TYPE "public"."announcement_publication_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."association_role" AS ENUM('resident', 'returning-officer', 'scrutineer', 'administrator');--> statement-breakpoint
CREATE TYPE "public"."document_publication_status" AS ENUM('draft', 'approved', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."petition_signature_status" AS ENUM('accepted', 'disputed', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."petition_status" AS ENUM('draft', 'approved', 'closed');--> statement-breakpoint
CREATE TYPE "public"."resident_application_status" AS ENUM('pending-verification', 'clarification-requested', 'verified', 'rejected');--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"publication_status" "announcement_publication_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"published_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" text,
	"action" text NOT NULL,
	"record_type" text NOT NULL,
	"record_id" text,
	"metadata" text DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "governance_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"version" text NOT NULL,
	"description" text NOT NULL,
	"storage_path" text,
	"download_url" text,
	"checksum" text,
	"publication_status" "document_publication_status" DEFAULT 'draft' NOT NULL,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"effective_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "membership_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"user_id" text NOT NULL,
	"full_name" text NOT NULL,
	"house_number" text NOT NULL,
	"street_or_zone" text NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"preferred_notification" text NOT NULL,
	"status" "resident_application_status" DEFAULT 'pending-verification' NOT NULL,
	"lives_in_salama_park" boolean NOT NULL,
	"privacy_notice_accepted_at" timestamp with time zone NOT NULL,
	"decision_reason" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_applications_reference_unique" UNIQUE("reference"),
	CONSTRAINT "membership_applications_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "petition_configurations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"petition_version" text NOT NULL,
	"constitution_version" text NOT NULL,
	"eligibility_text" text NOT NULL,
	"opening_at" timestamp with time zone,
	"closing_at" timestamp with time zone,
	"register_snapshot_id" uuid,
	"proposed_threshold" integer,
	"status" "petition_status" DEFAULT 'draft' NOT NULL,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "petition_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"user_id" text NOT NULL,
	"petition_configuration_id" uuid NOT NULL,
	"petition_version" text NOT NULL,
	"constitution_version" text NOT NULL,
	"declaration_version" text NOT NULL,
	"declarations" text NOT NULL,
	"status" "petition_signature_status" DEFAULT 'accepted' NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone,
	CONSTRAINT "petition_submissions_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "register_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"denominator" integer NOT NULL,
	"cutoff_at" timestamp with time zone NOT NULL,
	"rules_description" text NOT NULL,
	"integrity_hash" text NOT NULL,
	"approved_by" text NOT NULL,
	"approved_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "register_snapshots_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"role" "association_role" NOT NULL,
	"assigned_by" text,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "membership_applications" ADD CONSTRAINT "membership_applications_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "petition_configurations" ADD CONSTRAINT "petition_configurations_register_snapshot_id_register_snapshots_id_fk" FOREIGN KEY ("register_snapshot_id") REFERENCES "public"."register_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "petition_submissions" ADD CONSTRAINT "petition_submissions_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "petition_submissions" ADD CONSTRAINT "petition_submissions_petition_configuration_id_petition_configurations_id_fk" FOREIGN KEY ("petition_configuration_id") REFERENCES "public"."petition_configurations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "announcements_publication_idx" ON "announcements" USING btree ("publication_status","published_at");--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "governance_documents_publication_idx" ON "governance_documents" USING btree ("publication_status","published_at");--> statement-breakpoint
CREATE INDEX "membership_applications_status_submitted_idx" ON "membership_applications" USING btree ("status","submitted_at");--> statement-breakpoint
CREATE INDEX "membership_applications_name_idx" ON "membership_applications" USING btree ("full_name");--> statement-breakpoint
CREATE INDEX "petition_configurations_status_idx" ON "petition_configurations" USING btree ("status","opening_at");--> statement-breakpoint
CREATE UNIQUE INDEX "petition_submissions_one_active_per_resident_idx" ON "petition_submissions" USING btree ("user_id","petition_configuration_id") WHERE "petition_submissions"."status" = 'accepted';--> statement-breakpoint
CREATE INDEX "petition_submissions_config_status_idx" ON "petition_submissions" USING btree ("petition_configuration_id","status");--> statement-breakpoint
CREATE INDEX "user_roles_user_active_idx" ON "user_roles" USING btree ("user_id","revoked_at");