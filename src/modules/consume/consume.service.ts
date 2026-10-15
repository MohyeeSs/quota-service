import { sql } from "drizzle-orm";
import { db } from "../../db/client";
import { evaluate, remaining, type Level, type Rejection, type RuleName, type Snapshot } from "./rules";

export type ConsumeInput = {
  accountId: string;
  userExternalId: string;
  units: number;
  requestId: string;
};

export type Balance = Snapshot & { remaining: number };

export type ConsumeResult =
  | { kind: "user_not_found" }
  | { kind: "request_id_reused" }
  | {
      kind: "decided";
      replayed: boolean;
      accepted: boolean;
      rejection: Rejection | null;
      units: number;
      month: string;
      account: Balance;
      user: Balance;
    };

type UsedRow = { used: string };
type PrevRow = {
  user_id: string;
  units: string;
  accepted: boolean;
  rejected_level: Level | null;
  rejected_rule: RuleName | null;
};
type LimitsRow = { a_month: string; a_max: string; u_month: string; u_max: string };

const balance = (s: Snapshot): Balance => ({ ...s, remaining: remaining(s) });

export const monthStart = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;

export async function consume(input: ConsumeInput, now: Date = new Date()): Promise<ConsumeResult> {
  const { accountId, userExternalId, units, requestId } = input;
  const month = monthStart(now);

  return db.transaction(async (tx): Promise<ConsumeResult> => {
    const found = await tx.execute<{ id: string }>(
      sql`SELECT id FROM users WHERE account_id = ${accountId} AND external_id = ${userExternalId}`,
    );
    const userId = found.rows[0]?.id;
    if (!userId) return { kind: "user_not_found" };

    // ترتيب الأقفال ثابت دايماً: صف الحساب ثم صف المستخدم (بيمنع deadlock).
    // الـ upsert "الفارغ" بينشئ الصف إذا مش موجود، وبيقفله، وبيرجّع القيمة، بطلب واحد.
    const acc = await tx.execute<UsedRow>(sql`
      INSERT INTO account_usage (account_id, month, used)
      VALUES (${accountId}, ${month}::date, 0)
      ON CONFLICT (account_id, month) DO UPDATE SET used = account_usage.used
      RETURNING used`);
    const usr = await tx.execute<UsedRow>(sql`
      INSERT INTO user_usage (user_id, month, used)
      VALUES (${userId}, ${month}::date, 0)
      ON CONFLICT (user_id, month) DO UPDATE SET used = user_usage.used
      RETURNING used`);

    const prev = await tx.execute<PrevRow>(sql`
      SELECT user_id, units, accepted, rejected_level, rejected_rule
      FROM request_log
      WHERE account_id = ${accountId} AND request_id = ${requestId}`);

    const lim = (
      await tx.execute<LimitsRow>(sql`
        SELECT ap.monthly_allowance AS a_month, ap.max_per_request AS a_max,
               up.monthly_allowance AS u_month, up.max_per_request AS u_max
        FROM accounts a
        JOIN plans ap ON ap.id = a.plan_id
        JOIN users u  ON u.id = ${userId}
        JOIN plans up ON up.id = u.plan_id
        WHERE a.id = ${accountId}`)
    ).rows[0];

    const account: Snapshot = {
      monthlyAllowance: Number(lim.a_month),
      maxPerRequest: Number(lim.a_max),
      used: Number(acc.rows[0].used),
    };
    const user: Snapshot = {
      monthlyAllowance: Number(lim.u_month),
      maxPerRequest: Number(lim.u_max),
      used: Number(usr.rows[0].used),
    };

    const old = prev.rows[0];
    if (old) {
      if (old.user_id !== userId || Number(old.units) !== units) return { kind: "request_id_reused" };
      return {
        kind: "decided",
        replayed: true,
        accepted: old.accepted,
        rejection:
          old.rejected_level && old.rejected_rule
            ? { level: old.rejected_level, rule: old.rejected_rule }
            : null,
        units,
        month,
        account: balance(account),
        user: balance(user),
      };
    }

    const rejection = evaluate(units, { account, user });

    if (!rejection) {
      await tx.execute(sql`
        UPDATE account_usage SET used = used + ${units}
        WHERE account_id = ${accountId} AND month = ${month}::date`);
      await tx.execute(sql`
        UPDATE user_usage SET used = used + ${units}
        WHERE user_id = ${userId} AND month = ${month}::date`);
      account.used += units;
      user.used += units;
    }

    await tx.execute(sql`
      INSERT INTO request_log
        (account_id, user_id, request_id, units, accepted, rejected_level, rejected_rule, month)
      VALUES
        (${accountId}, ${userId}, ${requestId}, ${units}, ${!rejection},
         ${rejection?.level ?? null}, ${rejection?.rule ?? null}, ${month}::date)`);

    return {
      kind: "decided",
      replayed: false,
      accepted: !rejection,
      rejection,
      units,
      month,
      account: balance(account),
      user: balance(user),
    };
  });
}
