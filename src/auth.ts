import { createHash, randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "./db/client";
import { apiKeys } from "./db/schema";

declare module "fastify" {
  interface FastifyRequest {
    accountId: string;
  }
}

export const generateApiKey = () => "qk_" + randomBytes(32).toString("hex");
export const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

export async function requireApiKey(req: FastifyRequest, reply: FastifyReply) {
  const key = req.headers["x-api-key"];
  if (typeof key !== "string" || key.length === 0) {
    return reply.code(401).send({ error: "missing_api_key" });
  }
  const [row] = await db
    .select({ accountId: apiKeys.accountId })
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, hashKey(key)), isNull(apiKeys.revokedAt)))
    .limit(1);
  if (!row) return reply.code(401).send({ error: "invalid_api_key" });
  req.accountId = row.accountId;
}