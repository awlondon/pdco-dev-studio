# API Endpoint Contracts

Scope: Usage Analytics, Cost Accounting, Routing, Anomalies.

## 1. Usage Event Ingestion (internal only)

**POST** `/api/usage/event`

**Purpose:** Write a single immutable usage event.

**Access:** Internal service only (LLM gateway).

**Request**

```json
{
  "session_id": "uuid",
  "intent": "code",
  "model": "gpt-4.1",
  "tokens_in": 1234,
  "tokens_out": 456,
  "credits_used": 12,
  "latency_ms": 842,
  "success": true
}
```

**Server behavior**

- Resolve `user_id` from auth/session.
- Insert exactly one row into `usage_events`.
- No aggregation here.

**Response**

```json
{ "ok": true }
```

## 2. Usage Overview (Account → Analytics summary)

**GET** `/api/usage/overview`

**Purpose:** 30-day rollup (fast load).

**Response**

```json
{
  "requests": 342,
  "credits_used": 1840,
  "avg_latency_ms": 912,
  "success_rate": 99.1
}
```

**Notes**

- Backed by rolling overview query.
- Always user-scoped.

## 3. Credit Burn Chart

**GET** `/api/usage/credits/daily?days=14`

**Response**

```json
[
  { "day": "2026-02-01", "credits_used": 120 },
  { "day": "2026-02-02", "credits_used": 98 }
]
```

## 4. Requests per Day (Code vs Text)

**GET** `/api/usage/requests/daily?days=14`

**Response**

```json
[
  {
    "day": "2026-02-01",
    "code_requests": 32,
    "text_requests": 18
  }
]
```

## 5. Latency Trend

**GET** `/api/usage/latency/daily?days=14`

**Response**

```json
[
  { "day": "2026-02-01", "avg_latency_ms": 910 }
]
```

## 6. Session History (Account → Usage History)

**GET** `/api/usage/sessions?limit=50`

**Response**

```json
[
  {
    "session_id": "uuid",
    "session_start": "2026-02-06T10:14:00Z",
    "duration_seconds": 842,
    "turns": 17,
    "credits_used": 210
  }
]
```

## 7. Session Drill-Down

**GET** `/api/usage/sessions/{session_id}`

**Response**

```json
{
  "session_id": "uuid",
  "events": [
    {
      "created_at": "2026-02-06T10:14:12Z",
      "intent": "code",
      "model": "gpt-4.1",
      "tokens_in": 1200,
      "tokens_out": 430,
      "credits_used": 14,
      "latency_ms": 880,
      "success": true
    }
  ]
}
```

## 8. Per-Model Cost Summary (User)

**GET** `/api/usage/cost/models`

**Response**

```json
[
  {
    "model": "gpt-4.1",
    "requests": 84,
    "credits_used": 940,
    "total_cost_usd": 12.4387
  },
  {
    "model": "gpt-4.1-mini",
    "requests": 210,
    "credits_used": 600,
    "total_cost_usd": 3.1021
  }
]
```

## 9. Daily Per-Model Burn

**GET** `/api/usage/cost/models/daily?days=14`

**Response**

```json
[
  {
    "day": "2026-02-01",
    "model": "gpt-4.1",
    "requests": 10,
    "credits_used": 110,
    "cost_usd": 1.4021
  }
]
```

## 10. Plan & Quota State

**GET** `/api/usage/quota`

**Response**

```json
{
  "plan": "pro",
  "monthly_credits": 5000,
  "normalized_credits_used": 2875,
  "usage_ratio": 0.575
}
```

## 11. Routing Decision (internal helper)

**POST** `/api/router/decide`

**Purpose:** Decide which model to use.

**Access:** Internal only.

**Request**

```json
{
  "intent": "code",
  "requested_model": "gpt-4.1"
}
```

**Response**

```json
{
  "routed_model": "gpt-4.1-mini",
  "reason": "quota_fallback"
}
```

## 12. Routing Decision Log (Admin / Debug)

**GET** `/api/admin/routing/decisions?limit=100`

**Response**

```json
[
  {
    "created_at": "2026-02-06T10:15:02Z",
    "user_id": "uuid",
    "intent": "code",
    "requested_model": "gpt-4.1",
    "routed_model": "gpt-4.1-mini",
    "reason": "quota_fallback",
    "plan": "pro"
  }
]
```

## 13. Cost Anomaly Alerts (Ops)

**GET** `/api/admin/anomalies`

**Response**

```json
[
  {
    "id": "uuid",
    "user_id": "uuid",
    "anomaly_type": "runaway_session",
    "severity": "critical",
    "observed_value": 6.12,
    "context": {
      "session_id": "uuid"
    },
    "created_at": "2026-02-06T11:02:00Z"
  }
]
```

**Acknowledge Alert**

**POST** `/api/admin/anomalies/{id}/acknowledge`

**Response**

```json
{ "ok": true }
```

## 14. Security & Contract Rules

- `user_id` never accepted from client.
- Admin routes behind role-based access.
- Analytics endpoints are read-only.
- Event ingestion is write-only.
- No endpoint mutates historical usage data.

## 15. Contract Invariants

- One usage event = one model invocation.
- Costs derived only from `usage_events` + `model_pricing`.
- Credits shown to users are normalized.
- Routing decisions are explainable.
- Alerts are auditable.
