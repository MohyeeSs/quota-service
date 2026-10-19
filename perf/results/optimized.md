# Load test: optimized

- date: 2026-10-18T12:06:57.610Z
- node: v22.15.0, cpu: 8 x 11th Gen Intel(R) Core(TM) i5-1135G7 @ 2.40GHz, memory: 8 GB
- duration per scenario: 10s, default connections: 50
- DB_POOL_MAX passed to this script: not set (server default 20)
- note: in scenario D, "accepted" counts replays of the same decision; only one unit of consumption happens

| scenario | connections | req/s | p50 ms | p99 ms | max ms | requests | accepted | rejected | failures | correctness |
|---|---|---|---|---|---|---|---|---|---|---|
| A hot account (50 users) | 50 | 118 | 284.1 | 1711.6 | 3059.4 | 1223 | 1223 | 0 | 0 | OK |
| B spread (20 accounts) | 50 | 471 | 100.9 | 221.2 | 258 | 4735 | 4735 | 0 | 0 | OK |
| C exhaustion (limit 500) | 50 | 169 | 196.6 | 1010.8 | 1672.1 | 1744 | 500 | 1244 | 0 | OK |
| D retry storm (same requestId) | 20 | 223 | 51 | 481.3 | 795.6 | 2250 | 2250 | 0 | 0 | OK |
