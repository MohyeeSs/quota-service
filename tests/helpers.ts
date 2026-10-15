import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import type { FastifyInstance } from "fastify";

export const uid = () => randomUUID().slice(0, 8);

export const call = (
  app: FastifyInstance,
  key: string,
  method: "GET" | "POST" | "PUT" | "PATCH",
  url: string,
  payload?: object,
) => app.inject({ method, url, headers: { "x-api-key": key }, payload });

export async function newAccount(app: FastifyInstance) {
  const res = await app.inject({ method: "POST", url: "/accounts", payload: { name: "t-" + uid() } });
  expect(res.statusCode).toBe(201);
  return res.json().apiKey as string;
}

export async function newPlan(
  app: FastifyInstance, key: string, scope: "account" | "user", monthly: number, max: number,
) {
  const res = await call(app, key, "POST", "/plans", {
    scope, name: "p-" + uid(), monthlyAllowance: monthly, maxPerRequest: max,
  });
  expect(res.statusCode).toBe(201);
  return res.json().plan.id as string;
}

export async function setAccountPlan(app: FastifyInstance, key: string, planId: string) {
  expect((await call(app, key, "PUT", "/account/plan", { planId })).statusCode).toBe(200);
}

export async function newUser(app: FastifyInstance, key: string, externalId: string, planId?: string) {
  const res = await call(app, key, "POST", "/users", { externalId, ...(planId ? { planId } : {}) });
  expect(res.statusCode).toBe(201);
}

export const consumeReq = (
  app: FastifyInstance, key: string, userId: string, units: number, requestId = "r-" + uid(),
) => call(app, key, "POST", "/consume", { userId, units, requestId });
