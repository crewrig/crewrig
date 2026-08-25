# Extension hook events

<!-- crewrig-doc: section=reference nav_order=80 published=true title="Extension hook events" -->

The normative correspondence between the neutral extension hook vocabulary
(spec 0179, issue #1005) and each supported command-line tool's own event
names. Every cell states either the target's own event name or an explicit
**no-counterpart** marker — no row is omitted to avoid showing one, and the
vocabulary is never presented as expressible on every target (R5).

This artifact is one of **two independent representations** the R6 agreement
check (`scripts/check-extension-hook-map.sh`) compares: this table, parsed as
data, against `scripts/lib/extension-hooks.sh`'s translation, derived by
actually executing it against a synthetic probe extension. Editing either
side alone turns the check red — see that script's own header for why a
single shared source would make the check vacuous.

## Correspondence table

| Neutral event | Claude Code | Gemini CLI | Copilot CLI | Antigravity CLI |
|---|---|---|---|---|
| `PreToolUse` | `PreToolUse` | `BeforeTool` | `preToolUse` | `PreToolUse` |
| `UserPromptSubmit` | `UserPromptSubmit` | `BeforeAgent` | `userPromptSubmitted` | **no counterpart** |

`PreToolUse` is the maps-everywhere anchor: every supported target expresses
a pre-tool-execution moment (spec 0179 -> Notes). `UserPromptSubmit` is the
maps-partially anchor: Claude, Gemini and Copilot each express a
user-prompt-submission moment; the Antigravity CLI's complete event set
(`PreToolUse`, `PostToolUse`, `PreInvocation`, `PostInvocation`, `Stop`) has
no counterpart for it — "none of them corresponds to a user-prompt
submission or to a session boundary" (spec 0179 -> Notes). Admitting a name
to this closed set requires at least one target to demonstrably expose a
counterpart (R4); no other neutral event has that evidence yet, so the set
stays at these two.

## Neutral tool-class matcher

| Neutral class | Claude Code | Gemini CLI | Copilot CLI | Antigravity CLI |
|---|---|---|---|---|
| `shell` | `Bash` | `run_shell_command` | `bash` | `run_command` |

A matcher is admissible only on an event whose counterpart accepts one on at
least one target (R8); of the two neutral events above, only `PreToolUse` is
matcher-accepting on any target. Omitting the matcher on a matcher-accepting
event renders as each target's own match-all form (R8, second sentence).

## Per-target reference

Each column below records the hook file the target reads for an extension,
the tool version the column was grounded against, the probe method, the time
unit, and the extension-root token form — reconciled against
`scripts/lib/extension-targets.json`, the render's own copy of the same
facts (`scripts/check-extension-hook-map.sh` asserts the two agree; see that
script's header for why two places holding one fact need a check).

### Claude Code

- **Version probed:** 2.1.241
- **Probe method:** the installed binary's own embedded reference text
  (`strings -a` on the resolved Mach-O executable), settling the R9 envelope
  divergence from the tool itself rather than from vendor prose or the
  incumbent builder's assumption.
- **Hook file:** `hooks/hooks.json` at the plugin root.
- **Structural form:** envelope — `{"hooks": {"EVENT": [{"matcher": ...,
  "hooks": [{"type": "command", "command": ...}]}]}}`.
- **Matcher form:** tool name, exact or `|`-alternation (e.g. `Bash|Write`).
- **Time unit:** ungrounded — the embedded doc shows an inline `"timeout"`
  field but never formalizes its unit. A declared time limit emits nothing
  on Claude rather than a guessed conversion (R10).
- **Extension-root form:** `${CLAUDE_PLUGIN_ROOT}`, substituted by the CLI's
  own per-element string templating (not a shell environment variable).

### Gemini CLI

- **Version probed:** 0.46.0
- **Probe method:** documentation shipped in the installed bundle, plus the
  bundle's own extension-hook loader (spec 0179's original authoring-time
  grounding; the installed bundle is minified and does not survive a
  plain-text re-grep, corroborated instead by the repository's own
  `hooks/gemini-transcript-hooks.json`).
- **Hook file:** `hooks/hooks.json` in the extension directory, explicitly
  *not* the manifest.
- **Structural form:** envelope — `{"hooks": {"EVENT": [{"matcher": ...,
  "hooks": [{"type": "command", "command": ...}]}]}}`; a group with no
  intended tool filter omits the `matcher` key entirely.
- **Matcher form:** regex over tool names.
- **Time unit:** milliseconds, default 60000.
- **Extension-root form:** `${extensionPath}`.

### GitHub Copilot CLI

- **Version probed:** `1.0.80` self-reported; resolved installed binary is
  `1.0.49` (both readings carried, per spec 0179's own Notes precedent).
- **Probe method:** a **live functional test** — a synthetic plugin loaded
  via `--plugin-dir`, one real tool-invoking session, and a side-channel log
  the candidate hook command writes (`scripts/probe-extension-hooks.sh`,
  `docs/runbooks/extension-hook-probe.md`). No vendor documentation states
  any of the fields below; every one is grounded by observing the installed
  tool actually fire (or not fire) a hook. This is the R12 branch point:
  the probe verdict is **B1A** (a plugin-level hook surface exists and
  `preToolUse` fires within the grounded intersection).
- **Hook file:** `hooks.json` at the plugin root. (`hooks/hooks.json` in a
  subdirectory was independently observed to fire too; the render targets
  the root form as the single canonical delivery path — see the runbook's
  Results section.)
- **Structural form:** flat — `{"version": 1, "disableAllHooks": false,
  "hooks": {"EVENT": [{"type": "command", "matcher": ..., "command":
  ...}]}}`; each handler carries its own optional `matcher` inline, unlike
  the grouped shape the other three targets use.
- **Matcher form:** regex over tool names — confirmed live: `matcher:
  "no-such-tool-xyz"` did not fire, `matcher: "bash"` did, `matcher: ".*"`
  fired unconditionally. The permission-flag tool-name space
  (`--allow-tool='shell(...)'`) is a DIFFERENT vocabulary: `matcher:
  "shell"` did **not** match.
- **Time unit:** seconds. Confirmed live by two consistent data points:
  `timeout: 1` against a 3-second sleep was killed before completion;
  `timeout: 2000` against the same sleep was not — only a seconds reading is
  consistent with both.
- **Extension-root form:** `${COPILOT_PLUGIN_ROOT}`, exported by the CLI as
  a real environment variable into the hook command's shell (confirmed live:
  `$COPILOT_PLUGIN_ROOT` and `$(pwd)` both resolved to the plugin's own
  directory).

### Antigravity CLI

- **Version probed:** 1.1.19
- **Probe method:** the vendor hook and plugin contract shipped on disk with
  the CLI (`~/.gemini/antigravity-cli/builtin/skills/agy-customizations/docs/hooks.md`),
  re-read live and matching spec 0179's original grounding exactly.
- **Hook file:** `hooks.json` at the plugin root.
- **Structural form:** a map of named hooks; tool events (`PreToolUse`,
  `PostToolUse`) are grouped under a `matcher`+`hooks` wrapper, lifecycle
  events (`PreInvocation`, `PostInvocation`, `Stop`) are flat lists of
  handler objects. Only `PreToolUse` is in the current neutral vocabulary,
  so only the grouped form is exercised by the render today.
- **Matcher form:** regex over tool names.
- **Time unit:** seconds, default 30.
- **Extension-root form:** none — no path variable exists; the documented
  rule is that a handler's working directory is the directory holding
  `hooks.json`, so the render emits a working-directory-relative command
  with the neutral token stripped rather than substituted.
