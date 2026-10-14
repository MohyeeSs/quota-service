import { sql } from "drizzle-orm";
import {
  type AnyPgColumn, bigint, boolean, check, date, index, pgEnum, pgTable,
  primaryKey, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";

export const planScope = pgEnum("plan_scope", ["account", "user"]);
export const ruleLevel = pgEnum("rule_level", ["account", "user"]);
export const ruleType = pgEnum("rule_type", ["monthly_allowance", "max_per_request"]);

// account_id = NULL يعني خطة جاهزة (predefined) ومشتركة للكل
export const plans = pgTable(
  "plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id").references((): AnyPgColumn => accounts.id, { onDelete: "cascade" }),
    scope: planScope("scope").notNull(),
    name: text("name").notNull(),
    monthlyAllowance: bigint("monthly_allowance", { mode: "number" }).notNull(),
    maxPerRequest: bigint("max_per_request", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("plans_predefined_name_uq").on(t.scope, t.name).where(sql`${t.accountId} is null`),
    uniqueIndex("plans_account_name_uq").on(t.accountId, t.scope, t.name).where(sql`${t.accountId} is not null`),
    check("plans_allowance_nonneg", sql`${t.monthlyAllowance} >= 0`),
    check("plans_max_per_request_positive", sql`${t.maxPerRequest} > 0`),
  ],
);

export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  planId: uuid("plan_id").notNull().references(() => plans.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  keyHash: text("key_hash").notNull().unique(),
  keyPrefix: text("key_prefix").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

// externalId = معرّف المستخدم عند التطبيق المستدعي
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    planId: uuid("plan_id").notNull().references(() => plans.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_account_external_uq").on(t.accountId, t.externalId)],
);

// month = أول يوم من الشهر بتوقيت UTC (مثلاً 2026-10-01)
export const accountUsage = pgTable(
  "account_usage",
  {
    accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    month: date("month").notNull(),
    used: bigint("used", { mode: "number" }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.month] }), check("account_usage_nonneg", sql`${t.used} >= 0`)],
);

export const userUsage = pgTable(
  "user_usage",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    month: date("month").notNull(),
    used: bigint("used", { mode: "number" }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.month] }), check("user_usage_nonneg", sql`${t.used} >= 0`)],
);

export const requestLog = pgTable(
  "request_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id").notNull().references(() => accounts.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    requestId: text("request_id").notNull(),
    units: bigint("units", { mode: "number" }).notNull(),
    accepted: boolean("accepted").notNull(),
    rejectedLevel: ruleLevel("rejected_level"),
    rejectedRule: ruleType("rejected_rule"),
    month: date("month").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("request_log_account_request_uq").on(t.accountId, t.requestId),
    index("request_log_account_created_idx").on(t.accountId, t.createdAt.desc()),
    index("request_log_user_created_idx").on(t.userId, t.createdAt.desc()),
  ],
);