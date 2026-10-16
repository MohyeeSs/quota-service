import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireApiKey } from "../../auth";
import { consume } from "./consume.service";

const body = z.object({
  userId: z.string().trim().min(1).max(200),
  units: z.number().int().positive().max(1_000_000_000_000),
  requestId: z.string().trim().min(1).max(200),
});

export async function consumeRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireApiKey);

  app.post("/consume", async (req, reply) => {
    const b = body.parse(req.body);
    const r = await consume({
      accountId: req.accountId, 
      userExternalId: b.userId,
      units: b.units,
      requestId: b.requestId,
    });

    if (r.kind === "user_not_found") return reply.code(404).send({ error: "user_not_found" });
    if (r.kind === "request_id_reused") return reply.code(409).send({ error: "request_id_reused" });

    return {
      requestId: b.requestId,
      accepted: r.accepted,
      replayed: r.replayed,
      rejection: r.rejection,
      units: r.units,
      month: r.month.slice(0, 7),
      account: r.account,
      user: r.user,
    };
  });
}
