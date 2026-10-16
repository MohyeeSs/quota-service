import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { pool } from "../src/db/client";
import { PLAN_IDS } from "../src/db/seed";
import { consume } from "../src/modules/consume/consume.service";
import { call, consumeReq, newAccount, newPlan, newUser, setAccountPlan } from "./helpers";

const app = buildApp();
afterAll(async () => {
  await app.close();
  await pool.end();
});

async function ledger(key: string) {
  const accountId = (await call(app, key, "GET", "/account")).json().account.id as string;
  const sum = async (text: string) => Number((await pool.query(text, [accountId])).rows[0].s);
  return {
    account: await sum("select coalesce(sum(used),0) s from account_usage where account_id=$1"),
    users: await sum(
      "select coalesce(sum(used),0) s from user_usage where user_id in (select id from users where account_id=$1)",
    ),
    accepted: await sum("select coalesce(sum(units),0) s from request_log where account_id=$1 and accepted"),
  };
}

describe("decisions", () => {
  it("accepts and counts usage at both levels", async () => {
    const key = await newAccount(app);
    await newUser(app, key, "alice");
    const body = (await consumeReq(app, key, "alice", 10)).json();
    expect(body.accepted).toBe(true);
    expect(body.user).toMatchObject({ used: 10, remaining: 990 });
    expect(body.account).toMatchObject({ used: 10, remaining: 9990 });
  });

  it("rejects 25 units by the user per-request limit and consumes nothing", async () => {
    const key = await newAccount(app);
    await newUser(app, key, "alice");
    const res = await consumeReq(app, key, "alice", 25);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.accepted).toBe(false);
    expect(body.rejection).toEqual({ level: "user", rule: "max_per_request" });
    expect(body.user.used).toBe(0);
    expect(body.account.used).toBe(0);
  });

  it("rejects by the shared account allowance even if the user has plenty", async () => {
    const key = await newAccount(app);
    await setAccountPlan(app, key, await newPlan(app, key, "account", 5, 100));
    await newUser(app, key, "bob", PLAN_IDS.userPremium);
    const body = (await consumeReq(app, key, "bob", 10)).json();
    expect(body.rejection).toEqual({ level: "account", rule: "monthly_allowance" });
    expect(body.user.remaining).toBe(10000);
  });

  it("rejects by the account per-request limit", async () => {
    const key = await newAccount(app);
    await setAccountPlan(app, key, await newPlan(app, key, "account", 1000, 10));
    await newUser(app, key, "bob", PLAN_IDS.userPremium);
    const body = (await consumeReq(app, key, "bob", 15)).json();
    expect(body.rejection).toEqual({ level: "account", rule: "max_per_request" });
  });

  it("rejects by the user monthly allowance, then accepts what remains", async () => {
    const key = await newAccount(app);
    await newUser(app, key, "carol", await newPlan(app, key, "user", 15, 20));
    expect((await consumeReq(app, key, "carol", 10)).json().accepted).toBe(true);
    const r = (await consumeReq(app, key, "carol", 10)).json();
    expect(r.rejection).toEqual({ level: "user", rule: "monthly_allowance" });
    expect(r.user.remaining).toBe(5);
    expect((await consumeReq(app, key, "carol", 5)).json().accepted).toBe(true);
  });
});

describe("idempotency", () => {
  it("replays an accepted request without consuming twice", async () => {
    const key = await newAccount(app);
    await newUser(app, key, "alice");
    const first = (await consumeReq(app, key, "alice", 10, "req-1")).json();
    const second = (await consumeReq(app, key, "alice", 10, "req-1")).json();
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.accepted).toBe(true);
    expect(second.user.used).toBe(10);
  });

  it("replays a rejection with the same reason", async () => {
    const key = await newAccount(app);
    await newUser(app, key, "alice");
    await consumeReq(app, key, "alice", 25, "req-1");
    const second = (await consumeReq(app, key, "alice", 25, "req-1")).json();
    expect(second.replayed).toBe(true);
    expect(second.rejection).toEqual({ level: "user", rule: "max_per_request" });
  });

  it("returns 409 when a requestId is reused for a different request", async () => {
    const key = await newAccount(app);
    await newUser(app, key, "alice");
    await consumeReq(app, key, "alice", 10, "req-1");
    expect((await consumeReq(app, key, "alice", 11, "req-1")).statusCode).toBe(409);
  });

  it("consumes once when the same request arrives 20 times at once", async () => {
    const key = await newAccount(app);
    await newUser(app, key, "alice");
    const bodies = (
      await Promise.all(Array.from({ length: 20 }, () => consumeReq(app, key, "alice", 10, "same")))
    ).map((r) => r.json());
    expect(bodies.filter((b) => !b.replayed)).toHaveLength(1);
    expect(bodies.every((b) => b.accepted)).toBe(true);
    expect(await ledger(key)).toEqual({ account: 10, users: 10, accepted: 10 });
  });
});

