# Users CSV schema

Canonical file: `data/users.csv`.

## Columns

| Field | Type | Description |
| --- | --- | --- |
| user_id | string (uuid) | Primary key. Never changes. |
| created_at | ISO 8601 | Account creation timestamp. |
| email | string | Normalized lowercase email. |
| auth_provider | enum | `google`, `apple`, `email`. |
| display_name | string | Optional (Google/Apple name or user-provided). |
| newsletter_opt_in | boolean | Always true by default. |
| account_status | enum | `active`, `suspended`, `deleted`. |
| plan | enum | `free`, `starter`, `pro`, `enterprise`. |
| monthly_credit_limit | int | Credits per month. |
| monthly_credits_used | int | Reset monthly. |
| hard_daily_limit | int | Absolute daily cap. |
| soft_daily_limit | int | Warning threshold. |
| last_request_at | ISO 8601 | For abuse detection. |
| last_reset_at | ISO 8601 | Monthly reset marker. |
| total_requests | int | Lifetime count. |
| total_tokens_estimated | int | Approximate cost tracking. |
| notes | string | Internal only. |

## Credits defaults

| Plan | Monthly credits | Soft daily | Hard daily |
| --- | --- | --- | --- |
| free | 100 | 10 | 20 |
| starter | 500 | 50 | 80 |
| pro | 2,000 | 200 | 300 |

## Update strategy

- Fetch the latest `data/users.csv` from GitHub.
- Parse into rows, update or append a single row, and write the file back with the latest SHA.
- Avoid rewriting the file locally to prevent race conditions and silent overwrites.

## Update flow (GitHub contents API)

1. `GET /repos/awlondon/maya-dev-ui/contents/data/users.csv` to retrieve `content` and `sha`.
2. Parse the CSV.
3. Modify or append a user record.
4. Serialize the CSV (preserve header order).
5. `PUT /repos/awlondon/maya-dev-ui/contents/data/users.csv` with the new content, prior `sha`, and `main` branch.
