import { and, eq, isNull, or } from "drizzle-orm";
import { db } from "../../db/client";
import { plans } from "../../db/schema";

// خطة صالحة للتعيين: نفس النوع، وإما جاهزة (account_id null) أو تابعة لنفس الحساب
export async function findAssignablePlan(
  accountId: string,
  planId: string,
  scope: "account" | "user",
) {
  const [plan] = await db
    .select()
    .from(plans)
    .where(
      and(
        eq(plans.id, planId),
        eq(plans.scope, scope),
        or(isNull(plans.accountId), eq(plans.accountId, accountId)),
      ),
    )
    .limit(1);
  return plan ?? null;
}

export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}
