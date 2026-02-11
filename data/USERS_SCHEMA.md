# User storage schema (Postgres)

Canonical schema lives in Postgres migrations (see `data/migrations/001_create_user_storage.sql`).

`data/users.csv` is deprecated and retained only for historical backfill.

## Tables

### `users`

| Field | Type | Description |
| --- | --- | --- |
| id | uuid | Primary key. |
| email | text | Normalized lowercase email. |
| display_name | text | Display name. |
| created_at | timestamptz | Account creation timestamp. |
| last_seen_at | timestamptz | Last successful login. |
| auth_providers | jsonb | Array of `{ provider, provider_user_id }` objects. |
| is_internal | boolean | Marks internal/test accounts. |
| plan_override | text | Optional internal plan tier override (`free`, `starter`, `pro`, `power`). When set, this is the effective runtime plan. |

### `billing`

| Field | Type | Description |
| --- | --- | --- |
| user_id | uuid | Primary key, FK to users. |
| plan_tier | text | `free`, `starter`, `pro`, `power`. |
| stripe_customer_id | text | Stripe customer identifier. |
| stripe_subscription_id | text | Stripe subscription identifier. |
| status | text | `active`, `past_due`, `canceled`. |
| current_period_start | timestamptz | Billing period start. |
| current_period_end | timestamptz | Billing period end (monthly reset target). |

### `credits`

| Field | Type | Description |
| --- | --- | --- |
| user_id | uuid | Primary key, FK to users. |
| monthly_quota | int | Total credits for the current period. |
| balance | int | Authoritative remaining credits. |
| daily_cap | int | Optional per-plan daily cap. |
| daily_used | int | Credits consumed today. |
| last_daily_reset_at | timestamptz | Last daily reset timestamp. |
| last_monthly_reset_at | timestamptz | Last monthly reset timestamp. |

### `credit_ledger`

| Field | Type | Description |
| --- | --- | --- |
| id | uuid | Primary key. |
| user_id | uuid | FK to users. |
| session_id | text | Session identifier. |
| turn_id | text | Turn identifier (idempotency key). |
| delta | int | Credit change (negative for debits). |
| balance_after | int | Balance after the change. |
| reason | text | Reason code (e.g. `llm_usage`). |
| metadata | text | Serialized metadata. |
| created_at | timestamptz | Ledger timestamp. |

### `billing_events`

| Field | Type | Description |
| --- | --- | --- |
| stripe_event_id | text | Stripe event identifier (primary key). |
| type | text | Stripe event type (e.g. `checkout.session.completed`). |
| user_id | uuid | FK to users (nullable when unresolved). |
| processed_at | timestamptz | Timestamp for last processing attempt. |
| status | text | `received`, `processed`, `failed`. |
| payload_hash | text | SHA-256 hash of the raw webhook payload. |

## Notes

- Apple may return email only on the first login; the stored provider IDs remain the primary identity link.
- Email remains the primary merge key when present.

## Migration/backfill

- Run the migration in `data/migrations/001_create_user_storage.sql`.
- Use `scripts/import-users.js` to backfill existing CSV users into Postgres.

## CSV deprecation

`data/users.csv` remains in the repo for audit/backfill only. All runtime user reads/writes now go through Postgres.
