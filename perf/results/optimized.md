# Load test: optimized

- date: 2026-10-18T11:43:55.773Z
- node: v22.15.0, cpu: 8 x 11th Gen Intel(R) Core(TM) i5-1135G7 @ 2.40GHz, memory: 8 GB
- duration per scenario: 10s, default connections: 50
- DB_POOL_MAX passed to this script: not set (server default 20)
- note: in scenario D, "accepted" counts replays of the same decision; only one unit of consumption happens

| scenario | connections | req/s | p50 ms | p99 ms | max ms | requests | accepted | rejected | failures | correctness |
|---|---|---|---|---|---|---|---|---|---|---|
| A hot account (50 users) | 50 | 188 | 177.2 | 1002.5 | 1518.6 | 1938 | 1938 | 0 | 0 | OK |
| B spread (20 accounts) | 50 | 596 | 78 | 156.6 | 204.7 | 5991 | 5991 | 0 | 0 | OK |
| C exhaustion (limit 500) | 50 | 228 | 140.8 | 838.5 | 1363.6 | 2331 | 500 | 1831 | 0 | OK |
| D retry storm (same requestId) | 20 | 286 | 36.7 | 365.3 | 761.5 | 2876 | 2876 | 0 | 0 | OK |
