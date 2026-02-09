# Credit ledger CSV schema

Canonical file: `data/credit_ledger.csv`.

## Design principles

- Append-only: always add new rows and never rewrite existing ones.
- One row per credit movement. Negative delta = spend, positive delta = grant/refund.
- Auditable: if it isn't in the ledger, it didn't happen.

## Columns

| Field | Type | Description |
| --- | --- | --- |
| timestamp_utc | ISO 8601 | When the credit change was committed (UTC). |
| user_id | string (uuid) | Links to `data/users.csv`. |
| session_id | string (uuid) | Client session identifier. |
| turn_id | string (uuid) | Idempotency key (LLM turn or request id). |
| delta | int | Negative = spend, positive = grant/refund. |
| balance_after | int | User balance after applying delta. |
| reason | enum | `llm_usage`, `plan_grant`, `topup`, `refund`, `manual_adjustment`. |
| metadata | string | Semi-colon delimited metadata (e.g. `model:gpt-4.1-mini;tokens_in:530`). |

## Example row

```csv
2024-06-12T18:42:11.238Z,user_3a91e,session_91f3a,req_91f3a,-8,492,llm_usage,"model:gpt-4.1-mini;tokens_in:530;tokens_out:1373"
```

## Append-only write logic

- Never edit past rows. Always append.
- Logging must never block generation.
