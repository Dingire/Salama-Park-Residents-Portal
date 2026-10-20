DO $$ BEGIN
  CREATE TYPE "finance_period_status" AS ENUM ('open', 'closed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER TYPE "association_role" ADD VALUE IF NOT EXISTS 'treasurer';
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "finance_charge_status" AS ENUM ('outstanding', 'part-paid', 'paid', 'waived');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "finance_expense_category" AS ENUM ('printing-stationery', 'venue-hire', 'utilities', 'security', 'maintenance', 'welfare', 'bank-charges', 'transport', 'other');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "finance_periods" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "year" integer NOT NULL,
  "currency" text DEFAULT 'ZMW' NOT NULL,
  "label" text,
  "amount_tier_low" integer NOT NULL,
  "amount_tier_standard" integer NOT NULL,
  "amount_tier_high" integer NOT NULL,
  "status" "finance_period_status" DEFAULT 'open' NOT NULL,
  "notes" text,
  "created_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "finance_periods_year_unique" UNIQUE("year")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "finance_charges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "period_id" uuid NOT NULL,
  "application_id" uuid NOT NULL,
  "membership_number" text,
  "member_name" text NOT NULL,
  "amount_due" integer NOT NULL,
  "amount_paid" integer DEFAULT 0 NOT NULL,
  "amount_waived" integer DEFAULT 0 NOT NULL,
  "status" "finance_charge_status" DEFAULT 'outstanding' NOT NULL,
  "due_date" text,
  "waived_reason" text,
  "last_reminder_at" timestamp with time zone,
  "reminder_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "finance_payments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "charge_id" uuid NOT NULL,
  "amount" integer NOT NULL,
  "method" "payment_method" NOT NULL,
  "reference" text,
  "paid_on" text NOT NULL,
  "received_by" text,
  "notes" text,
  "recorded_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "finance_expenses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "period_id" uuid,
  "category" "finance_expense_category" NOT NULL,
  "description" text NOT NULL,
  "amount" integer NOT NULL,
  "paid_on" text NOT NULL,
  "payee" text,
  "method" "payment_method",
  "reference" text,
  "receipt_reference" text,
  "notes" text,
  "recorded_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "finance_charges" ADD CONSTRAINT "finance_charges_period_id_finance_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."finance_periods"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "finance_charges" ADD CONSTRAINT "finance_charges_application_id_membership_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."membership_applications"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "finance_payments" ADD CONSTRAINT "finance_payments_charge_id_finance_charges_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."finance_charges"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "finance_expenses" ADD CONSTRAINT "finance_expenses_period_id_finance_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."finance_periods"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "finance_charges_period_application_idx" ON "finance_charges" USING btree ("period_id","application_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "finance_charges_status_idx" ON "finance_charges" USING btree ("period_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "finance_charges_application_idx" ON "finance_charges" USING btree ("application_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "finance_payments_charge_idx" ON "finance_payments" USING btree ("charge_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "finance_payments_paid_on_idx" ON "finance_payments" USING btree ("paid_on");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "finance_expenses_period_idx" ON "finance_expenses" USING btree ("period_id","category");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "finance_expenses_paid_on_idx" ON "finance_expenses" USING btree ("paid_on");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "finance_periods_year_idx" ON "finance_periods" USING btree ("year");
