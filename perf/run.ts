import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const DURATION = Number(process.env.DURATION ?? 10);
const CONNECTIONS = Number(process.env.CONNECTIONS ?? 50);
const LABEL = process.argv[2] ?? "run";
const BIG = 1_000_000_000;
const tag = Date.now().toString(36);

type Json = Record<string, any>;

async function must(method: string, path: string, key?: string, body?: object): Promise<Json> {
  const headers: Record<string, string> = {};
  if (key) headers["x-api-key"] = key;
  if (body) headers["content-type"] = "application/json";
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const json = (await res.json()) as Json;
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json)}`);
  return json;
}

async function setupAccount(label: string, allowance: number, userCount: number, maxPerRequest = 100) {
  const created = await must("POST", "/accounts", undefined, { name: `perf-${label}-${tag}` });
  const key = created.apiKey as string;
  const accountPlan = await must("POST", "/plans", key, {
    scope: "account", name: "perf-account", monthlyAllowance: allowance, maxPerRequest,
  });
  await must("PUT", "/account/plan", key, { planId: accountPlan.plan.id });
  const userPlan = await must("POST", "/plans", key, {
    scope: "user", name: "perf-user", monthlyAllowance: BIG, maxPerRequest,
  });
  const users: string[] = [];
  for (let i = 0; i < userCount; i++) {
    const externalId = `u${i}`;
    await must("POST", "/users", key, { externalId, planId: userPlan.plan.id });
    users.push(externalId);
  }
  return { key, users };
}
type Account = Awaited<ReturnType<typeof setupAccount>>;
type Target = { key: string; userId: string };
const targetsOf = (a: Account): Target[] => a.users.map((userId) => ({ key: a.key, userId }));

// N عمّال متزامنين، كل واحد بيبعت طلب ويستنى رده. عند انتهاء المدة بنستنى الطلبات اللي بالطريق،
// فكل طلب انبعت انحسب، وهاد بيخلي فحص الصحة دقيق (مش تقريبي).
async function load(targets: Target[], units: number, connections: number, seconds: number, fixedRequestId?: string) {
  const latencies: number[] = [];
  let accepted = 0;
  let rejected = 0;
  let failures = 0;
  let counter = 0;
  const runId = Math.random().toString(36).slice(2, 8);
  const started = performance.now();
  const deadline = started + seconds * 1000;

  async function worker() {
    while (performance.now() < deadline) {
      const t = targets[counter % targets.length];
      counter++;
      const requestId = fixedRequestId ?? `${runId}-${counter}`;
      const t0 = performance.now();
      try {
        const res = await fetch(BASE + "/consume", {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": t.key },
          body: JSON.stringify({ userId: t.userId, units, requestId }),
        });
        const body = (await res.json()) as Json;
        latencies.push(performance.now() - t0);
        if (res.status !== 200) failures++;
        else if (body.accepted) accepted++;
        else rejected++;
      } catch {
        failures++;
      }
    }
  }
  await Promise.all(Array.from({ length: connections }, () => worker()));

  const elapsed = (performance.now() - started) / 1000;
  latencies.sort((a, b) => a - b);
  const pct = (p: number) =>
    latencies.length ? Math.round(latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))] * 10) / 10 : 0;
  const requests = accepted + rejected + failures;
  return {
    connections,
    rps: Math.round(requests / elapsed),
    p50: pct(0.5),
    p99: pct(0.99),
    max: pct(1),
    requests,
    accepted,
    rejected,
    failures,
  };
}

async function usage(key: string) {
  const u = await must("GET", "/usage", key);
  return {
    account: u.account.used as number,
    users: (u.users as { used: number }[]).reduce((s, x) => s + x.used, 0),
  };
}

const verdict = (problems: (string | false)[]) => {
  const p = problems.filter(Boolean);
  return p.length ? "FAIL: " + p.join("; ") : "OK";
};

type Row = { scenario: string; correct: string } & Awaited<ReturnType<typeof load>>;
const rows: Row[] = [];

async function main() {
  console.log("warm-up...");
  await load(targetsOf(await setupAccount("warm", BIG, 5)), 1, 10, 3);

  // A) حساب واحد مزدحم: كل الطلبات بتتنافس على نفس صف عدّاد الحساب
  {
    console.log("A...");
    const a = await setupAccount("hot", BIG, 50);
    const m = await load(targetsOf(a), 1, CONNECTIONS, DURATION);
    const u = await usage(a.key);
    rows.push({
      scenario: "A hot account (50 users)", ...m,
      correct: verdict([
        m.accepted === 0 && "nothing was accepted",
        m.failures > 0 && `${m.failures} failures`,
        u.account !== m.accepted && `account used ${u.account} != accepted ${m.accepted}`,
        u.users !== u.account && `users ${u.users} != account ${u.account}`,
      ]),
    });
  }

  // B) 20 حساب: المنافسة موزّعة
  {
    console.log("B...");
    const accounts: Account[] = [];
    for (let i = 0; i < 20; i++) accounts.push(await setupAccount(`spread${i}`, BIG, 1));
    const m = await load(accounts.flatMap(targetsOf), 1, CONNECTIONS, DURATION);
    let total = 0;
    let consistent = true;
    for (const a of accounts) {
      const u = await usage(a.key);
      total += u.account;
      consistent &&= u.account === u.users;
    }
    rows.push({
      scenario: "B spread (20 accounts)", ...m,
      correct: verdict([
        m.accepted === 0 && "nothing was accepted",
        m.failures > 0 && `${m.failures} failures`,
        total !== m.accepted && `used ${total} != accepted ${m.accepted}`,
        !consistent && "an account differs from the sum of its users",
      ]),
    });
  }

  // C) نفاد الحد الشهري تحت الضغط: لازم يتقبّل 500 بالضبط، لا أقل ولا أكثر
  {
    console.log("C...");
    const a = await setupAccount("exhaust", 500, 20, 10);
    const m = await load(targetsOf(a), 1, CONNECTIONS, DURATION);
    const u = await usage(a.key);
    rows.push({
      scenario: "C exhaustion (limit 500)", ...m,
      correct: verdict([
        m.failures > 0 && `${m.failures} failures`,
        m.accepted !== 500 && `accepted ${m.accepted}, expected 500`,
        m.rejected === 0 && "no rejections happened (limit never reached)",
        u.account !== 500 && `account used ${u.account}`,
        u.users !== 500 && `users used ${u.users}`,
      ]),
    });
  }

  // D) عاصفة إعادة محاولة: نفس requestId آلاف المرات لازم يستهلك مرة وحدة بس
  {
    console.log("D...");
    const a = await setupAccount("retry", BIG, 1);
    const m = await load(targetsOf(a), 5, 20, DURATION, "same-request");
    const u = await usage(a.key);
    const h = await must("GET", "/history?limit=100", a.key);
    rows.push({
      scenario: "D retry storm (same requestId)", ...m,
      correct: verdict([
        m.failures > 0 && `${m.failures} failures`,
        m.requests < 2 && "fewer than 2 requests were sent",
        u.account !== 5 && `account used ${u.account}, expected 5`,
        u.users !== 5 && `users used ${u.users}, expected 5`,
        h.items.length !== 1 && `${h.items.length} log rows, expected 1`,
      ]),
    });
  }

  const header =
    "| scenario | connections | req/s | p50 ms | p99 ms | max ms | requests | accepted | rejected | failures | correctness |\n" +
    "|---|---|---|---|---|---|---|---|---|---|---|";
  const lines = rows.map(
    (r) =>
      `| ${r.scenario} | ${r.connections} | ${r.rps} | ${r.p50} | ${r.p99} | ${r.max} | ${r.requests} | ${r.accepted} | ${r.rejected} | ${r.failures} | ${r.correct} |`,
  );
  const md = [
    `# Load test: ${LABEL}`,
    "",
    `- date: ${new Date().toISOString()}`,
    `- node: ${process.version}, cpu: ${os.cpus().length} x ${os.cpus()[0].model}, memory: ${Math.round(os.totalmem() / 1e9)} GB`,
    `- duration per scenario: ${DURATION}s, default connections: ${CONNECTIONS}`,
    `- DB_POOL_MAX passed to this script: ${process.env.DB_POOL_MAX ?? "not set (server default 20)"}`,
    "- note: in scenario D, \"accepted\" counts replays of the same decision; only one unit of consumption happens",
    "",
    header,
    ...lines,
    "",
  ].join("\n");

  mkdirSync("perf/results", { recursive: true });
  writeFileSync(`perf/results/${LABEL}.md`, md);
  console.log("\n" + md);
  process.exit(rows.every((r) => r.correct === "OK") ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
