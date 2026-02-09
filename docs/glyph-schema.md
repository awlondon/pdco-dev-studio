# Glyph schema v1

This document defines the formal glyph schema used to encode intent, state, constraints, and routing metadata in a compact, token-optimized surface form. The JSON schema is authoritative. Glyphs are a lossy projection that remain reversible to JSON.

## Design principles (non-negotiable)

- Glyphs encode **state**, not instructions.
- JSON is the source of truth.
- Glyph surface form is a lossy projection.
- Every glyph is reversible (→ JSON).
- Deltas override; never restate.

## Canonical JSON schema (machine layer)

This is the authoritative representation used internally and stored with artifacts/sessions.

```json
{
  "schema": "glyph.v1",
  "intent": {
    "primary": "code | text | mixed",
    "confidence": 0.0
  },
  "state": {
    "mode": "new | iterate | refactor | debug | extend",
    "artifact_bound": true
  },
  "scope": {
    "runtime": "browser | node | python | unknown",
    "files": "single | multi",
    "framework": "none | react | vue | vanilla"
  },
  "constraints": {
    "hard": [
      "runnable",
      "no-build",
      "single-file"
    ],
    "soft": [
      "performance",
      "accessibility"
    ]
  },
  "style": {
    "verbosity": "none | low | normal | high",
    "tone": "technical | neutral | explanatory",
    "comments": "none | minimal | normal"
  },
  "output": {
    "format": "code | explanation | code+brief",
    "completeness": "partial | full"
  },
  "continuity": {
    "session_summary_hash": "sha256",
    "code_version_id": "uuid",
    "delta_from_previous": true
  },
  "routing": {
    "model_class": "cheap | standard | premium",
    "latency_bias": "low | balanced | quality"
  }
}
```

### Notes

- All fields are optional except `schema`.
- Missing fields imply inheritance from previous state.
- This is never sent verbatim to the LLM every turn.

## Glyph surface form (token-optimized projection)

This is what gets prepended to prompts. Each line is a semantic dimension.

```
⟁INTENT:CODE
⟲STATE:ITERATE
⌬SCOPE:BROWSER|SINGLE
∆HARD:RUNNABLE,NO_BUILD
ψSTYLE:TECHNICAL|LOW
ΩOUT:CODE_ONLY
```

## Glyph dictionary (strict mapping)

### Intent

| JSON | Glyph |
| --- | --- |
| `"intent.primary": "code"` | `⟁INTENT:CODE` |
| `"intent.primary": "text"` | `⟁INTENT:TEXT` |
| `"intent.primary": "mixed"` | `⟁INTENT:MIXED` |

### State

| JSON | Glyph |
| --- | --- |
| `"state.mode": "new"` | `⟲STATE:NEW` |
| `"state.mode": "iterate"` | `⟲STATE:ITERATE` |
| `"state.mode": "refactor"` | `⟲STATE:REFACTOR` |
| `"state.mode": "debug"` | `⟲STATE:DEBUG` |
| `"state.mode": "extend"` | `⟲STATE:EXTEND` |

### Scope

`⌬SCOPE:<RUNTIME>|<FILES>|<FRAMEWORK?>`

Examples:

```
⌬SCOPE:BROWSER|SINGLE
⌬SCOPE:NODE|MULTI|REACT
```

### Constraints

Hard constraints (must not be violated):

```
∆HARD:RUNNABLE,NO_BUILD,SINGLE_FILE
```

Soft preferences:

```
∆SOFT:PERF,ACCESSIBILITY
```

### Style

`ψSTYLE:<TONE>|<VERBOSITY>|<COMMENTS?>`

Examples:

```
ψSTYLE:TECHNICAL|LOW
ψSTYLE:NEUTRAL|NONE
```

### Output control

```
ΩOUT:CODE_ONLY
ΩOUT:CODE+BRIEF
ΩOUT:EXPLANATION
```

### Routing hints (optional, internal)

```
λMODEL:CHEAP
λLATENCY:LOW
```

> These are never shown to users.

## Delta glyphs

Only emit glyphs when something changes.

### Example progression

Initial turn:

```
⟁INTENT:CODE
⟲STATE:NEW
⌬SCOPE:BROWSER|SINGLE
∆HARD:RUNNABLE
ψSTYLE:TECHNICAL|LOW
ΩOUT:CODE_ONLY
```

Later turn:

```
⟲STATE:ITERATE
∆SOFT:ACCESSIBILITY
```

No repetition beyond changes.

## How glyphs are injected into prompts

Prompt structure:

```
<System (once)>
You will receive compact glyph headers encoding intent, state, constraints, and style.
Treat them as authoritative context. Do not explain them unless asked.

<Glyph Header>
⟲STATE:ITERATE
∆SOFT:ACCESSIBILITY

<User>
Add keyboard controls.
```

## Storage & artifact lineage

Each artifact version stores:

```json
{
  "glyph_state": { "...full JSON...": true },
  "glyph_delta": "⟲STATE:ITERATE",
  "applied_at": "2026-02-09T06:45:17Z"
}
```

This provides:

- Explainable evolution.
- Reproducibility.
- Minimal replay cost.

## Failure safety

If glyph parsing fails:

- Ignore glyphs.
- Fall back to natural language.
- Never block execution.

Glyphs must be additive, not brittle.
