# Usage log CSV schema

Canonical file: `data/usage_log.csv`.

## Design principles

- Append-only: always add new rows and never rewrite existing ones.
- Full audit trail for debugging, recovery, and future DB migrations.

## Columns

| Field | Type | Description |
| --- | --- | --- |
| event_id | string (uuid) | Primary key for this log entry. |
| timestamp | ISO 8601 | When the request completed. |
| user_id | string (uuid) | Links to `data/users.csv`. |
| request_id | string (uuid) | One per API call (ties retries together). |
| plan | enum | `free`, `starter`, `pro`, `enterprise`, etc. |
| endpoint | string | `/generate`, `/chat`, etc. |
| intent_type | enum | `text`, `code`, `creative`. |
| model_variant | string | e.g. `maya-code-v1`. |
| credits_charged | int | How many credits this request cost. |
| credits_remaining | int | Remaining credits after deduction. |
| tokens_estimated | int | Approx tokens (cost sanity). |
| latency_ms | int | End-to-end request latency. |
| generation_duration_ms | int | LLM generation time only. |
| output_type | enum | `html`, `text`, `mixed`, `error`. |
| status | enum | `success`, `blocked`, `error`. |
| throttle_state | enum | `none`, `soft`, `hard`. |
| client_origin | string | `web`, `mobile`, `api`. |
| ip_hash | string | SHA-256 hash (never store raw IP). |
| user_agent | string | For debugging only. |
| notes | string | Optional internal notes. |

## Example row

```csv
8f4d2c3e-1e3b-4a7a-9a6e-2b2c3e9d92f1,2024-06-12T18:42:11.238Z,user_3a91e,req_91f3a,pro,/generate,creative,maya-code-v1,3,417,1840,2310,59872,html,success,none,web,a94a8fe5ccb19ba61c4c0873d391e987982fbbd3,Mozilla/5.0,long_generation_high_complexity
```

## Append-only write logic

- Never edit past rows. Always append.
- Logging must never block generation.

### Backend flow

1. Build log row object.
2. Serialize to CSV line.
3. Fetch latest file SHA.
4. Append new line.
5. Commit.

If the write fails, allow the request to complete and retry logging asynchronously.

## Relationship to `data/users.csv`

- `data/users.csv` = current state.
- `data/usage_log.csv` = historical truth.

If counters ever disagree, rebuild `users.csv` from `usage_log.csv`.

## Throttling queries

Daily usage:

```sql
COUNT rows
WHERE user_id = X
AND timestamp is today
AND status = success
```

Monthly usage:

```sql
SUM credits_charged
WHERE user_id = X
AND timestamp in current month
```
