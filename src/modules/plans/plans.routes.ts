import type { FastifyInstance } from "fastify";
import { and, asc, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client";
import { plans } from "../../db/schema";
import { requireApiKey } from "../../auth";
import { isUniqueViolation } from "./plans.service";

const MAX = 1_000_000_000_000;

const createBody = z.object({
  scope: z.enum(["account", "user"]),
  name: z.string().trim().min(1).max(100),
  monthlyAllowance: z.number().int().min(0).max(MAX),
  maxPerRequest: z.number().int().min(1).max(MAX),
});

const updateBody = createBody
  .omit({ scope: true })
  .partial()
  .refine((o) => Object.keys(o).length > 0, { message: "empty_update" });

const idParams = z.object({ id: z.guid() });

export async function planRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireApiKey);

  const visible = (accountId: string) =>
    or(isNull(plans.accountId), eq(plans.accountId, accountId));

  app.post("/plans", async (req, reply) => {
    const body = createBody.parse(req.body);
    const [plan] = await db
      .insert(plans)
      .values({ ...body, accountId: req.accountId })
      .onConflictDoNothing()
      .returning();
    if (!plan) return reply.code(409).send({ error: "plan_name_taken" });
    return reply.code(201).send({ plan });
  });

  app.get("/plans", async (req) => {
    const rows = await db
      .select()
      .from(plans)
      .where(visible(req.accountId))
      .orderBy(asc(plans.scope), asc(plans.name));
    return { plans: rows };
  });

  app.get("/plans/:id", async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const [plan] = await db
      .select()
      .from(plans)
      .where(and(eq(plans.id, id), visible(req.accountId)))
      .limit(1);
    if (!plan) return reply.code(404).send({ error: "plan_not_found" });
    return { plan };
  });

  app.patch("/plans/:id", async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const changes = updateBody.parse(req.body);

    const [existing] = await db
      .select()
      .from(plans)
      .where(and(eq(plans.id, id), visible(req.accountId)))
      .limit(1);
    if (!existing) return reply.code(404).send({ error: "plan_not_found" });
    if (existing.accountId === null) {
      return reply.code(403).send({ error: "predefined_plan_read_only" });
    }

    try {
      const [plan] = await db
        .update(plans)
        .set({ ...changes, updatedAt: new Date() })
        .where(and(eq(plans.id, id), eq(plans.accountId, req.accountId)))
        .returning();
      return { plan };
    } catch (err) {
      if (isUniqueViolation(err)) return reply.code(409).send({ error: "plan_name_taken" });
      throw err;
    }
  });
}
