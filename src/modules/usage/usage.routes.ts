import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client";
import { requireApiKey } from "../../auth";
import { monthStart } from "../consume/consume.service";
import { remaining } from "../consume/rules";

const monthParam = z.string().regex(/^(19|20)\d{2}-(0[1-9]|1[0-2])$/);

const usageQuery = z.object({ month: monthParam.optional() });
const historyQuery = z.object({
  month: monthParam.optional(),
  userId: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

type PlanFields = {
  plan_id: string;
  plan_name: string;
  monthly_allowance: string;
  max_per_request: string;
  used: string;
};

// الحدود المعروضة هي الخطط المطبّقة حالياً، والمتبقي بيتحسب عليها
const shape = (r: PlanFields) => {
  const snapshot = {
    monthlyAllowance: Number(r.monthly_allowance),
    maxPerRequest: Number(r.max_per_request),
    used: Number(r.used),
  };
  return {
    plan: {
      id: r.plan_id,
      name: r.plan_name,
      monthlyAllowance: snapshot.monthlyAllowance,
      maxPerRequest: snapshot.maxPerRequest,
    },
    used: snapshot.used,
    remaining: remaining(snapshot),
  };
};

type HistoryRow = {
  request_id: string;
  external_id: string;
  units: string;
  accepted: boolean;
  rejected_level: string | null;
  rejected_rule: string | null;
  month: string;
  created_at: Date;
};

export async function usageRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireApiKey);

  app.get("/usage", async (req) => {
    const q = usageQuery.parse(req.query);
    const month = q.month ? `${q.month}-01` : monthStart(new Date());

    const acc = (
      await db.execute<PlanFields & { id: string; name: string }>(sql`
        SELECT a.id, a.name, p.id AS plan_id, p.name AS plan_name,
               p.monthly_allowance, p.max_per_request, COALESCE(au.used, 0) AS used
        FROM accounts a
        JOIN plans p ON p.id = a.plan_id
        LEFT JOIN account_usage au ON au.account_id = a.id AND au.month = ${month}::date
        WHERE a.id = ${req.accountId}`)
    ).rows[0];

    const users = await db.execute<PlanFields & { external_id: string }>(sql`
      SELECT u.external_id, p.id AS plan_id, p.name AS plan_name,
             p.monthly_allowance, p.max_per_request, COALESCE(uu.used, 0) AS used
      FROM users u
      JOIN plans p ON p.id = u.plan_id
      LEFT JOIN user_usage uu ON uu.user_id = u.id AND uu.month = ${month}::date
      WHERE u.account_id = ${req.accountId}
      ORDER BY u.external_id`);

    return {
      month: month.slice(0, 7),
      account: { id: acc.id, name: acc.name, ...shape(acc) },
      users: users.rows.map((u) => ({ userId: u.external_id, ...shape(u) })),
    };
  });

  app.get("/history", async (req) => {
    const q = historyQuery.parse(req.query);
    const month = q.month ? `${q.month}-01` : null;

    // نجيب limit+1 لنعرف إذا في صفحة تالية
    const rows = (
      await db.execute<HistoryRow>(sql`
        SELECT l.request_id, u.external_id, l.units, l.accepted,
               l.rejected_level, l.rejected_rule, l.month::text AS month, l.created_at
        FROM request_log l
        JOIN users u ON u.id = l.user_id
        WHERE l.account_id = ${req.accountId}
        ${month ? sql`AND l.month = ${month}::date` : sql``}
        ${q.userId ? sql`AND u.external_id = ${q.userId}` : sql``}
        ORDER BY l.created_at DESC, l.id DESC
        LIMIT ${q.limit + 1} OFFSET ${q.offset}`)
    ).rows;

    const hasMore = rows.length > q.limit;
    return {
      items: rows.slice(0, q.limit).map((r) => ({
        requestId: r.request_id,
        userId: r.external_id,
        units: Number(r.units),
        accepted: r.accepted,
        rejection:
          r.rejected_level && r.rejected_rule ? { level: r.rejected_level, rule: r.rejected_rule } : null,
        month: r.month.slice(0, 7),
        createdAt: r.created_at,
      })),
      limit: q.limit,
      offset: q.offset,
      hasMore,
      nextOffset: hasMore ? q.offset + q.limit : null,
    };
  });
}
