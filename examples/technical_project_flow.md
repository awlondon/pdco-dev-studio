# End-to-End Flow: Technical Project to Scaffold + Docs

## Scenario
A team requests a technical starter project with architecture and API contract docs.

## Steps
1. User provides stack preference and non-functional requirements.
2. OLL generates a scaffold task packet with explicit success criteria.
3. OpenClaw scaffolds folders/files and writes protocol docs.
4. Result is committed and returned as a structured `ResultPacket`.

## Expected outputs
- `src/` scaffold
- `docs/architecture.md` updates
- `docs/protocols.md` updates
- `schemas/` aligned with updated contracts

## Referenced payloads
- `examples/payloads/technical.taskpacket.json`
- `examples/payloads/technical.resultpacket.json`
