import { db } from "./client";
import { plans } from "./schema";

export const PLAN_IDS = {
  accountStarter: "00000000-0000-0000-0000-000000000001",
  accountPro: "00000000-0000-0000-0000-000000000002",
  userBasic: "00000000-0000-0000-0000-000000000011",
  userPremium: "00000000-0000-0000-0000-000000000012",
} as const;

const predefined = [
  { id: PLAN_IDS.accountStarter, scope: "account", name: "Starter", monthlyAllowance: 10_000, maxPerRequest: 100 },
  { id: PLAN_IDS.accountPro, scope: "account", name: "Pro", monthlyAllowance: 100_000, maxPerRequest: 1_000 },
  { id: PLAN_IDS.userBasic, scope: "user", name: "Basic", monthlyAllowance: 1_000, maxPerRequest: 20 },
  { id: PLAN_IDS.userPremium, scope: "user", name: "Premium", monthlyAllowance: 10_000, maxPerRequest: 200 },
] as const;

export async function seedPlans() {
  for (const p of predefined) {
    await db
      .insert(plans)
      .values({ ...p })
      .onConflictDoUpdate({
        target: plans.id,
        set: { name: p.name, monthlyAllowance: p.monthlyAllowance, maxPerRequest: p.maxPerRequest, updatedAt: new Date() },
      });
  }
}