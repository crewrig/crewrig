# Runbook — the four-target extension hook probe

<!-- crewrig-doc: published=false -->

Spec 0179 (issue #1005) requires the neutral hook vocabulary's per-target
correspondence to be evidence-backed (R4, R5) rather than written by analogy
— 0065 delta-01 R12 forbids exactly that for the Copilot column, whose
plugin-level hook surface was ungrounded at spec-authoring time. This runbook
is the re-runnable procedure that grounds it, and re-grounds the other three
targets from the installed tool rather than trusted vendor prose.

`scripts/probe-extension-hooks.sh` is the procedure.

## Running it

```sh
bash scripts/probe-extension-hooks.sh
```

Preconditions: `claude`, `gemini`, `agy` and `copilot` all on `PATH`, each
authenticated. The Copilot arm spends real AI credits on one live
tool-invoking turn (a few seconds; well under a cent). Not a CI gate (spec
0179 -> Risk R5): all four CLIs must be installed, so this runs locally,
deliberately, by a human or an agent — never in the `extension-render`
workflow job.

## Why a live functional test for Copilot, and static evidence for the rest

Claude Code, Gemini CLI and Antigravity CLI are already grounded by spec
0179's own authoring-time probe (its Notes -> "Probe record" table). Re-
running that grounding does not require exercising the tool live — Claude's
and Antigravity's own embedded reference material (a Mach-O binary's
embedded skill text; a bundled `docs/hooks.md`) is read directly from disk,
the same evidence-from-the-installed-tool method the original probe used.
Gemini's method (documentation shipped in the installed bundle, plus the
bundle's own extension-hook loader) does not survive minification as a
plain-text grep, so its probe arm records the version and points back at the
authoring-time grounding rather than re-deriving it byte by byte.

Copilot is different in kind, not degree: `0065-copilot-plugin-build.md`'s
`hooks.json`-at-the-output-root shape "was written by analogy with the
Antigravity plugin layout, not from a probe of the Copilot CLI," and the
authoring probes could not close that gap either — "the installed binary
... yields no readable hook strings, and the one installed plugin ... 
declares no hook." No amount of static reading settles whether a
plugin-level hook surface exists at all. Only running one actually fire does.

## What the Copilot arm does

