import { describe, expect, it } from "vitest";
import { evaluate } from "../src/modules/consume/rules";

const snap = (monthlyAllowance: number, maxPerRequest: number, used = 0) => ({
  monthlyAllowance, maxPerRequest, used,
});

describe("rules", () => {
  it("accepts when every rule passes, including exactly the remaining amount", () => {
    expect(evaluate(10, { account: snap(100, 50, 90), user: snap(100, 50, 90) })).toBeNull();
  });
  it("reports the user per-request rule first when several are violated", () => {
    const r = evaluate(25, { account: snap(5, 10), user: snap(1000, 20) });
    expect(r).toEqual({ level: "user", rule: "max_per_request" });
  });
  it("rejects at the account level when only the account is short", () => {
    const r = evaluate(10, { account: snap(5, 100), user: snap(1000, 20) });
    expect(r).toEqual({ level: "account", rule: "monthly_allowance" });
  });
  it("treats an allowance reduced below usage as zero remaining", () => {
    const r = evaluate(1, { account: snap(100, 10), user: snap(50, 10, 80) });
    expect(r).toEqual({ level: "user", rule: "monthly_allowance" });
  });
});
