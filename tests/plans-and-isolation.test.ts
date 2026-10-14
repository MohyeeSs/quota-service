import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { pool } from "../src/db/client";

const app = buildApp();
afterAll(async () => {
  await app.close();
  await pool.end();
});

const uid = () => Math.random().toString(36).slice(2, 10);

async function createAccount() {
  const res = await app.inject({ method: "POST", url: "/accounts", payload: { name: "t-" + uid() } });
  expect(res.statusCode).toBe(201);
  return res.json().apiKey as string;
}
const call = (key: string, method: "GET" | "POST" | "PUT" | "PATCH", url: string, payload?: object) =>
  app.inject({ method, url, headers: { "x-api-key": key }, payload });

describe("api key validation", () => {
  it("rejects a missing key", async () => {
    const res = await app.inject({ method: "GET", url: "/plans" });
    expect(res.statusCode).toBe(401);
  });
  it("rejects an invalid key", async () => {
    const res = await call("qk_wrong", "GET", "/plans");
    expect(res.statusCode).toBe(401);
  });
});

describe("account isolation", () => {
  it("hides users and plans of other accounts", async () => {
    const keyA = await createAccount();
    const keyB = await createAccount();

    await call(keyA, "POST", "/users", { externalId: "alice" });
    const plan = (await call(keyA, "POST", "/plans", {
      scope: "user", name: "A-only", monthlyAllowance: 50, maxPerRequest: 5,
    })).json().plan;

    expect((await call(keyB, "GET", "/users/alice")).statusCode).toBe(404);
    expect((await call(keyB, "GET", `/plans/${plan.id}`)).statusCode).toBe(404);

    await call(keyB, "POST", "/users", { externalId: "bob" });
    const assign = await call(keyB, "PUT", "/users/bob/plan", { planId: plan.id });
    expect(assign.statusCode).toBe(400);
  });

  it("allows the same external user id in different accounts", async () => {
    const keyA = await createAccount();
    const keyB = await createAccount();
    expect((await call(keyA, "POST", "/users", { externalId: "same" })).statusCode).toBe(201);
    expect((await call(keyB, "POST", "/users", { externalId: "same" })).statusCode).toBe(201);
  });
});

describe("plans", () => {
  it("keeps predefined plans read-only", async () => {
    const key = await createAccount();
    const list = (await call(key, "GET", "/plans")).json().plans as { id: string; name: string }[];
    const basic = list.find((p) => p.name === "Basic")!;
    const res = await call(key, "PATCH", `/plans/${basic.id}`, { monthlyAllowance: 999999 });
    expect(res.statusCode).toBe(403);
  });

  it("creates, assigns and updates a custom plan shared by two users", async () => {
    const key = await createAccount();
    const plan = (await call(key, "POST", "/plans", {
      scope: "user", name: "Team", monthlyAllowance: 500, maxPerRequest: 50,
    })).json().plan;

    await call(key, "POST", "/users", { externalId: "u1", planId: plan.id });
    await call(key, "POST", "/users", { externalId: "u2", planId: plan.id });

    await call(key, "PATCH", `/plans/${plan.id}`, { monthlyAllowance: 800 });
    const u2 = (await call(key, "GET", "/users/u2")).json();
    expect(u2.plan.monthlyAllowance).toBe(800);
  });

  it("rejects a plan with the wrong scope", async () => {
    const key = await createAccount();
    const list = (await call(key, "GET", "/plans")).json().plans as { id: string; name: string }[];
    const starter = list.find((p) => p.name === "Starter")!;
    const res = await call(key, "POST", "/users", { externalId: "x", planId: starter.id });
    expect(res.statusCode).toBe(400);
  });

  it("rejects invalid limits", async () => {
    const key = await createAccount();
    const res = await call(key, "POST", "/plans", {
      scope: "user", name: "bad", monthlyAllowance: -1, maxPerRequest: 0,
    });
    expect(res.statusCode).toBe(400);
  });
});
