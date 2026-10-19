# Usage Metering and Quota Service

A backend service that other applications call to track usage and decide whether their users may perform an action. An **account** (the calling application) has a shared monthly allowance and each **user** has an individual one. Every `consume` request must satisfy both plans; the decision is recorded, and the units are counted only if the request is accepted.

Stack: TypeScript, Fastify, Drizzle ORM, PostgreSQL. One service, one database.

## Quick start

~~~bash
docker compose up --build
~~~

| What | Where |
|---|---|
| Service API | http://localhost:3000 |
| Example client (web page) | http://localhost:4000 |
| PostgreSQL from the host | `localhost:5433` (user, password and database: `quota`) |

Startup applies the migrations and seeds the predefined plans automatically; both are safe to repeat. Stop any local `npm run dev` first, because ports 3000 and 4000 must be free. To wipe all data: `docker compose down -v`.

### Example client

Open http://localhost:4000 and press **Run scenario**. The page plays a calling application: its backend holds an account API key and asks the service to consume units for two users with different plans. A fresh account is created on every run. Expected result:

| # | Step | Outcome |
|---|---|---|
| 1 | alice (Basic plan) consumes 10 | accepted |
| 2 | alice consumes 25 | rejected by the **user** per-request limit (Basic allows 20) |
| 3 | switch alice to the custom Power plan | `PUT /users/alice/plan` |
| 4 | alice consumes 25 again | accepted |
| 5 | bob (Power) consumes 30 | rejected by the shared **account** allowance (35 of 60 used, 25 left) |
| 6 | bob consumes 25 | accepted (exactly what is left) |
| 7 | raise the account allowance from 60 to 100 | `PATCH /plans/{id}` |
| 8 | bob consumes 30 | accepted |

The client code never changes between steps; only plan data does. Each row shows the decision and the remaining allowance for the user and the account. The "Try it yourself" form sends manual requests, and the usage table below shows consumed and remaining units with the applied plans.

### Configuration

| Variable | Used by | Default |
|---|---|---|
| `DATABASE_URL` | service | set in `.env.example` and `docker-compose.yml` |
| `PORT` | service | 3000 |
| `LOG_LEVEL` | service | `info` (use `warn` for load tests) |
| `DB_POOL_MAX` | service | 20 |
| `SERVICE_URL` | client | `http://localhost:3000` (`http://app:3000` in Compose) |
| `CLIENT_PORT` | client | 4000 |

### Local development

~~~bash
docker compose up -d db
npm ci
cp .env.example .env
npm run db:migrate       # applies migrations and seeds the predefined plans
npm run dev              # service on :3000
npm run client           # example client on :4000 (separate terminal)
npx vitest run           # tests (the database must be running)
~~~

Schema changes: edit `src/db/schema.ts`, run `npm run db:generate` (writes a SQL file into `drizzle/`), then `npm run db:migrate`.

### Layout

~~~
src/app.ts, server.ts, auth.ts    app wiring, error handling, API key middleware
src/db/                           schema, client, migrate, seed (predefined plans)
src/modules/accounts|users|plans  CRUD and plan assignment
src/modules/consume/              rules.ts (decision rules) and consume.service.ts (accounting)
src/modules/usage/                usage and history queries
client/                           example application
perf/                             load generator, A/B script, results
tests/                            vitest suites
drizzle/                          generated SQL migrations
~~~

## Model

| Concept | Notes |
|---|---|
| Account | The calling application. Has one account plan and an API key. |
| User | Registered under an account with the caller's own `externalId`. Has a user plan. |
| Plan | `scope` (`account` or `user`), `monthlyAllowance`, `maxPerRequest`. Predefined plans have no owner and are read-only; custom plans belong to one account. |
| Usage counters | One row per (account, month) and per (user, month). |
| Request log | Every decision, accepted or rejected, with the rejecting rule and level. |

