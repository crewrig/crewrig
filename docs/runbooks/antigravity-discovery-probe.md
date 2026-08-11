# Runbook — re-establishing Antigravity CLI discovery locations

<!-- crewrig-doc: published=false -->

Spec 0123 R13 requires the framework to retain a **re-runnable** procedure that
re-establishes which locations Antigravity CLI discovers, for each component
kind. R14 requires that procedure to tell a component the assistant does not
find apart from an assistant that failed to answer.

This runbook is that procedure's documentation.
`scripts/probe-antigravity-discovery.sh` is the procedure.

## Why observation and not the vendor guide

The defect spec 0123 exists to fix was created by reading documentation instead
of observing the assistant, and the correction is symmetric: the vendor's own
`agy-customizations` skill lists exactly one machine-local customization root
(`~/.gemini/config/`) and five customization types — Rules, Skills, Plugins,
Hooks, MCP Servers — with **agents absent from the table entirely**. Neither the
placement the framework used nor the kind it ships can be settled from that
document. Only measurement settles them, and only a measurement someone can
re-run stays true.

## Running it

```sh
bash scripts/probe-antigravity-discovery.sh
```

Preconditions: the `agy` binary on `PATH`, and a machine whose model calls
succeed. Cost is roughly two to four minutes — two `agy -p` calls and one
`agy agents`.

Exit status carries the verdict summary:

| Exit | Meaning |
|---|---|
| `0` | every sentinel classified `FOUND` or `NOT-FOUND` |
| `1` | precondition failure — binary missing, or a sentinel name already on disk |
| `3` | at least one sentinel `INDETERMINATE`; re-run before recording anything |

Environment seams:

| Variable | Default | Purpose |
|---|---|---|
| `AGY_BIN` | `agy` | the vendor binary; the hermetic test stubs it |
| `AGY_PROBE_TIMEOUT` | `300` | per-call bound in seconds |
| `AGY_PROBE_ASK_SHAPE` | `captured` | `captured` or `direct` — see *The bounded call* below |

The probe refuses to start if any sentinel path already exists, and removes on
exit every path *and every directory level* it created — deepest-first and only
while empty. It never removes a directory that was already there, which matters
because `~/.gemini/antigravity-cli/agents/` exists and is empty on any machine
set up under the superseded installer.

## The candidate matrix

Three candidate locations × two component kinds × two agent shapes, plus one
duplicate-name cell.

| Location | Why it is a candidate |
|---|---|
| `~/.gemini/antigravity-cli/` | application data; where the framework installed until spec 0123. The vendor never documents it as a customization root. |
| `~/.gemini/config/` | the machine-local customization root the vendor documents. |
| `~/.gemini/` | the Gemini CLI roots. An early `agy agents` run listed `harness-curator`, which lives at `~/.gemini/agents/harness-curator.md`. |

| Kind | Shape | Why the shape is in the matrix |
|---|---|---|
| skill | `<name>/SKILL.md` | the only shape the vendor documents, and the only one the build stages. |
| agent | `<name>.md` (flat) | the shape the superseded installer copied. |
| agent | `<name>/AGENT.md` (directory) | the shape `scripts/build-components.sh` **stages**. No probe had ever covered this cell, and R3 makes the installed shape a function of what the assistant accepts. |

The **duplicate-name cell** installs one agent name at two roots at once. Every
sentinel in the first probe was uniquely named by design, so nothing observed
said whether a duplicate shadows, doubles, or is refused — and the spec-0123 fix
*creates* that condition: `harness-curator` is the framework's one library agent,
and `~/.gemini/agents/harness-curator.md` already exists on any machine that ran
the Gemini setup. Its unique-named siblings sit at the same two roots and act as
the control: if both siblings are found and the duplicate is listed once, the
de-duplication is unambiguous rather than a discovery failure.

## Two instruments, and why both are queried

Each kind is queried twice, and the two queries are **not redundant** — they
measure different things and they can disagree.

1. **An open listing.** For skills, `agy -p "list your skills"`. For agents,
   `agy agents` — a deterministic subcommand with no model call in the loop.
2. **A forced-choice prompt.** One `<name>=YES|NO` line per sentinel, plus a real
   installed component as a positive control.

The forced-choice shape is what makes R14's third verdict possible. An open
listing cannot distinguish "the assistant does not have it" from "the assistant
did not answer" — omission looks identical in both cases. Under forced choice, a
sentinel with **no `<name>=` line at all** is a *non-answer*, and the probe
classifies it `INDETERMINATE`, never `NOT-FOUND`. That distinction is not
hypothetical: an `agy` call hung for over two minutes during the first probe on
this ticket and returned normally on retry.

