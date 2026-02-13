# OpenClaw Orchestrator Protocols

## Packet contracts

The orchestrator uses four primary contracts:
- `ConversationEvent`
- `ProjectState`
- `TaskPacket`
- `ResultPacket`

Canonical JSON Schemas live in `/schemas`.

## Lifecycle

1. **Conversation intake**
   - UI emits `ConversationEvent` (`user`, `assistant`, `system`, or `tool`).
2. **Planning/state sync**
   - OLL updates `ProjectState` and determines next executable action.
3. **Execution dispatch**
   - OLL emits `TaskPacket` with clear goal, constraints, and success criteria.
4. **Execution + result**
   - OpenClaw returns `ResultPacket` with status and artifacts.
5. **Audit + closure**
   - System appends run details to `/ops/runlog.ndjson`.
   - Queue record is marked complete (or failed with reason).

## Queue protocol (`/ops/queue.ndjson`)

Each line is an independent JSON object with a stable `task_id`.

Required operational fields:
- `task_id` (string)
- `status` (`pending` | `in_progress` | `completed` | `failed`)
- `goal` (string)
- `constraints` (object)
- `success_criteria` (array of strings)

## Run log protocol (`/ops/runlog.ndjson`)

Append-only JSON lines that capture task lifecycle events.

Recommended fields:
- `ts` (ISO8601)
- `type` (e.g., `task.started`, `task.completed`, `task.failed`)
- `task_id`
- `by` (`codex` / `openclaw`)
- `summary`
- `artifacts` (array of paths)

## Failure handling
- Preserve partial outputs and record exact failure reasons.
- Avoid destructive rollback unless explicitly requested.
- Create follow-up queue tasks for retries or scope reduction.
