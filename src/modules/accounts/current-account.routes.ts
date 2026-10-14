import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client";
import { accounts, plans } from "../../db/schema";
import { requireApiKey } from "../../auth";
import { findAssignablePlan } from "../plans/plans.service";

const body = z.object({ planId: z.guid() });

export async function currentAccountRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireApiKey);

  const load = async (accountId: string) => {
    const [row] = await db
      .select({ account: accounts, plan: plans })
      .from(accounts)
      .innerJoin(plans, eq(accounts.planId, plans.id))
      .where(eq(accounts.id, accountId))
      .limit(1);
    return row;
  };

  app.get("/account", async (req) => load(req.accountId));

  app.put("/account/plan", async (req, reply) => {
    const { planId } = body.parse(req.body);
    const plan = await findAssignablePlan(req.accountId, planId, "account");
    if (!plan) return reply.code(400).send({ error: "invalid_plan" });
    await db.update(accounts).set({ planId }).where(eq(accounts.id, req.accountId));
    return load(req.accountId);
  });
}
