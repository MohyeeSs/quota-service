import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { pool } from "../src/db/client";
import { PLAN_IDS } from "../src/db/seed";
import { consume } from "../src/modules/consume/consume.service";
import { call, consumeReq, newAccount, newUser } from "./helpers";

const app = buildApp();
afterAll(async () => {
  await app.close();
  await pool.end();
});

type UsageUser = { userId: string; used: number; remaining: number };
type Item = { requestId: string; userId: string; accepted: boolean; rejection: { level: string; rule: string } | null };

describe("usage", () => {
  it("reports consumed and remaining for the account and every user", async () => {
    const key = await newAccount(app);
    await newUser(app, key, "alice");
    await newUser(app, key, "bob", PLAN_IDS.userPremium);
    await consumeReq(app, key, "alice", 10);

    const body = (await call(app, key, "GET", "/usage")).json();
    expect(body.account).toMatchObject({ used: 10, remaining: 9990 });
    const byId = Object.fromEntries(body.users.map((u: UsageUser) => [u.userId, u]));
    expect(byId.alice).toMatchObject({ used: 10, remaining: 990 });
    expect(byId.bob).toMatchObject({ used: 0, remaining: 10000 });
  });

  it("keeps previous months queryable and starts the current month at zero", async () => {
    const key = await newAccount(app);
    await newUser(app, key, "alice");
    const accountId = (await call(app, key, "GET", "/account")).json().account.id as string;
    await consume(
      { accountId, userExternalId: "alice", units: 10, requestId: "old" },
      new Date("2025-01-15T12:00:00Z"),
    );

    const jan = (await call(app, key, "GET", "/usage?month=2025-01")).json();
    expect(jan.month).toBe("2025-01");
    expect(jan.account.used).toBe(10);
    expect((await call(app, key, "GET", "/usage")).json().account.used).toBe(0);
    expect((await call(app, key, "GET", "/history?month=2025-01")).json().items).toHaveLength(1);
  });

  it("rejects a malformed month", async () => {
    const key = await newAccount(app);
    expect((await call(app, key, "GET", "/usage?month=2026-13")).statusCode).toBe(400);
    expect((await call(app, key, "GET", "/history?month=abc")).statusCode).toBe(400);
  });
});

describe("history", () => {
  it("paginates newest first", async () => {
    const key = await newAccount(app);
    await newUser(app, key, "alice");
    for (let i = 1; i <= 5; i++) await consumeReq(app, key, "alice", 1, "r" + i);

    const p1 = (await call(app, key, "GET", "/history?limit=2")).json();
    expect(p1.items.map((i: Item) => i.requestId)).toEqual(["r5", "r4"]);
    expect(p1).toMatchObject({ hasMore: true, nextOffset: 2 });

    const p3 = (await call(app, key, "GET", "/history?limit=2&offset=4")).json();
    expect(p3.items.map((i: Item) => i.requestId)).toEqual(["r1"]);
    expect(p3).toMatchObject({ hasMore: false, nextOffset: null });
  });

  it("records rejections with their reason and filters by user", async () => {
    const key = await newAccount(app);
    await newUser(app, key, "alice");
    await newUser(app, key, "bob");
    await consumeReq(app, key, "alice", 25, "too-big");
    await consumeReq(app, key, "bob", 5, "ok");

    const all = (await call(app, key, "GET", "/history")).json().items as Item[];
    expect(all.find((i) => i.requestId === "too-big")).toMatchObject({
      accepted: false,
      rejection: { level: "user", rule: "max_per_request" },
    });
    const onlyBob = (await call(app, key, "GET", "/history?userId=bob")).json().items as Item[];
    expect(onlyBob.map((i) => i.userId)).toEqual(["bob"]);
  });

  it("never shows another account's history or users", async () => {
    const keyA = await newAccount(app);
    const keyB = await newAccount(app);
    await newUser(app, keyA, "alice");
    await consumeReq(app, keyA, "alice", 5);
    expect((await call(app, keyB, "GET", "/history")).json().items).toHaveLength(0);
    expect((await call(app, keyB, "GET", "/usage")).json().users).toHaveLength(0);
  });
});
