# Performance budgets

This repository enforces **basic performance budgets in CI** to reduce regression risk.

## Budget source of truth

All thresholds live in:

- `config/performance-budgets.json`

Adjust values there when the product intentionally changes and a new baseline is accepted.

## Current budgets

### Bundle size budget

Validated by `node scripts/check-performance-budgets.js` after frontend build.

- Largest JS asset (`pdco-frontend/dist/assets/*.js`) must stay at or below `maxEntryJsBytes`.
- Total JS assets in `pdco-frontend/dist/assets` must stay at or below `maxTotalJsBytes`.
- Total CSS assets in `pdco-frontend/dist/assets` must stay at or below `maxTotalCssBytes`.

### Runtime budget (route transition)

Validated by Playwright test `ui/tests/perf.route-transition.budget.spec.ts`.

- Metric: `route_transition` instrumentation already emitted by app debug logs for `setRoute:pushstate`.
- Flow sampled: `/` -> `/gallery/public` -> `/`.
- Budget check: p95 must be <= `maxP95Ms`.
- Baseline machine: configured in `runtime.routeTransition.baselineMachine` and currently set to `GitHub Actions ubuntu-latest (2 vCPU)`.

## CI behavior

CI fails if either:

1. Bundle-size thresholds are exceeded.
2. Route-transition runtime budget exceeds configured p95 threshold.

## Local commands

From repository root:

```bash
npm run frontend:build
npm run perf:budgets
npm run test:perf-budget
```
