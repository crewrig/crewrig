---
id: "0152"
slug: record-agent-turn-summary-in-transcript-hook
status: draft
complexity: small
interaction-mode: AUTO
related-issue: 757
version: 1.0.0
---

# Agent Turn Summary Transcript Hook Protocol

## Intent

Enhance `hooks/mempalace-transcript.sh` to extract and record assistant turn summaries and tool calls on session `Stop` events rather than storing a static constant marker.

## Requirements

1. **Transcript path inspection.** `hooks/mempalace-transcript.sh` SHALL read `transcript_path` / `transcriptPath` from the stdin payload during `Stop` / `agent-response` event handling.
2. **Turn summary extraction & capping.** When a valid JSONL transcript log exists, the hook SHALL extract the most recent assistant response text or tool call names, truncate the content to a maximum byte cap of 500 bytes, and format `CONTENT` as `[AGENT] <summary>`.
3. **Fallback guarantee.** If `transcript_path` is missing, unreadable, or empty, the hook SHALL preserve `CONTENT="[AGENT] Session turn completed"`.
4. **Performance boundary.** Transcript parsing SHALL complete within the hook's existing execution time budget without exceeding process timeouts.

## Scenarios

### Scenario 1: Stop event with transcript log available

- **GIVEN** a session turn completing with `transcript_path` pointing to a valid transcript JSONL file
- **WHEN** `hooks/mempalace-transcript.sh` handles the `Stop` event
- **THEN** it extracts the last assistant turn summary (up to 500 bytes) and stores `[AGENT] <summary>` in MemPalace.

### Scenario 2: Stop event without transcript log

- **GIVEN** a session turn completing with no `transcript_path` in payload
- **WHEN** `hooks/mempalace-transcript.sh` handles the `Stop` event
- **THEN** it falls back to `[AGENT] Session turn completed`.

## Out of scope

- Re-enabling `PostToolUse` per-tool-call writes.
- Modifying MemPalace storage schema or server interface.

## Open questions

- None.
