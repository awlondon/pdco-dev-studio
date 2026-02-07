# Usage log CSV schema

Canonical file: `data/usage_log.csv`.

## Design principles

- Append-only: always add new rows and never rewrite existing ones.
- Full audit trail for debugging, recovery, and future DB migrations.

## Columns

| Field | Type | Description |
| --- | --- | --- |
| timestamp_utc | ISO 8601 | When the request completed (UTC). |
| user_id | string (uuid) | Links to `data/users.csv`. |
| email | string | User email address. |
| session_id | string (uuid) | Client session identifier. |
| request_id | string (uuid) | Generated before calling the LLM. |
| intent_type | enum | `text`, `code`, `creative`. |
| model | string | e.g. `gpt-4.1-mini`. |
| input_chars | int | Character count sent to the model. |
| input_est_tokens | int | Estimated input tokens. |
| output_chars | int | Character count returned by the model. |
| output_est_tokens | int | Estimated output tokens. |
| total_est_tokens | int | Sum of input/output estimates. |
| credits_charged | int | Credits charged after generation. |
| latency_ms | int | End-to-end request latency. |
| status | enum | `success`, `error`, `timeout`, `aborted`. |

## Example row

```csv
2024-06-12T18:42:11.238Z,user_3a91e,alex@example.com,session_91f3a,req_91f3a,creative,gpt-4.1-mini,2120,530,4118,1373,1903,8,59872,success
```

## Append-only write logic

- Never edit past rows. Always append.
- Logging must never block generation.

### Backend flow

1. Build log row object.
2. Serialize to CSV line.
3. Fetch latest file SHA.
4. Append new line (base64 encode full file contents).
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
AND timestamp_utc is today
AND status = success
```

Monthly usage:

```sql
SUM credits_charged
WHERE user_id = X
AND timestamp_utc in current month
```