describe("plan changes", () => {
  it("shows zero remaining when the allowance drops below usage, and recovers when raised", async () => {
    const key = await newAccount(app);
    const plan = await newPlan(app, key, "user", 100, 100);
    await newUser(app, key, "erin", plan);
    await consumeReq(app, key, "erin", 80);
    await call(app, key, "PATCH", `/plans/${plan}`, { monthlyAllowance: 50 });
    const r = (await consumeReq(app, key, "erin", 1)).json();
    expect(r.accepted).toBe(false);
    expect(r.user).toMatchObject({ used: 80, remaining: 0 });
    await call(app, key, "PATCH", `/plans/${plan}`, { monthlyAllowance: 200 });
    expect((await consumeReq(app, key, "erin", 1)).json().accepted).toBe(true);
  });

  it("keeps consumed units when a user switches plan", async () => {
    const key = await newAccount(app);
    await newUser(app, key, "frank");
    await consumeReq(app, key, "frank", 10);
    await call(app, key, "PUT", "/users/frank/plan", { planId: PLAN_IDS.userPremium });
    const body = (await consumeReq(app, key, "frank", 10)).json();
    expect(body.user).toMatchObject({ used: 20, remaining: 9980 });
  });
});

describe("months", () => {
  it("starts each UTC month at zero and keeps the previous month", async () => {
    const key = await newAccount(app);
    await newUser(app, key, "dave");
    const accountId = (await call(app, key, "GET", "/account")).json().account.id as string;
    const run = async (requestId: string, at: string) => {
      const r = await consume({ accountId, userExternalId: "dave", units: 10, requestId }, new Date(at));
      if (r.kind !== "decided") throw new Error(r.kind);
      return r;
    };
    expect((await run("a", "2026-09-30T23:59:59Z")).user.used).toBe(10);
    const october = await run("b", "2026-10-01T00:00:00Z");
    expect(october.month).toBe("2026-10-01");
    expect(october.user.used).toBe(10);
    expect((await run("c", "2026-09-30T12:00:00Z")).user.used).toBe(20);
  });
});

describe("concurrency", () => {
  it("never exceeds the shared account allowance", async () => {
    const key = await newAccount(app);
    await setAccountPlan(app, key, await newPlan(app, key, "account", 100, 100));
    const users = ["u1", "u2", "u3", "u4", "u5"];
    for (const u of users) await newUser(app, key, u, PLAN_IDS.userPremium);
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) => consumeReq(app, key, users[i % 5], 5)),
    );
    expect(results.filter((r) => r.json().accepted)).toHaveLength(20);
    expect(await ledger(key)).toEqual({ account: 100, users: 100, accepted: 100 });
  });

  it("never exceeds a single user's allowance", async () => {
    const key = await newAccount(app);
    await newUser(app, key, "solo"); // Basic: 1000 شهرياً، 20 للطلب
    const results = await Promise.all(
      Array.from({ length: 100 }, () => consumeReq(app, key, "solo", 20)),
    );
    expect(results.filter((r) => r.json().accepted)).toHaveLength(50);
    expect(await ledger(key)).toEqual({ account: 1000, users: 1000, accepted: 1000 });
  });
});

describe("validation and isolation", () => {
  it("requires an API key", async () => {
    const res = await app.inject({
      method: "POST", url: "/consume", payload: { userId: "a", units: 1, requestId: "x" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 404 for an unknown user and for another account's user", async () => {
    const keyA = await newAccount(app);
    const keyB = await newAccount(app);
    await newUser(app, keyA, "alice");
    expect((await consumeReq(app, keyA, "nobody", 1)).statusCode).toBe(404);
    expect((await consumeReq(app, keyB, "alice", 1)).statusCode).toBe(404);
  });

  it.each([{ units: 0 }, { units: -5 }, { units: 1.5 }, { units: "10" }, { requestId: "" }, { userId: "" }])(
    "rejects an invalid body %o with 400",
    async (bad) => {
      const key = await newAccount(app);
      await newUser(app, key, "alice");
      const res = await call(app, key, "POST", "/consume", {
        userId: "alice", units: 10, requestId: "x", ...bad,
      });
      expect(res.statusCode).toBe(400);
    },
  );
});
