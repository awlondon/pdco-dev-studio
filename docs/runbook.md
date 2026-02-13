# OpenClaw Runbook

## Execution workflow
1. Read `README.md`, `docs/architecture.md`, and `docs/protocols.md`.
2. Inspect `/ops/queue.ndjson` for oldest `pending` task.
3. Execute task in minimal safe scope.
4. Append `task.completed` or `task.failed` to `/ops/runlog.ndjson`.
5. Append completion/failure status entry for the same task in `/ops/queue.ndjson`.
6. Commit changes atomically.

## Logging format (NDJSON)
- One JSON object per line.
- Never mutate historical lines.
- Use ISO8601 UTC timestamps.
- Include `task_id`, `type`, `summary`, and changed `artifacts` when available.
