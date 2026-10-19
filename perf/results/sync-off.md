# Load test: sync-off

- date: 2026-10-18T12:07:43.901Z
- node: v22.15.0, cpu: 8 x 11th Gen Intel(R) Core(TM) i5-1135G7 @ 2.40GHz, memory: 8 GB
- duration per scenario: 10s, default connections: 50
- DB_POOL_MAX passed to this script: not set (server default 20)
- note: in scenario D, "accepted" counts replays of the same decision; only one unit of consumption happens

| scenario | connections | req/s | p50 ms | p99 ms | max ms | requests | accepted | rejected | failures | correctness |
|---|---|---|---|---|---|---|---|---|---|---|
| A hot account (50 users) | 50 | 209 | 157.5 | 881.7 | 2034.3 | 2134 | 2134 | 0 | 0 | OK |
| B spread (20 accounts) | 50 | 593 | 79.6 | 188.1 | 305.1 | 5960 | 5960 | 0 | 0 | OK |
| C exhaustion (limit 500) | 50 | 276 | 119 | 685.4 | 1280.9 | 2799 | 500 | 2299 | 0 | OK |
| D retry storm (same requestId) | 20 | 347 | 8.9 | 470.4 | 1004.8 | 3489 | 3489 | 0 | 0 | OK |
