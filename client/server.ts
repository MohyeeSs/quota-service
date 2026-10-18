import { createServer, type IncomingMessage } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const SERVICE_URL = process.env.SERVICE_URL ?? "http://localhost:3000";
const PORT = Number(process.env.CLIENT_PORT ?? 4000);
const page = readFileSync(join(process.cwd(), "client", "index.html"));

type Json = Record<string, any>;
type Step = {
  title: string;
  request: string;
  outcome: "accepted" | "rejected" | "info";
  reason: string;
  user: string;
  account: string;
};

let currentKey: string | null = null;

async function api(method: string, path: string, key?: string, body?: object) {
  const headers: Record<string, string> = {};
  if (key) headers["x-api-key"] = key;
  if (body) headers["content-type"] = "application/json";
  const res = await fetch(SERVICE_URL + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Json;
  return { status: res.status, json };
}

async function must(method: string, path: string, key: string | undefined, body?: object) {
  const r = await api(method, path, key, body);
  if (r.status < 200 || r.status >= 300) {
    throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.json)}`);
  }
  return r.json;
}

const fmt = (b: Json) => `${b.used} used, ${b.remaining} left`;

async function consumeStep(key: string, title: string, userId: string, units: number): Promise<Step> {
  const request = `consume ${units} for ${userId}`;
  const r = await api("POST", "/consume", key, { userId, units, requestId: randomUUID() });
  if (r.status !== 200) {
    return { title, request, outcome: "rejected", reason: `HTTP ${r.status}: ${r.json.error}`, user: "", account: "" };
  }
  const b = r.json;
  return {
    title,
    request,
    outcome: b.accepted ? "accepted" : "rejected",
    reason: b.rejection ? `${b.rejection.level}: ${b.rejection.rule}` : "",
    user: fmt(b.user),
    account: fmt(b.account),
  };
}

const info = (title: string, request: string, reason: string): Step => ({
  title,
  request,
  outcome: "info",
  reason,
  user: "",
  account: "",
});

async function runScenario() {
  const created = await must("POST", "/accounts", undefined, { name: "Demo " + new Date().toISOString() });
  const key = created.apiKey as string;
  currentKey = key;

  // حساب بحد شهري صغير (60) عشان نوصل لحد الحساب بسرعة
  const accountPlan = await must("POST", "/plans", key, {
    scope: "account", name: "Demo Team", monthlyAllowance: 60, maxPerRequest: 50,
  });
  await must("PUT", "/account/plan", key, { planId: accountPlan.plan.id });
  const power = await must("POST", "/plans", key, {
    scope: "user", name: "Power", monthlyAllowance: 1000, maxPerRequest: 50,
  });

  await must("POST", "/users", key, { externalId: "alice" }); // Basic (جاهزة): 1000 شهرياً، 20 للطلب
  await must("POST", "/users", key, { externalId: "bob", planId: power.plan.id });

  const steps: Step[] = [];
  steps.push(await consumeStep(key, "Alice (Basic) processes a small document", "alice", 10));
  steps.push(await consumeStep(key, "Alice tries a bigger document", "alice", 25));

  await must("PUT", "/users/alice/plan", key, { planId: power.plan.id });
  steps.push(info("Switch alice to the Power plan", "PUT /users/alice/plan", "alice: 50 per request now"));
  steps.push(await consumeStep(key, "Alice retries the same size", "alice", 25));

  steps.push(await consumeStep(key, "Bob asks for more than the account has left", "bob", 30));
  steps.push(await consumeStep(key, "Bob asks for exactly what is left", "bob", 25));

  await must("PATCH", `/plans/${accountPlan.plan.id}`, key, { monthlyAllowance: 100 });
  steps.push(info("Raise the account allowance to 100", "PATCH /plans/{id}", "applies to the next request"));
  steps.push(await consumeStep(key, "Bob retries the 30 units", "bob", 30));

  return { steps, usage: await must("GET", "/usage", key) };
}

async function readJson(req: IncomingMessage): Promise<Json> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString();
  return text ? (JSON.parse(text) as Json) : {};
}

createServer(async (req, res) => {
  const send = (status: number, body: unknown, type = "application/json") => {
    res.writeHead(status, { "content-type": type });
    res.end(Buffer.isBuffer(body) || typeof body === "string" ? body : JSON.stringify(body));
  };

  try {
    if (req.method === "GET" && req.url === "/") return send(200, page, "text/html; charset=utf-8");

    if (req.method === "POST" && req.url === "/api/scenario") return send(200, await runScenario());

    if (req.method === "POST" && req.url === "/api/consume") {
      if (!currentKey) return send(400, { error: "Run the scenario first" });
      const b = await readJson(req);
      const units = Number(b.units);
      if (!Number.isInteger(units) || units <= 0) return send(400, { error: "units must be a positive integer" });
      const step = await consumeStep(currentKey, "Manual request", String(b.userId), units);
      return send(200, { step, usage: await must("GET", "/usage", currentKey) });
    }

    if (req.method === "GET" && req.url === "/api/usage") {
      if (!currentKey) return send(400, { error: "Run the scenario first" });
      return send(200, await must("GET", "/usage", currentKey));
    }

    send(404, { error: "not_found" });
  } catch (err) {
    send(500, { error: err instanceof Error ? err.message : String(err) });
  }
}).listen(PORT, "0.0.0.0", () => console.log(`demo client on http://localhost:${PORT} -> ${SERVICE_URL}`));
