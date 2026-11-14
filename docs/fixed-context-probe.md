# Fixed-context probe

<!-- crewrig-doc: published=false -->

Measures the fixed context a Claude Code worker session and a `developer` subagent carry on their first API call, and compares it with the ADR-0025 targets ([ADR-0025](adr/0025-slim-the-fixed-context-of-worker-and-subagent-sessions.md), appendix; issue #1994).

## Cost: paid, manual, never in CI

A probe run makes one main call and one subagent call (about 0.3 USD). It is wired in no workflow and not in `ci:pre-push`, and the script refuses (exit 3) when `CI` is set. The free mode below reads an existing session instead.

## Usage

```sh
task fixed-context-probe                                    # baseline, paid
task fixed-context-probe -- --settings <worker-profile.json> # measure the #1988 worker profile, paid
task fixed-context-probe -- --session <id> --warn-only       # free: read an existing session
task test-fixed-context-probe                                # unit suite, fixture transcripts, no model call
```

Options: `--settings <file>`, `--model <id>` (default `claude-sonnet-5-5`), `--cwd <dir>`, `--threshold-file <file>`, `--session <id>` or `--transcript <file>` (free), `--warn-only`.

Method: `claude -p --output-format json --allowedTools Agent` with a prompt that calls the `developer` agent once; the first-call input tokens (input + cache read + cache creation of the first `assistant` line) are read from `~/.claude/projects/<project>/<session>.jsonl` and `<session>/subagents/*.jsonl`. The probe never edits `~/.claude/` or the repository's `.claude/`.

## Threshold

`scripts/fixed-context-threshold.json` holds the ADR targets: worker 40,000, subagent 30,000 tokens. A breach exits 1 (`FAILED:` lines on stderr); `--warn-only` prints `WARN:` and exits 0. Failing is the default because the probe is manual and paid: it is never a merge gate, so a breach is a signal to act on, not a blocked PR. Until the worker profile of #1988 is passed with `--settings`, the unslimmed baseline (about 73k and 59k) breaches both limits by design.

## CLI parity

Claude Code only. This is a measurement tool, not a CLI integration point (no deploy target, hook, setting or build output changes), so the cli-matrix is unchanged. Copilot CLI exposes only a rounded `↑ <N>k` line (ADR-0025 appendix C1 to C5, no transcript token fields); Gemini CLI and Antigravity CLI could not be probed (appendix G1, A1).
