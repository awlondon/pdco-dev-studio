# PDCo Dev Studio performance + completeness plan

## Current architecture snapshot

### Runtime surfaces
- **Primary product surface is still the legacy single-page app (`index.html` + `app.js`)** with an integrated chat/editor/preview workspace and account/gallery UX.
- **React/Vite app exists but is scaffold-level** (`pdco-frontend/src/App.jsx`) and currently only displays setup text + API URL.
- **Backend API is a single large Express service (`server.js`)** that owns auth/session, chat routing, artifact CRUD, reporting, usage analytics, billing entry points, and session export/state APIs.

### Where state lives today
- **UI runtime state:** primarily in in-memory globals in `app.js` (chat/session/runtime/gallery/profile/agent state).
- **Client persistence:**
  - `localStorage` for agent FSM persistence via `core/persistence.js`.
  - IndexedDB + in-memory fallbacks for session/code timeline paths in `app.js`.
- **Server persistence:**
  - Postgres first (`USER_STORE_DRIVER=postgres`) with CSV/file fallback modes documented in README.
  - Session snapshots via `/api/session/state*` backed by DB `sessions` table when available, otherwise JSON files under `data/session_state`.
  - Artifacts + versions + reports in DB through `utils/artifactDb.js`.

### Preview embedding + execution model
- Preview is an **iframe sandbox (`sandbox="allow-scripts"`)** mounted in the legacy UI.
- Runs are executed by writing generated HTML into `iframe.srcdoc` through `sandboxController.js`.
- The current workflow often **recreates the iframe for reruns** (`resetSandboxFrame`) and waits for iframe readiness before injection, which is likely a responsiveness hot path.

### Agent simulation architecture
- Client side has an app-level agent state machine (`core/appStateMachine.js`) and sync manager (`agent/syncManager.js`).
- Server side exposes run/event/findings routes in `agent/routes.js` and deterministic checks in `agent/simulatedRunner.js`.
- Current `agent/routes.js` includes duplicate/overlapping route declarations and mixed auth patterns, indicating correctness + maintainability risk.

### Persistence/export/artifact + bug reporting
- Session export endpoint exists (`/api/session/export/:sessionId`) with usage-derived payloads.
- Artifact reporting endpoint exists (`POST /api/artifacts/:id/report`) and persists through `createArtifactReport`.
- Admin artifact reports endpoint currently returns an empty placeholder response.

## Likely slow paths (prioritized)
1. **Massive monolith parse/execute cost in `app.js` (~11k LOC)** and direct DOM mutation across multiple responsibilities.
2. **Preview reset strategy recreates iframe frequently**, likely causing cold-load + layout/reflow overhead.
3. **Potential over-persistence frequency** for session/agent state (localStorage + DB/file snapshots) in hot interaction loops.
4. **Agent route duplication and event polling paths** can produce redundant DB queries and unexpected request volume.
5. **Insufficient explicit performance budgets/tests** in CI scripts (no TTI/frame/p95 API budgets currently enforced).

---

## 30–90 minute execution units

> Conventions:
> - Duration estimates are active coding time.
> - Commands assume repo root.

### P0 — responsiveness + correctness foundations

#### Task 1 (45m): Add baseline perf instrumentation for editor + preview run cycle
- **Files:** `app.js`, `sandboxController.js`, `utils/logger.js` (or browser console fallback if server log plumbing is deferred)
- **Changes:**
  - Add `performance.mark/measure` around: Monaco ready, user edit debounce flush, run button click, iframe ready, srcdoc injection complete.
  - Emit normalized metric objects (`name`, `durationMs`, `sessionId`, `runSource`).
- **Commands:**
  - `npm start`
  - `node --test tests/editor-manager.test.js`
- **Acceptance criteria:**
  - Can capture 10-run median for preview cycle without manual stopwatch.
  - Metrics visible in browser devtools and optionally API logs.

#### Task 2 (60m): Stop full iframe recreation on every run; add reusable preview document path
- **Files:** `app.js`, `sandboxController.js`
- **Changes:**
  - Replace `resetSandboxFrame` full teardown with warm iframe reuse where safe.
  - Add hard reset fallback only for sandbox failure states.
- **Commands:**
  - `npm start`
  - `node --test tests/playable-wrapper.test.js tests/editor-manager.test.js`
- **Acceptance criteria:**
  - Median “Run Code” latency improves by >=20% on local sample page.
  - No regression in pause/resume/stop controls.

#### Task 3 (45m): Debounce high-frequency editor-to-runtime reactions
- **Files:** `app.js`, `editorManager.js`
- **Changes:**
  - Gate expensive updates (warnings, stale markers, timeline writes) behind 100–250ms debounce.
  - Avoid duplicate listeners during editor remount.
- **Commands:**
  - `node --test tests/editor-manager.test.js`
- **Acceptance criteria:**
  - Typing remains >50 FPS on representative 400+ line sample.
  - No duplicate event handling after switching views/sessions.

### P0 — agent simulation reliability + throughput

#### Task 4 (75m): Normalize `agent/routes.js` (remove duplicate endpoints, unify auth middleware)
- **Files:** `agent/routes.js`, `server/__tests__/agent.routes.test.js`
- **Changes:**
  - Keep one canonical route per action (`GET/POST /runs`, `/runs/:id/events`, `/runs/:id/cancel`).
  - Ensure auth is consistently enforced and `next()` misuse/structural issues are removed.