The resource is one kind of unit, a positive integer. Account usage is the sum of its users' accepted usage: both counters change in the same transaction. Users sharing a plan share its definition, never usage.

### Predefined plans

| Plan | Scope | Monthly allowance | Per request |
|---|---|---|---|
| Starter | account | 10,000 | 100 |
| Pro | account | 100,000 | 1,000 |
| Basic | user | 1,000 | 20 |
| Premium | user | 10,000 | 200 |

New accounts default to Starter and new users to Basic. User limits sit below account limits so both rejection paths are easy to demonstrate.

## API keys

`POST /accounts` creates an account and returns its API key **once**; only a SHA-256 hash (plus a short prefix) is stored. Send the key on every other call:

~~~
x-api-key: qk_...
~~~

The key identifies the account, and the account is never read from a request body. Missing or invalid keys return `401`. A user or plan belonging to another account behaves as if it does not exist, so accounts cannot see or touch each other's data.

## API

| Method | Path | Purpose |
|---|---|---|
| POST | `/accounts` | Create an account (`name`, optional predefined `planId`); returns `apiKey` |
| GET | `/account` | The account and its plan |
| PUT | `/account/plan` | Assign an account plan (`planId`) |
| POST | `/users` | Register a user (`externalId`, optional `planId`) |
| GET | `/users/:externalId` | The user and its plan |
| PUT | `/users/:externalId/plan` | Change the user's plan (`planId`) |
| POST | `/plans` | Create a custom plan (`scope`, `name`, `monthlyAllowance`, `maxPerRequest`) |
| GET | `/plans`, `/plans/:id` | Predefined plans plus the account's own |
| PATCH | `/plans/:id` | Update a custom plan (predefined plans return `403`) |
| POST | `/consume` | Consume units (`userId`, `units`, `requestId`) |
| GET | `/usage?month=YYYY-MM` | Consumed and remaining units for the account and every user, with the applied plans (default: current UTC month) |
| GET | `/history?month=&userId=&limit=&offset=` | Request outcomes, newest first (`limit` up to 100); returns `items`, `hasMore`, `nextOffset` |
| GET | `/health` | Liveness |

Errors are `{ "error": "<code>" }`: `400` validation or invalid plan, `401` API key, `403` predefined plan, `404` unknown user or plan, `409` duplicate user or plan name or `request_id_reused`, `500` unexpected (details only in the server log).

### Example

~~~bash
KEY=$(curl -s -X POST localhost:3000/accounts -H 'content-type: application/json' \
  -d '{"name":"Acme Docs"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).apiKey')

curl -s -X POST localhost:3000/users -H 'content-type: application/json' -H "x-api-key: $KEY" \
  -d '{"externalId":"alice"}'

curl -s -X POST localhost:3000/consume -H 'content-type: application/json' -H "x-api-key: $KEY" \
  -d '{"userId":"alice","units":25,"requestId":"doc-42"}'
~~~

~~~json
{
  "requestId": "doc-42",
  "accepted": false,
  "replayed": false,
  "rejection": { "level": "user", "rule": "max_per_request" },
  "units": 25,
  "month": "2026-10",
  "account": { "monthlyAllowance": 10000, "maxPerRequest": 100, "used": 0, "remaining": 10000 },
  "user":    { "monthlyAllowance": 1000,  "maxPerRequest": 20,  "used": 0, "remaining": 1000 }
}
~~~

A rejection is a normal outcome (`200` with `accepted: false`); 4xx is reserved for problems with the request itself.

Plans and usage:

~~~bash
curl -s -X POST localhost:3000/plans -H 'content-type: application/json' -H "x-api-key: $KEY" \
  -d '{"scope":"user","name":"Power","monthlyAllowance":1000,"maxPerRequest":50}'
curl -s -X PUT localhost:3000/users/alice/plan -H 'content-type: application/json' -H "x-api-key: $KEY" \
  -d '{"planId":"<plan id>"}'
