import Fastify from "fastify";
import { ZodError } from "zod";
import { accountRoutes } from "./modules/accounts/accounts.routes";
import { currentAccountRoutes } from "./modules/accounts/current-account.routes";
import { consumeRoutes } from "./modules/consume/consume.routes";
import { usageRoutes } from "./modules/usage/usage.routes";
import { planRoutes } from "./modules/plans/plans.routes";
import { userRoutes } from "./modules/users/users.routes";

export function buildApp() {
  const app = Fastify({ logger: process.env.NODE_ENV === "test" ? false : { level: process.env.LOG_LEVEL ?? "info" } });

  app.setErrorHandler((err: unknown, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: "validation_error", details: err.issues });
    }
    const e = err as { statusCode?: number; message?: string };
    if (typeof e.statusCode === "number" && e.statusCode < 500) {
      return reply.code(e.statusCode).send({ error: e.message ?? "bad_request" });
    }
    req.log.error(err);
    return reply.code(500).send({ error: "internal_error" });
  });

  app.get("/health", async () => ({ ok: true }));
  app.register(accountRoutes);
  app.register(currentAccountRoutes);
  app.register(planRoutes);
  app.register(userRoutes);
  app.register(consumeRoutes);
  app.register(usageRoutes);

  return app;
}
