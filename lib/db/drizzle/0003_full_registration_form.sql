DO $$ BEGIN
  CREATE TYPE "gender" AS ENUM ('male', 'female', 'other');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "residency_status" AS ENUM ('owner-occupier', 'tenant', 'owner-landlord', 'family-member');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "membership_category" AS ENUM ('full', 'associate', 'honorary');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "relief_option" AS ENUM ('yes', 'no', 'not-applicable');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "payment_method" AS ENUM ('mobile-money', 'bank-transfer', 'cash');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "preferred_language" AS ENUM ('english', 'nyanja', 'bemba', 'tonga', 'other');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "application_rejection_category" AS ENUM ('duplicate', 'not-resident', 'incomplete-declaration', 'other');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER TABLE "membership_applications" ADD COLUMN IF NOT EXISTS "nrc_number" text;
--> statement-breakpoint
ALTER TABLE "membership_applications" ADD COLUMN IF NOT EXISTS "passport_number" text;
--> statement-breakpoint
ALTER TABLE "membership_applications" ADD COLUMN IF NOT EXISTS "date_of_birth" text;
--> statement-breakpoint
ALTER TABLE "membership_applications" ADD COLUMN IF NOT EXISTS "gender" "gender";
--> statement-breakpoint
ALTER TABLE "membership_applications" ADD COLUMN IF NOT EXISTS "nationality" text;
--> statement-breakpoint
ALTER TABLE "membership_applications" ADD COLUMN IF NOT EXISTS "phone_alt" text;
--> statement-breakpoint
ALTER TABLE "membership_applications" ADD COLUMN IF NOT EXISTS "plot_number" text;
--> statement-breakpoint
ALTER TABLE "membership_applications" ADD COLUMN IF NOT EXISTS "residency_status" "residency_status";
--> statement-breakpoint
ALTER TABLE "membership_applications" ADD COLUMN IF NOT EXISTS "residency_since" text;
--> statement-breakpoint
ALTER TABLE "membership_applications" ADD COLUMN IF NOT EXISTS "owns_property" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "membership_applications" ADD COLUMN IF NOT EXISTS "property_plots" text;
--> statement-breakpoint
ALTER TABLE "membership_applications" ADD COLUMN IF NOT EXISTS "ward_registered_voter" boolean;
--> statement-breakpoint
ALTER TABLE "membership_applications" ADD COLUMN IF NOT EXISTS "membership_category" "membership_category";
--> statement-breakpoint
ALTER TABLE "membership_applications" ADD COLUMN IF NOT EXISTS "admitted_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "membership_applications" ADD COLUMN IF NOT EXISTS "membership_number" text;
--> statement-breakpoint
ALTER TABLE "membership_applications" ADD COLUMN IF NOT EXISTS "other_association_member" boolean;
--> statement-breakpoint
ALTER TABLE "membership_applications" ADD COLUMN IF NOT EXISTS "other_association_name" text;
--> statement-breakpoint
ALTER TABLE "membership_applications" ADD COLUMN IF NOT EXISTS "subscription_vote" "subscription_vote";
--> statement-breakpoint
ALTER TABLE "membership_applications" ADD COLUMN IF NOT EXISTS "agree_to_pay_adopted" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "membership_applications" ADD COLUMN IF NOT EXISTS "relief_option" "relief_option";
--> statement-breakpoint
ALTER TABLE "membership_applications" ADD COLUMN IF NOT EXISTS "payment_method" "payment_method";
--> statement-breakpoint
ALTER TABLE "membership_applications" ADD COLUMN IF NOT EXISTS "declaration_confirm_resident" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "membership_applications" ADD COLUMN IF NOT EXISTS "declaration_read_constitution" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "membership_applications" ADD COLUMN IF NOT EXISTS "declaration_member_register" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "membership_applications" ADD COLUMN IF NOT EXISTS "declaration_voter_roll" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "membership_applications" ADD COLUMN IF NOT EXISTS "declaration_contact_consent" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "membership_applications" ADD COLUMN IF NOT EXISTS "declaration_no_subscription" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "membership_applications" ADD COLUMN IF NOT EXISTS "declaration_undertake_payment" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "membership_applications" ADD COLUMN IF NOT EXISTS "declaration_understand_relief" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "membership_applications" ADD COLUMN IF NOT EXISTS "signature_name" text;
--> statement-breakpoint
ALTER TABLE "membership_applications" ADD COLUMN IF NOT EXISTS "received_by" text;
--> statement-breakpoint
ALTER TABLE "membership_applications" ADD COLUMN IF NOT EXISTS "verified_against_nrc" boolean;
--> statement-breakpoint
ALTER TABLE "membership_applications" ADD COLUMN IF NOT EXISTS "rejection_category" "application_rejection_category";
--> statement-breakpoint
ALTER TABLE "membership_applications" ADD COLUMN IF NOT EXISTS "verification_notes" text;
--> statement-breakpoint
ALTER TABLE "membership_applications" ADD COLUMN IF NOT EXISTS "principal_residence_address" text;
--> statement-breakpoint
ALTER TABLE "membership_applications" ADD COLUMN IF NOT EXISTS "association_basis" text;
--> statement-breakpoint
ALTER TABLE "membership_applications" ADD COLUMN IF NOT EXISTS "nominated_by" text;
--> statement-breakpoint
ALTER TABLE "membership_applications" ADD COLUMN IF NOT EXISTS "occupation" text;
--> statement-breakpoint
ALTER TABLE "membership_applications" ADD COLUMN IF NOT EXISTS "willing_to_volunteer" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "membership_applications" ADD COLUMN IF NOT EXISTS "volunteer_skills" text;
--> statement-breakpoint
ALTER TABLE "membership_applications" ADD COLUMN IF NOT EXISTS "access_needs" text;
--> statement-breakpoint
ALTER TABLE "membership_applications" ADD COLUMN IF NOT EXISTS "preferred_language" "preferred_language";
--> statement-breakpoint
ALTER TABLE "membership_applications" ADD COLUMN IF NOT EXISTS "adults_in_household" integer;
--> statement-breakpoint
ALTER TABLE "membership_applications" ADD COLUMN IF NOT EXISTS "emergency_contact_name" text;
--> statement-breakpoint
ALTER TABLE "membership_applications" ADD COLUMN IF NOT EXISTS "emergency_contact_phone" text;
--> statement-breakpoint
ALTER TABLE "membership_applications" ADD COLUMN IF NOT EXISTS "emergency_contact_relationship" text;