curl -s localhost:3000/usage -H "x-api-key: $KEY"
curl -s "localhost:3000/history?limit=5" -H "x-api-key: $KEY"
~~~

## Rules

Two rule types exist for both account and user plans: **monthly allowance** (units per UTC calendar month) and **maximum units per request**. A request is accepted only if all four checks pass, evaluated in this order; the first failure is reported with its `level` (`account` or `user`) and `rule`:

1. user per-request, 2. account per-request, 3. user monthly, 4. account monthly.

Per-request rules go first because they do not depend on current usage, and the user level goes before the account level because it is the most specific. A rejection consumes nothing. The checks are small functions in a list (`src/modules/consume/rules.ts`), so adding a rule type (for example a daily cap) means writing one function, adding it to the list and, if it needs state, one counter table. No additional rule types are implemented beyond the two required.

## Plan changes

- Plans are read at request time, so a change applies to the next request with no redeploy.
- Updating a custom plan affects every account or user assigned to it.
- Switching plans keeps the units already consumed; it never grants a fresh allowance.
- If an allowance is reduced below current usage, `remaining` is `0` and requests are rejected at that level until the allowance exceeds usage again.
- History is never rewritten.

## Retries and idempotency

`requestId` identifies one logical request and is unique per account.

- Same `requestId` with the same user and units: the original decision is returned with `replayed: true` and nothing is consumed again. This includes rejections. The balances in a replay are the current ones, not those at the time of the first attempt.
- Same `requestId` with a different user or units: `409 request_id_reused`.
- To try again after a rejection under new conditions (for example after a plan upgrade), send a new `requestId`.
- If a call fails midway, the transaction rolls back completely, so retrying with the same `requestId` is always safe.

## Design decisions

- **One transaction per consume.** Look up the user and both plans, lock the account counter row and then the user counter row (always in this order, which prevents deadlocks), check for a duplicate `requestId`, evaluate the rules, then update both counters and write the log row.
- **Counters instead of summing the history.** A decision reads and updates one row per level instead of aggregating a growing log. The cost is that counters must be updated in the same transaction as the log, which they are. Tests assert that account usage equals the sum of its users and the accepted units in the log.
- **Duplicate check after the account lock.** Concurrent requests of one account queue on that lock, so a duplicate sees the committed first attempt. A unique index on `(account_id, request_id)` is the backstop.
- **Row locks instead of optimistic updates.** A conditional `UPDATE ... WHERE used + n <= limit` would be simpler, but with two levels, plans read at request time and a rejection that must name the rule, taking the lock first keeps the decision and the explanation consistent.
- **API keys are hashed with SHA-256, not bcrypt.** Keys are long random values, so brute force is not a concern, and every request needs a fast indexed lookup.
- **Migrations** are generated by Drizzle as SQL files in `drizzle/` and applied by `npm run db:migrate`, which also seeds the predefined plans (fixed ids, upserts). The service container runs it before starting.
- **Database constraints back the code:** usage cannot be negative, limits must be positive, plan names are unique per account.
- **Months** are UTC calendar months of the processing time. Each month starts at zero and earlier months stay queryable.

## Product assumptions

- Account creation is open (no admin step), and there is no key rotation or revocation endpoint.
- Users are identified by the caller's `externalId`, unique within an account.
- Plans cannot be deleted, only updated; predefined plans are read-only.
- `/usage` for a past month shows the plans currently applied, with remaining units computed against them.
- `units` is an integer from 1 to 1,000,000,000,000; allowances are integers.
- History uses offset pagination.
- The request log is kept indefinitely.

## Tests

~~~bash
npx vitest run
~~~

40 tests in four files cover: API key validation and account isolation, plan rules and assignment, all four rejection paths, replays and key reuse, 20 concurrent duplicates, plan changes (including an allowance lowered below usage), month rollover, usage and history (pagination, filtering, isolation), and concurrency: 50 and 100 simultaneous requests never exceed an allowance, and the account, user and log totals match. Tests share the development database and create uniquely named accounts.

