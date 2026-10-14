CREATE TYPE "public"."plan_scope" AS ENUM('account', 'user');--> statement-breakpoint
CREATE TYPE "public"."rule_level" AS ENUM('account', 'user');--> statement-breakpoint
CREATE TYPE "public"."rule_type" AS ENUM('monthly_allowance', 'max_per_request');--> statement-breakpoint
CREATE TABLE "account_usage" (
	"account_id" uuid NOT NULL,
	"month" date NOT NULL,
	"used" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "account_usage_account_id_month_pk" PRIMARY KEY("account_id","month"),
	CONSTRAINT "account_usage_nonneg" CHECK ("account_usage"."used" >= 0)
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"plan_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid,
	"scope" "plan_scope" NOT NULL,
	"name" text NOT NULL,
	"monthly_allowance" bigint NOT NULL,
	"max_per_request" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_allowance_nonneg" CHECK ("plans"."monthly_allowance" >= 0),
	CONSTRAINT "plans_max_per_request_positive" CHECK ("plans"."max_per_request" > 0)
);
--> statement-breakpoint
CREATE TABLE "request_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"request_id" text NOT NULL,
	"units" bigint NOT NULL,
	"accepted" boolean NOT NULL,
	"rejected_level" "rule_level",
	"rejected_rule" "rule_type",
	"month" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_usage" (
	"user_id" uuid NOT NULL,
	"month" date NOT NULL,
	"used" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "user_usage_user_id_month_pk" PRIMARY KEY("user_id","month"),
	CONSTRAINT "user_usage_nonneg" CHECK ("user_usage"."used" >= 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"plan_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_usage" ADD CONSTRAINT "account_usage_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_log" ADD CONSTRAINT "request_log_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_log" ADD CONSTRAINT "request_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_usage" ADD CONSTRAINT "user_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "plans_predefined_name_uq" ON "plans" USING btree ("scope","name") WHERE "plans"."account_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "plans_account_name_uq" ON "plans" USING btree ("account_id","scope","name") WHERE "plans"."account_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "request_log_account_request_uq" ON "request_log" USING btree ("account_id","request_id");--> statement-breakpoint
CREATE INDEX "request_log_account_created_idx" ON "request_log" USING btree ("account_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "request_log_user_created_idx" ON "request_log" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "users_account_external_uq" ON "users" USING btree ("account_id","external_id");