1. Writes a synthetic plugin at **two** candidate placements —
   `hooks.json` at the plugin root (Antigravity's convention) and
   `hooks/hooks.json` in a subdirectory (Claude/Gemini's convention) — using
   the **same envelope shape already grounded** for the user-level manifest
   (`hooks/copilot-transcript-hooks.json`): `{"version": 1,
   "disableAllHooks": false, "hooks": {"preToolUse": [...]}}`.
2. Loads both via the documented `--plugin-dir` flag (`copilot --plugin-dir
   <dir> plugin list` confirms `--plugin-dir` mounts a local, uncommitted
   plugin directory for a session — no marketplace or GitHub registration
   needed, so the probe touches no external state).
3. Runs **one** live, non-interactive, tool-invoking session (`copilot -p
   "Run the shell command: echo ..." --allow-all-tools`) and checks a
   side-channel log file the candidate hook commands append to.
4. Classifies the outcome per the plan's four-way branch:
   - **B1A** — a surface exists and the intersection with the other three
     targets' grounded events is non-empty. **The only outcome that
     proceeds.**
   - **B1B** — a surface exists but no event corresponds to any of the
     other three targets' events.
   - **B2** — absence is positively demonstrated.
   - **B3** — inconclusive; re-run, do not record an absence.

Once B1A is confirmed, the script runs three follow-up live checks reusing
the same `--plugin-dir` mechanism: the extension-root form (does a path
variable exist, and what is it named?), the matcher form (does a `matcher`
field filter by tool name, and is it a regex or an exact string?), and the
shell tool's own name.

## Results

### 2026-08-25 — `claude` 2.1.241, `gemini` 0.46.0, `agy` 1.1.19, `copilot` 1.0.80 (self-reported) / 1.0.49 (resolved binary), macOS (arm64)

Two independent runs (the second after fixing a `pipefail`/`SIGPIPE` false
negative in the Claude arm — see *A methodological note* below), identical
verdicts both times.

**Claude Code.** The installed binary's own embedded reference text (`strings
-a` on the resolved Mach-O executable) carries a `## Hooks Configuration`
section verbatim, confirming:
- **Envelope confirmed**: `{"hooks": {"EVENT_NAME": [{"matcher": ...,
  "hooks": [{"type": "command", "command": ..., "timeout": ...}]}]}}` — the
  incumbent `build-claude-plugin.sh:213` shape (`{"hooks": $CLAUDE_HOOKS}`)
  is **confirmed from the installed tool**, not merely inherited. This
  settles the R9 divergence step 1 named: spec 0179's own probe-record cell
  ("no envelope") does not survive a fresh read of the installed binary.
- Full event set carried in the embedded doc: `PermissionRequest`,
  `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `Notification`, `Stop`,
  `PreCompact`, `PostCompact`, `UserPromptSubmit`, `SessionStart` (a superset
  of spec 0179's grounded `PreToolUse`/`UserPromptSubmit` pair).
- Matcher: tool name, exact or alternation (`Bash|Write|Edit`); shell tool
  is `Bash`.
- Root token: `CLAUDE_PLUGIN_ROOT` confirmed present as a literal string in
  the binary, alongside the note "Path placeholders like
  `${CLAUDE_PLUGIN_ROOT}` are substituted per-element as plain strings" —
  i.e. the CLI's own templating, not a shell environment variable.
- Time unit: still **ungrounded** — the embedded doc shows `"timeout": 60`
  inline but never states the unit. No new evidence to overturn spec 0179's
  existing "not formalized in the schema" finding; R10 still applies (a
  declared time limit on Claude emits nothing rather than a guessed
  conversion).

**Gemini CLI.** Version 0.46.0 matches the spec's own grounded record
exactly. The installed bundle (`.../gemini-cli/0.46.0/.../bundle/gemini.js`)
is minified — a plain-text grep for event tokens (`BeforeTool`,
`extensionPath`, ...) found nothing, confirming this arm is not
byte-re-derivable and the spec's existing authoring-time grounding (method:
"documentation shipped in the installed bundle, plus the bundle's own
extension-hook loader") stands as the record of record. The repository's own
committed `hooks/gemini-transcript-hooks.json` independently corroborates
the shape (envelope, event keys `BeforeTool`/`BeforeAgent`/`AfterTool`/
`AfterModel`/`SessionEnd`, no `matcher` key when match-all is intended).

**Antigravity CLI.** Version 1.1.19 matches the spec's own grounded record
exactly. `~/.gemini/antigravity-cli/builtin/skills/agy-customizations/docs/hooks.md`
confirms, verbatim: no path variable ("The working directory is set to the
directory containing `hooks.json`"), timeout in seconds with a default of 30,
matcher is "a regex" over tool names, tool events (`PreToolUse`/
`PostToolUse`) are grouped under a `matcher`+`hooks` wrapper while lifecycle
events (`PreInvocation`/`PostInvocation`/`Stop`) are flat. Exactly the
spec's existing Notes record; no divergence.

**GitHub Copilot CLI — the R12 branch point. Verdict: B1A.**

| Placement | Fired? |
|---|---|
| `hooks.json` at plugin root | **yes** |
| `hooks/hooks.json` (subdirectory) | **yes** |

Both candidate placements fired for a `preToolUse` hook using the
already-grounded user-level envelope shape, loaded via `--plugin-dir` with no
marketplace registration. A deep-nested placement (`foo/bar/hooks.json`) did
**not** fire, so this is not a recursive filename scan — the CLI checks (at
least) these two fixed locations. The render targets `hooks.json` at the
plugin root as the single canonical delivery path (mirroring Antigravity's
convention, and the simpler of the two to keep the translator's per-target
branching small); the subdirectory form's also firing is recorded here as a
secondary finding, not exercised by the render.

Follow-up live checks, all against the SAME confirmed-firing plugin:

- **Root token**: `$COPILOT_PLUGIN_ROOT` is exported into the hook command's
  environment, equal to the plugin's own directory (`CWD=<plugin-dir>
  ROOT=<plugin-dir>`, captured live). Unlike Claude's per-element string
  substitution, this is a **real shell environment variable** the CLI
  exports before invoking the command through a shell — but the render's
  job is the same either way: emit the literal text `${COPILOT_PLUGIN_ROOT}`
  in place of the neutral extension-root token, and let the target resolve
  it at its own execution time.
- **Matcher form**: `matcher: "no-such-tool-xyz"` did **not** fire;
  `matcher: "bash"` **did** fire; `matcher: ".*"` fired unconditionally.
  Regex over tool names, same family as Gemini and Antigravity. Shell tool
  identifier: **`bash`** (lowercase) — `matcher: "shell"` (the string shown
  in Copilot's own `--allow-tool='shell(git:*)'` permission-flag examples)
  did **not** match, so the permission-flag vocabulary and the hook-matcher
  vocabulary are NOT the same tool-name space; only the internal identifier
  `bash` matches.
- **Match-all default**: omitting `matcher` entirely fires the hook for
  every tool (observed in the first firing test, no `matcher` key present).
- **Structural form**: FLAT — `hooks.<eventName>` is an array of handler
  objects, each carrying its own optional `matcher` inline (unlike
  Claude/Gemini/Antigravity, which group multiple handlers under one
  `matcher`+`hooks` wrapper object per matcher value).
- **Time unit**: **seconds**, confirmed by two consistent data points —
  `timeout: 1` with a 3-second sleep was killed before completion;
  `timeout: 2000` with the same 3-second sleep was NOT killed. Only the
  seconds interpretation is consistent with both (a milliseconds reading of
  `2000` would also have killed a 3-second sleep). Same unit as Antigravity;
  the render's canonical unit (seconds) needs no conversion for Copilot.

Positive control: `echo hello-world` via the shell tool succeeded in every
run, confirming the model/session itself was healthy throughout (a failed
hook is not attributable to a broken session).

### A methodological note — a `pipefail`/`SIGPIPE` false negative, caught before shipping

The first run of this script's Claude arm reported the R9 envelope check as
"INCONCLUSIVE" despite the installed binary demonstrably carrying the
envelope string (confirmed independently with a direct, non-piped `grep -c`:
10 occurrences). Root cause: the script piped `strings -a "$BIN" | grep -q
'"hooks": {'` directly. `grep -q` exits the instant it finds its first
match, closing its end of the pipe; under `set -o pipefail`, `strings` — now
writing into a closed pipe — dies of `SIGPIPE` and exits non-zero, and
`pipefail` reports that non-zero exit for the whole pipeline even though
`grep` itself matched and would have reported success alone. The `if
pipeline; then` branch reads the pipeline's status, not `grep`'s, so a real
match was scored as "not found." Fixed by snapshotting `strings`' output to
a temp file first and running `grep -q` against the file — never against a
live pipe whose reader can exit early. The lesson generalizes: any `if cmd1
| grep -q ...; then` under `pipefail` is unsafe whenever `cmd1` can produce
output after `grep`'s first match.

### Recording a new run

Append a dated section above rather than editing an existing one.
