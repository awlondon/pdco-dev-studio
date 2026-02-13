# OpenClaw Orchestrator Architecture

## Purpose

The orchestrator turns live conversations into committed repository artifacts (documentation, code, and web assets) through structured execution packets.

## High-level system

```text
Conversation Front-End (CFE)
  ⇄ Orchestration Logic Layer (OLL)
    ⇄ OpenClaw Executor
      ⇄ GitHub + External APIs
```

## Components

### Conversation Front-End (CFE)
- Captures user intent, constraints, and context.
- Streams normalized conversation events to OLL.
- Displays execution status and produced artifacts.

### Orchestration Logic Layer (OLL)
- Converts conversation events into `TaskPacket` units.
- Maintains `ProjectState` for goal, constraints, and execution history.
- Schedules tasks with safe defaults (idempotent operations, minimal scope).

### OpenClaw Executor
- Executes packet instructions using terminal and API actions.
- Produces `ResultPacket` outputs with status, artifacts, and logs.
- Enforces guardrails (no secrets, no unsafe/public operations unless approved).

### GitHub + External APIs
- Stores persistent artifacts in version control.
- Provides deployment/build/test integrations where explicitly approved.
- Returns execution metadata back into run logs.

## Data flow
1. CFE emits `ConversationEvent`.
2. OLL updates `ProjectState`.
3. OLL emits `TaskPacket` to OpenClaw.
4. OpenClaw executes and returns `ResultPacket`.
5. OLL persists artifacts + updates `/ops/runlog.ndjson` and task status.

## Reliability and safety
- Prefer atomic tasks and small commits.
- Keep an append-only audit trail in `/ops/runlog.ndjson`.
- Mark task lifecycle explicitly in `/ops/queue.ndjson`.
- Document assumptions in `/docs/decisions.md` when uncertainty exists.
