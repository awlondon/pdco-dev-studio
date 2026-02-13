# End-to-End Flow: Business Idea to Repository + Landing Page

## Scenario
A founder describes a new product idea in chat and wants a repo scaffold plus a simple landing page.

## Steps
1. User shares idea, target audience, and must-have constraints.
2. OLL emits a `TaskPacket` to create docs + static landing page artifacts.
3. OpenClaw creates files, validates structure, and commits.
4. OpenClaw returns `ResultPacket` with changed paths and summary.

## Expected outputs
- `README.md` refined to business pitch
- `docs/value-proposition.md`
- `site/index.html` static landing page
- queue + run log updates

## Referenced payloads
- `examples/payloads/business.taskpacket.json`
- `examples/payloads/business.resultpacket.json`
