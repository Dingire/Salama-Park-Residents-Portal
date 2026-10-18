DO $$ BEGIN
  CREATE TYPE "subscription_vote" AS ENUM ('k50', 'k100', 'k150');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "household_type" AS ENUM ('homeowner', 'tenant');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER TABLE "petition_submissions" ADD COLUMN IF NOT EXISTS "subscription_vote" "subscription_vote";
--> statement-breakpoint
ALTER TABLE "petition_submissions" ADD COLUMN IF NOT EXISTS "online_voting_consent" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "petition_submissions" ADD COLUMN IF NOT EXISTS "willing_to_volunteer" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "petition_submissions" ADD COLUMN IF NOT EXISTS "volunteer_skills" text;
--> statement-breakpoint
ALTER TABLE "petition_submissions" ADD COLUMN IF NOT EXISTS "household_type" "household_type";
--> statement-breakpoint
ALTER TABLE "petition_submissions" ADD COLUMN IF NOT EXISTS "adults_in_household" integer;
--> statement-breakpoint
ALTER TABLE "petition_submissions" ADD COLUMN IF NOT EXISTS "emergency_contact_name" text;
--> statement-breakpoint
ALTER TABLE "petition_submissions" ADD COLUMN IF NOT EXISTS "emergency_contact_phone" text;
--> statement-breakpoint
ALTER TABLE "petition_submissions" ADD COLUMN IF NOT EXISTS "emergency_contact_relationship" text;
--> statement-breakpoint
ALTER TABLE "petition_submissions" ADD COLUMN IF NOT EXISTS "on_members_register" boolean;
--> statement-breakpoint
ALTER TABLE "petition_submissions" ADD COLUMN IF NOT EXISTS "duplicate_flag" boolean;
--> statement-breakpoint
ALTER TABLE "petition_submissions" ADD COLUMN IF NOT EXISTS "verified_by" text;
--> statement-breakpoint
ALTER TABLE "petition_submissions" ADD COLUMN IF NOT EXISTS "verified_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "petition_submissions" ADD COLUMN IF NOT EXISTS "verification_notes" text;