- **Commands:**
  - `node --test server/__tests__/agent.routes.test.js tests/agentRunner.test.js`
- **Acceptance criteria:**
  - All existing agent route tests pass.
  - No duplicate route registration in startup logs.

#### Task 5 (60m): Add event polling budget + incremental sync guardrails
- **Files:** `agent/syncManager.js`, `agent/events.js`, `agent/store.js`
- **Changes:**
  - Enforce min poll interval + backoff on idle.
  - Cap events per poll and persist last seen event id atomically.
- **Commands:**
  - `node --test tests/agentRunner.test.js`
- **Acceptance criteria:**
  - 50 concurrent simulated runs stay within DB query budget target (documented baseline vs after).

#### Task 6 (45m): Extend deterministic simulation checks and severity mapping
- **Files:** `agent/simulatedRunner.js`, `tests/agentRunner.test.js`
- **Changes:**
  - Add checks for session revocation, artifact ACL boundaries, and usage admin namespace consistency.
  - Produce stable machine-readable finding codes.
- **Commands:**
  - `node --test tests/agentRunner.test.js`
- **Acceptance criteria:**
  - Runner returns deterministic output across repeated executions.
  - New checks are covered by tests.

### P1 — persistence/export/artifacts + bug reporting completeness

#### Task 7 (60m): Harden `/api/session/state` write frequency + payload size behavior
- **Files:** `app.js`, `server.js`
- **Changes:**
  - Client-side throttling for state sync calls (e.g., 2–5s cadence + on unload).
  - Explicit UI warning when server rejects oversized payloads.
- **Commands:**
  - `node --test tests/api.chat.test.js`
- **Acceptance criteria:**
  - No more than 1 write per throttle window during active typing.
  - Oversize state failure is user-visible and non-fatal.

#### Task 8 (45m): Complete export fidelity (include transcript/code timeline in TXT/MD export)
- **Files:** `app.js`, `server.js`
- **Changes:**
  - Replace placeholder transcript text with actual exported message stream.
  - Add deterministic ordering and metadata headers.
- **Commands:**
  - `node --test tests/api.chat.test.js tests/prompt-building.test.js`
- **Acceptance criteria:**
  - TXT/MD exports include all non-ephemeral messages + version ids.
  - Exported file re-import parity test passes (manual or automated smoke).

#### Task 9 (60m): Implement admin artifact report listing + triage fields
- **Files:** `server.js`, `utils/artifactDb.js`, `data/migrations/` (new migration), optional admin UI hook in `app.js`
- **Changes:**
  - Replace placeholder `/api/admin/artifact_reports` response with real query.
  - Include status (`open/in_review/resolved`), reviewer, timestamps.
- **Commands:**
  - `node --test tests/api.chat.test.js`
  - `node --test tests/migrations.test.js`
- **Acceptance criteria:**
  - Admin endpoint returns paginated persisted reports.
  - Non-admin access returns 403.

### P1 — tests + budgets

#### Task 10 (60m): Introduce explicit performance budgets doc + CI gate script
- **Files:** `docs/performance-budgets.md` (new), `package.json`, `scripts/` (new budget check script)
- **Changes:**
  - Define initial budgets: preview-run p50/p95, `/api/chat` p95, agent events poll QPS, bundle parse budget.
  - Add script to fail CI when benchmark JSON exceeds thresholds.
- **Commands:**
  - `node scripts/check-performance-budgets.js`
- **Acceptance criteria:**
  - Budget script exits non-zero on threshold breach.
  - README or docs link explains how to refresh baselines.

#### Task 11 (45m): Add targeted regression tests for preview lifecycle and export completeness
- **Files:** `tests/editor-manager.test.js`, `ui/tests/*.spec.ts`, `tests/api.chat.test.js`
- **Changes:**
  - Add test for “run without iframe recreation” contract.
  - Add export-content coverage for JSON/TXT/MD.
- **Commands:**
  - `node --test tests/editor-manager.test.js tests/api.chat.test.js`
  - `npm run test:ui`
- **Acceptance criteria:**
  - New tests fail before implementation and pass after.

#### Task 12 (30m): Establish “hot file decomposition” roadmap for `app.js` + `server.js`
- **Files:** `docs/architecture-refactor-map.md` (new)
- **Changes:**
  - Define module boundaries (chat orchestration, preview runtime, artifacts UI, account/billing, agent orchestration).
  - Map each boundary to extraction PRs under 500 LOC touched.
- **Commands:**
  - `wc -l app.js server.js`
- **Acceptance criteria:**
  - Agreed sequence of extraction PRs with clear owners and risk notes.

---

## Suggested rollout order
1. **Tasks 1–4 first** (instrumentation + iframe reuse + route cleanup) to secure immediate perf/correctness wins.
2. **Tasks 5–9 next** for agent throughput and product completeness (export/reporting).
3. **Tasks 10–12 last** to institutionalize budgets and reduce long-term monolith drag.

## Definition of done for the initiative
- Preview run latency and editor responsiveness have measured improvement with tracked baselines.
- Agent run APIs are deterministic, non-duplicative, and load-bounded.
- Export/reporting surfaces are complete and admin-actionable.
- Performance budgets and regression tests prevent backsliding.
