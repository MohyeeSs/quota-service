import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client";
import { plans, users } from "../../db/schema";
import { PLAN_IDS } from "../../db/seed";
import { requireApiKey } from "../../auth";
import { findAssignablePlan } from "../plans/plans.service";

const createBody = z.object({
  externalId: z.string().trim().min(1).max(200),
  planId: z.guid().optional(),
});
const planBody = z.object({ planId: z.guid() });
const params = z.object({ externalId: z.string().trim().min(1).max(200) });

export async function userRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireApiKey);

  // الـ accountId دايماً من المفتاح، مش من الطلب
  const load = async (accountId: string, externalId: string) => {
    const [row] = await db
      .select({ user: users, plan: plans })
      .from(users)
      .innerJoin(plans, eq(users.planId, plans.id))
      .where(and(eq(users.accountId, accountId), eq(users.externalId, externalId)))
      .limit(1);
    return row;
  };

  app.post("/users", async (req, reply) => {
    const { externalId, planId = PLAN_IDS.userBasic } = createBody.parse(req.body);

    const plan = await findAssignablePlan(req.accountId, planId, "user");
    if (!plan) return reply.code(400).send({ error: "invalid_plan" });

    const [user] = await db
      .insert(users)
      .values({ accountId: req.accountId, externalId, planId })
      .onConflictDoNothing({ target: [users.accountId, users.externalId] })
      .returning();
    if (!user) return reply.code(409).send({ error: "user_already_exists" });

    return reply.code(201).send({ user, plan });
  });

  app.get("/users/:externalId", async (req, reply) => {
    const { externalId } = params.parse(req.params);
    const row = await load(req.accountId, externalId);
    if (!row) return reply.code(404).send({ error: "user_not_found" });
    return row;
  });

  app.put("/users/:externalId/plan", async (req, reply) => {
    const { externalId } = params.parse(req.params);
    const { planId } = planBody.parse(req.body);

    const existing = await load(req.accountId, externalId);
    if (!existing) return reply.code(404).send({ error: "user_not_found" });

    const plan = await findAssignablePlan(req.accountId, planId, "user");
    if (!plan) return reply.code(400).send({ error: "invalid_plan" });

    await db
      .update(users)
      .set({ planId })
      .where(and(eq(users.accountId, req.accountId), eq(users.externalId, externalId)));
    return load(req.accountId, externalId);
  });
}
