# Roadmap

## Near-term
1. Add schema validation automation in CI for all files under `/schemas`.
2. Add a lightweight `/src` orchestrator scaffold and packet parser utilities.
3. Add deterministic replay examples using `/ops/queue.ndjson` + `/ops/runlog.ndjson`.

## Next-step proposal
- Implement `npm run validate:schemas` using AJV CLI and gate pull requests on schema correctness.
