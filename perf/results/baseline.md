# Load test: baseline

- date: 2026-10-16T19:38:56.748Z
- node: v22.15.0, cpu: 8 x 11th Gen Intel(R) Core(TM) i5-1135G7 @ 2.40GHz, memory: 8 GB
- duration per scenario: 10s, default connections: 50
- DB_POOL_MAX passed to this script: not set (server default 20)
- note: in scenario D, "accepted" counts replays of the same decision; only one unit of consumption happens

| scenario | connections | req/s | p50 ms | p99 ms | max ms | requests | accepted | rejected | failures | correctness |
|---|---|---|---|---|---|---|---|---|---|---|
| A hot account (50 users) | 50 | 185 | 222.2 | 626.9 | 908.2 | 1896 | 1896 | 0 | 0 | OK |
| B spread (20 accounts) | 50 | 665 | 73.3 | 110.7 | 147.7 | 6684 | 6684 | 0 | 0 | OK |
| C exhaustion (limit 500) | 50 | 240 | 152.6 | 554.5 | 946.3 | 2451 | 500 | 1951 | 0 | OK |
| D retry storm (same requestId) | 20 | 296 | 7.3 | 432.3 | 854.5 | 2976 | 2976 | 0 | 0 | OK |
