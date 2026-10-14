import type { FastifyInstance } from "fastify";
import { and, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client";
import { plans, users } from "../../db/schema";
import { PLAN_IDS } from "../../db/seed";
import { requireApiKey } from "../../auth";

const body = z.object({
  externalId: z.string().trim().min(1).max(200),
  planId: z.guid().optional(),
});

export async function userRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireApiKey);

  app.post("/users", async (req, reply) => {
    const { externalId, planId = PLAN_IDS.userBasic } = body.parse(req.body);

    // الخطة لازم تكون للمستخدمين، وإما جاهزة أو تابعة لنفس الحساب
    const [plan] = await db
      .select({ id: plans.id })
      .from(plans)
      .where(
        and(
          eq(plans.id, planId),
          eq(plans.scope, "user"),
          or(isNull(plans.accountId), eq(plans.accountId, req.accountId)),
        ),
      )
      .limit(1);
    if (!plan) return reply.code(400).send({ error: "invalid_plan" });

    const [user] = await db
      .insert(users)
      .values({ accountId: req.accountId, externalId, planId })
      .onConflictDoNothing({ target: [users.accountId, users.externalId] })
      .returning();
    if (!user) return reply.code(409).send({ error: "user_already_exists" });

    return reply.code(201).send({ user });
  });

  app.get("/users/:externalId", async (req, reply) => {
    const { externalId } = req.params as { externalId: string };
    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(users.accountId, req.accountId), eq(users.externalId, externalId)))
      .limit(1);
    if (!user) return reply.code(404).send({ error: "user_not_found" });
    return { user };
  });
}