# ADR 0007 — GenIA Quality Sentinel Hook

## Status

Proposed — 2026-05-25.

## Context

CrewRig relies on manual friction reporting via the `harness-report` skill to drive continuous improvement (Pillar #4 of `AGENTS.md`). While effective for overt failures, many subtle quality issues — such as "vibe coding" drift, inefficient prompting patterns, or suboptimal reasoning — go unreported because they do not trigger a hard error or immediate user frustration.

We need a "GenIA Quality Sentinel": a silent observer that monitors every interaction and intervenes only when it detects friction or quality degradation. This sentinel must run at the conclusion of an AI response (conceptually linked to the `STOP` event).

## Decision

Implement the **GenIA Quality Sentinel** using **System Prompt Injection (SPI)** instead of an external shell-script hook.

### Mechanism

The sentinel consists of a dense, high-authority instruction set injected into the global system context via `.gemini/` and `.claude/` configuration files. 

1. **Self-Audit**: The model is instructed to evaluate its own preceding turn and the user's reaction against established project principles (KISS, TDD, Expert-level sparring).
2. **Silence by Default**: The sentinel is strictly forbidden from producing output unless a friction threshold is breached.
3. **Structured Intervention**: When friction is detected (e.g., user immediately correcting a previous turn, or the AI failing to provide a simple solution), the sentinel emits a structured suggestion or a friction-tag proposal directly in the chat.

### Why System Prompt Injection?

- **Zero Latency**: External shell hooks (like those in `hooks/claude-transcript-hooks.json`) would require spawning a secondary LLM process or re-parsing history, introducing significant round-trip delay. SPI leverages the existing inference turn.
- **Chat Continuity**: By living within the system prompt, the sentinel's findings are part of the conversation history. This makes them immediately actionable for the next turn and ensures they are recorded in MemPalace transcripts without additional machinery.
- **Contextual Depth**: The model has immediate access to the full KV cache of the current session, allowing for a more nuanced semantic analysis of "friction" than an external regex-based script could provide.

## Alternatives Considered

### A. External Script Hook (`hooks/genia-sentinel.sh`)
Trigger a script on the `STOP` event to analyze the transcript.
- **Pro**: Zero token tax on the main prompt; complete isolation.
- **Con**: High latency; difficult to inject results back into the active chat session; breaks "silent sentinel" feel if it requires an external UI or log window.

### B. Batch Transcript Curation
Analyze transcripts asynchronously using the `harness-curator` skill.
- **Pro**: Zero impact on real-time performance.
- **Con**: Feedback is disconnected from the moment of friction. Users cannot benefit from immediate course correction.

## Consequences

### Positive
- **Automated Quality Guardrails**: Constant, background monitoring of interaction quality.
- **High-Signal Feedback**: Automatically surfaces potential friction points that a human might ignore.
- **Symmetric Deployment**: SPI works identically across Gemini CLI and Claude Code through the shared `.gemini/` and `.claude/` context layers.

### Negative / Trade-offs
- **Token Overhead**: Every turn carries the sentinel instructions. **Mitigation**: The sentinel prompt must be extremely concise, using AAAK-style compression or dense technical English.
- **Output Pollution**: Risk of the model "leaking" sentinel thoughts into regular answers. **Mitigation**: Aggressive negative constraints and strong "Silence by Default" grounding in the instruction set.
- **Context Competition**: On smaller models, the sentinel might compete for attention with the main task instructions.

## Blast Radius

- **`.gemini/` and `.claude/` bundles**: Must be updated to include the sentinel prompt instructions.
- **`community-config/skills/harness-report/`**: Potential integration to allow the sentinel to auto-fill friction reports.
- **`docs/cli-matrix.md`**: New entry to track sentinel support and parity across CLIs.

## Risks

1. **Noise**: Over-sensitive detection could annoy the user. Mitigation: Strict thresholding in the sentinel instructions.
2. **Instruction Following**: Weak models might ignore the "Silence by Default" constraint. Mitigation: Sentinel activation should be gated by model capability (Expert/Confirmed levels).

## Sources

- `AGENTS.md` — Pillar #4: Harness engineering.
- `hooks/claude-transcript-hooks.json` — existing CLI hook patterns.
- `community-config/skills/harness-report/SKILL.md` — friction reporting protocol.
