# Users CSV schema

Canonical file: `data/users.csv`.

## Columns

| Field | Type | Description |
| --- | --- | --- |
| user_id | string (uuid) | Primary key. Never changes. |
| email | string | Normalized lowercase email. Used for identity merging. |
| auth_provider | enum | `google`, `apple`, `email`. |
| provider_user_id | string | OAuth subject/Apple user identifier (nullable for email). |
| display_name | string | Optional (Google/Apple name or user-provided). |
| created_at | ISO 8601 | Account creation timestamp. |
| last_login_at | ISO 8601 | Last successful login. |
| plan_tier | enum | `free`, `starter`, `pro`, `enterprise`. |
| credits_total | int | Total credits granted for the current period. |
| credits_remaining | int | Remaining credits for the current period. |
| credits_balance | int | Authoritative remaining credits (ledger-backed). |
| daily_credit_limit | int | Optional per-plan daily cap. |
| credits_last_reset | ISO 8601 | Last daily reset timestamp. |
| monthly_reset_at | ISO 8601 | Next monthly reset timestamp. |
| newsletter_opt_in | boolean | Always true by default. |
| account_status | enum | `active`, `suspended`. |
| stripe_customer_id | string | Stripe customer identifier. |
| stripe_subscription_id | string | Stripe subscription identifier. |
| billing_status | enum | `active`, `past_due`, `canceled`. |

## Notes

- `provider_user_id` should store Google `sub` or Apple user identifier permanently.
- Apple may return email only on the first login; fall back to `provider_user_id` for matching.
- Email remains the primary identity merge key when present.

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