The positive control guards the other direction. A control that answers `NO`
means the **model** failed, not the placement.

## How to read the three verdicts

| Verdict | Condition | What to do |
|---|---|---|
| `FOUND` | the answer carries `<name>=YES` | record it |
| `NOT-FOUND` | the answer carries `<name>=NO` | record it |
| `INDETERMINATE` | no `<name>=` line, an empty answer, or the bound was hit | **re-run.** Do not record an absence. |

## The bounded call

Three traps sit on the bounded `agy` call, all measured on Bash 3.2.57, all
closed in `run_bounded()`:

- **`kill "$pid"` reaches the wrapper, not the process it forked.** A timed-out
  `agy` therefore outlives the `EXIT` trap that removes the sentinels, and keeps
  reading them. Measured: after a plain `kill`, the forked child was still
  running. `set -m` plus `kill -TERM -- "-$pid"` leaves nothing.
- **`wait "$pid"` returns 143 on the killed job.** Reaching `set -e` at top
  level, that aborts the script — losing the classification before
  `INDETERMINATE` can be recorded.
- **The same `wait`, inside a command substitution, returns 0 instead.** That is
  not safety, it is blindness: a bare `false` in the same position would pass
  just as silently.

`wait "$pid" || st=$?` closes all three, and `AGY_PROBE_ASK_SHAPE` exists so the
hermetic test can drive the classifier through **both** call shapes rather than
making a reader predict which symptom a given call site will show.

The probe itself cannot run in CI — it needs the vendor binary, a model-driven
session, and minutes of wall time, which spec 0123 → *Out of scope* rules out.
Its **classifier** is hermetically tested, with `AGY_BIN` stubbed, by
`scripts/tests/test-antigravity-discovery-probe.sh`.

## Results

### 2026-08-11 — `agy` 1.1.11, macOS (arm64)

Two independent runs, identical verdicts, exit `0` both times. Positive control
`agy-customizations`: `FOUND`.

| Kind | Shape | `~/.gemini/antigravity-cli/` | `~/.gemini/config/` | `~/.gemini/` |
|---|---|---|---|---|
| skill | `<name>/SKILL.md` | `NOT-FOUND` | **`FOUND`** | `NOT-FOUND` |
| agent | `<name>.md` (flat) | `NOT-FOUND` | **`FOUND`** | `NOT-FOUND` |
| agent | `<name>/AGENT.md` (directory) | `NOT-FOUND` | **`FOUND`** | `NOT-FOUND` |

Duplicate-name cell: `FOUND`, and `agy agents` listed the name **twice**. Both
unique-named siblings at the same two roots were listed as well, so this is a
genuine double — the CLI neither shadows one copy nor refuses the pair.

**The two instruments disagree about agents, and the disagreement is the finding.**
`agy agents` listed every agent sentinel — all three roots, both shapes. The
forced-choice model query, run in the same session against the same sentinels,
answered `YES` only for the documented root. They are not contradicting each
other about facts: `agy agents` enumerates a registry, while the forced-choice
measures what the assistant can actually reach in a session. The earlier reading
of this ticket — "`~/.gemini/antigravity-cli/agents/` **is** a discovery
location" — came from `agy agents` alone, which is the more permissive of the
two instruments. `~/.gemini/config/agents/` is the only location that satisfies
**both**, which is why spec 0123 R2's single documented root is the right target
under either reading.

**Consequences recorded elsewhere:**

- The installed agent shape is the **directory** shape, matching what
  `scripts/build-components.sh` stages. `docs/cli-matrix.md` row 4 needs no
  `[GAP]`: staged shape and installed shape agree.
- The duplicate-name outcome is benign for the real case. After this fix
  `harness-curator` exists at `~/.gemini/agents/harness-curator.md` (the Gemini
  setup) and at `~/.gemini/config/agents/harness-curator/AGENT.md` (the
  Antigravity setup). Both are the same crewrig component rendered for two CLIs,
  so either resolution yields the same agent; the only visible effect is a
  doubled line in `agy agents`.

### Recording a new run

Append a dated section above rather than editing an existing one — the point of
a re-runnable procedure is the series, not the latest row. Write locations as
`~/.gemini/…`: a pasted probe transcript carries `/Users/<login>/…`, which
`scripts/check-no-machine-paths.sh` rejects.
