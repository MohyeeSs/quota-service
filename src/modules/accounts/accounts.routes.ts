import type { FastifyInstance } from "fastify";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client";
import { accounts, apiKeys, plans } from "../../db/schema";
import { PLAN_IDS } from "../../db/seed";
import { generateApiKey, hashKey } from "../../auth";

const body = z.object({
  name: z.string().trim().min(1).max(100),
  planId: z.guid().optional(),
});

export async function accountRoutes(app: FastifyInstance) {
  app.post("/accounts", async (req, reply) => {
    const { name, planId = PLAN_IDS.accountStarter } = body.parse(req.body);

    const [plan] = await db
      .select({ id: plans.id })
      .from(plans)
      .where(and(eq(plans.id, planId), eq(plans.scope, "account"), isNull(plans.accountId)))
      .limit(1);
    if (!plan) return reply.code(400).send({ error: "invalid_plan" });

    const apiKey = generateApiKey();
    const account = await db.transaction(async (tx) => {
      const [acc] = await tx.insert(accounts).values({ name, planId }).returning();
      await tx.insert(apiKeys).values({
        accountId: acc.id,
        keyHash: hashKey(apiKey),
        keyPrefix: apiKey.slice(0, 11),
      });
      return acc;
    });

    return reply.code(201).send({ account, apiKey });
  });
}
