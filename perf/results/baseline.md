# Load test: baseline

- date: 2026-10-18T12:06:10.385Z
- node: v22.15.0, cpu: 8 x 11th Gen Intel(R) Core(TM) i5-1135G7 @ 2.40GHz, memory: 8 GB
- duration per scenario: 10s, default connections: 50
- DB_POOL_MAX passed to this script: not set (server default 20)
- note: in scenario D, "accepted" counts replays of the same decision; only one unit of consumption happens

| scenario | connections | req/s | p50 ms | p99 ms | max ms | requests | accepted | rejected | failures | correctness |
|---|---|---|---|---|---|---|---|---|---|---|
| A hot account (50 users) | 50 | 98 | 348.9 | 1970.1 | 2853.4 | 1026 | 1026 | 0 | 0 | OK |
| B spread (20 accounts) | 50 | 406 | 117.2 | 263.3 | 302.5 | 4095 | 4095 | 0 | 0 | OK |
| C exhaustion (limit 500) | 50 | 136 | 267.1 | 1416.7 | 2320.8 | 1399 | 500 | 899 | 0 | OK |
| D retry storm (same requestId) | 20 | 185 | 11.3 | 961.8 | 1541.8 | 1869 | 1869 | 0 | 0 | OK |