## Performance

### Method

`perf/run.ts` is a small load generator (Node `fetch` with N concurrent workers). It waits for in-flight requests at the end, so the correctness checks are exact. It runs four scenarios: (A) one hot account with 50 users, (B) 20 accounts, (C) a 500-unit allowance exhausted under load, and (D) the same `requestId` sent thousands of times. After each scenario it verifies the results against the service.

Setup: one 8-core laptop (i5-1135G7, 8 GB) running the service, PostgreSQL (Docker) and the generator together, with request logging disabled (`LOG_LEVEL=warn`). 50 workers (20 in D), 10 s per scenario, one run per variant, run back to back by `perf/ab.sh`. Absolute numbers vary between sessions on this machine, so only compare rows within this table. Raw output: `perf/results/baseline.md`, `optimized.md`, `sync-off.md`.

### Results

| Scenario | baseline req/s | optimized req/s | optimized p99 ms (baseline) | commit flush off, req/s (experiment) |
|---|---|---|---|---|
| A: one hot account, 50 users | 98 | 118 | 1712 (1970) | 209 |
| B: 20 accounts | 406 | 471 | 221 (263) | 593 |
| C: 500-unit allowance exhausted | 136 | 169 | 1011 (1417) | 276 |
| D: same `requestId` repeated | 185 | 223 | 481 (962) | 347 |

Every scenario passed its correctness checks in all three runs: account usage equals the accepted units and the sum of its users; scenario C accepted exactly 500 units; scenario D produced one consumption and one log row for thousands of identical requests.

### What this showed

- **Bottleneck.** With the same 50 workers, one hot account is about four times slower than twenty accounts (A vs B). All requests of an account serialize on its usage counter row, and the lock is held until the transaction commits, so an account's throughput is bounded by how long one transaction holds that lock. Latency follows from queueing (50 workers at about 118 req/s is roughly 0.4 s average per request).
- **Change.** The user and plan lookup now happens in one query before taking any lock, and an accepted request updates both counters and writes the log row in one statement. Between taking the account lock and committing, an accepted request now needs 5 round trips instead of 8, with the same lock order and the same guarantees. Throughput rose 16-24% and p99 fell in every scenario (single run per variant, so the size of the gain is indicative).
- **Experiment, not adopted.** With `synchronous_commit=off`, the hot-account rate rose from 118 to 209 req/s, which shows that waiting for the write-ahead log flush at commit is a large part of the lock hold time. It is not adopted: a crash could lose the most recent commits, and this service must preserve data.
- **If one account needed much more.** Options are batching or reserving units for groups of requests, spreading one account's counter over several rows, or faster storage. Each trades exactness at the moment of the decision, or simplicity, for throughput.

### Reproduce

Requirements: Node 22, Docker, and the database running (`docker compose up -d db`, then `npm ci` and `npm run db:migrate`).

~~~bash
bash perf/ab.sh                        # baseline (first commit of consume.service.ts), optimized, and the commit-flush experiment
LOG_LEVEL=warn npm run start           # terminal 1: your own run against the current code
npm run perf -- my-label               # terminal 2: writes perf/results/my-label.md
~~~

Each run adds many rows to the request log; reset with `docker compose down -v`.

## Known limitations

- Requests of one account serialize on its counter row, so a single very busy account is bounded by how fast one transaction commits. Different accounts scale independently.
- Offset pagination gets slower on deep pages and can shift when new rows arrive; keyset pagination would fix both.
- The request log grows without bound (partitioning by month would help).
- No rate limiting, no HTTPS termination, no key rotation or revocation.
- Open account creation, as assumed above.
- Load numbers come from one laptop that also runs the generator, with one run per variant.
- The containers run TypeScript through `tsx` for simplicity instead of a compiled build.
