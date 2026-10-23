export type Level = "account" | "user";
export type RuleName = "monthly_allowance" | "max_per_request";

export type Snapshot = { monthlyAllowance: number; maxPerRequest: number; used: number };
export type Rejection = { level: Level; rule: RuleName };
type Context = { account: Snapshot; user: Snapshot };
type Check = (units: number, ctx: Context) => Rejection | null;

export const remaining = (s: Snapshot) => Math.max(0, s.monthlyAllowance - s.used);

function maxPerRequest(level: Level): Check {
  return function (units, ctx) {
    const limit = ctx[level].maxPerRequest;

    if (units > limit) {
      return {
        level: level,
        rule: "max_per_request",
      };
    }

    return null;
  };
}

function monthlyAllowance(level: Level): Check {
  return function (units, ctx) {
    const limit = remaining(ctx[level]);

    if (units > limit) {
      return {
        level: level,
        rule: "monthly_allowance",
      };
    }

    return null;
  };
}

export const checks: Check[] = [
  maxPerRequest("user"),
  maxPerRequest("account"),
  monthlyAllowance("user"),
  monthlyAllowance("account"),
];

export function evaluate(units: number, ctx: Context): Rejection | null {
  for (const check of checks) {
    const rejection = check(units, ctx);
    if (rejection) return rejection;
  }
  return null;
}
