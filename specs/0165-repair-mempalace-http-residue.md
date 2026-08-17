---
id: "0165"
slug: repair-mempalace-http-residue
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 752
version: 1.0.0
---

# Recover a machine whose MemPalace switch was interrupted

The last piece of scope that `specs/0113-shared-mempalace-mcp-daemon.delta-01.md`
deliberately kept out, named there rather than left implicit: the residue that
repetition cannot reach. R14 reports it and hands it to the operator; this spec
gives the operator a command that repairs it.

## Intent

An operator whose machine was left with an assistant in neither the previous
nor the new arrangement — or whose automatic restoration failed — can run one
command that detects the residue, names it, and repairs it to a recognisable
arrangement, instead of being handed a config path and left on their own.

## Requirements

1. **R1.** A repair command SHALL detect, for each supported assistant present
   on the machine, whether its configuration is in a recognisable arrangement
   (`http`, `stdio`, or `none`) or in the residue (neither arrangement, or not
   parseable as JSON). It SHALL reuse the existing arrangement classifier for
   the recognisable cases.
2. **R2.** A configuration SHALL be in the residue when its file does not parse
   as JSON, or when its `mempalace` registration matches neither the `http`
   shape (has `url` or `serverUrl`) nor the `stdio` shape (has `command`). A
   configuration in the residue SHALL NOT be treated as convergeable by a
   repeated setup run.
3. **R3.** The arrangement classifier SHALL report a configuration whose file
   does not parse as `unknown` (neither arrangement), not as `none`. A
   non-parseable file is not "no registration"; reporting it as `none` would
   let a repeated setup run treat it as convergeable and fail mid-switch.
4. **R4.** Run with no repair flag, the repair command SHALL report each
   affected assistant, its configuration path, whether a timestamped backup
   exists, and the repair actions available. It SHALL exit non-zero when any
   residue exists.
5. **R5.** With `--restore-backup`, the repair command SHALL restore, for each
   affected assistant that has a timestamped backup whose content parses as
   JSON, the most recent such backup. The restore SHALL preserve the file's
   mode; a configuration that carries a bearer token SHALL remain `0600`. An
   affected assistant without a usable backup SHALL be reported, not silently
   skipped.
6. **R6.** With `--reset-none`, the repair command SHALL remove the `mempalace`
   registration from each affected assistant whose configuration parses,
   producing the recognisable `none` arrangement. An affected assistant whose
   configuration does not parse SHALL be reported as requiring `--restore-backup`
   first, and SHALL NOT be modified.
7. **R7.** After applying a repair, the repair command SHALL re-run the
   detection and report the resulting arrangement of every assistant. It SHALL
   exit 0 only when no residue remains.
8. **R8.** The repair command SHALL NOT modify a configuration in a
   recognisable arrangement. Any JSON rewrite SHALL use the secure config
   writer. The bearer token SHALL NOT be placed in argv.
9. **R9.** A repair run SHALL be repeatable: a second run after a successful
   repair SHALL find no residue and exit 0.

**Definition.** *Supported assistant present on the machine* has the same
meaning as in spec 0113 delta-01: each assistant for which this repository
ships a setup script and whose own command-line tool is detectable. An
assistant whose tool is absent is not part of the obligation.

## Scenarios

**Scenario:** A config file does not parse

Given an assistant's configuration file is not valid JSON
When the repair command runs with no flags
Then it SHALL report that assistant as in the residue
And SHALL name the configuration path and the available repair actions
And SHALL exit non-zero

**Scenario:** A registration matches neither arrangement

Given an assistant's `mempalace` registration matches neither the `http` nor
  the `stdio` shape
When the repair command runs with no flags
Then it SHALL report that assistant as in the residue
And SHALL NOT treat it as convergeable by a repeated setup run

**Scenario:** The classifier reports a non-parseable file

Given an assistant's configuration file is not valid JSON
When the arrangement classifier classifies it
Then it SHALL report `unknown`, not `none`

**Scenario:** Restore from the most recent backup

Given an affected assistant has a timestamped backup whose content parses as
  JSON
When the repair command runs with `--restore-backup`
Then the assistant's configuration SHALL be restored to that backup's content
And the file's mode SHALL be preserved, remaining `0600` when it carries a
  bearer token
And the resulting arrangement SHALL be recognisable

**Scenario:** No usable backup exists

Given an affected assistant has no timestamped backup, or none of its backups
  parse as JSON
When the repair command runs with `--restore-backup`
Then that assistant SHALL be reported as requiring a different repair action
And SHALL NOT be silently skipped

**Scenario:** Reset to no registration

Given an affected assistant's configuration parses as JSON
When the repair command runs with `--reset-none`
Then the `mempalace` registration SHALL be removed
And the resulting arrangement SHALL be `none`

**Scenario:** Reset requires a parseable configuration

Given an affected assistant's configuration does not parse as JSON
When the repair command runs with `--reset-none`
Then that assistant SHALL be reported as requiring `--restore-backup` first
And SHALL NOT be modified

**Scenario:** A recognisable arrangement is never modified

Given an assistant is in a recognisable arrangement (`http`, `stdio`, or
  `none`)
When the repair command runs with any repair flag
Then that assistant's configuration SHALL NOT be modified

**Scenario:** Repair is verified

Given the repair command has applied a repair
When it finishes
Then it SHALL re-run the detection and report every assistant's resulting
  arrangement
And SHALL exit 0 only when no residue remains

**Scenario:** Repair is repeatable

Given a repair run has succeeded
When the repair command runs again
Then it SHALL find no residue and exit 0

## Out of scope

- **Converging a machine in a recognisable-but-mixed arrangement** (`http` /
  `stdio` / `none`). That is R15's job, already specified in spec 0113
  delta-01; the repair command only restores recognisability, and a repeated
  setup run does the converging.
- **Switching an assistant to the shared daemon.** That is setup's job
  (spec 0113 R3/R4/R11). The repair command does not register anyone for
  `http`; an operator who wants the daemon re-runs setup once the residue is
  recognisable.
- **Repairing the daemon itself** — a dead process, a drifted launcher, a
  usurped listener, or unenforced authentication. Those are the reporting of
  `status-mcp-server.sh` and the rotation/setup commands' job (spec 0139,
  spec 0158).
- **An `http` registration pointing at a wrong endpoint.** It is recognisably
  `http`; a repeated setup run re-registers it with the current endpoint.
- **An assistant whose CLI is not installed** (`absent`). Not part of the
  all-or-nothing obligation (spec 0113 delta-01 definition).
- **Rebuilding a corrupt configuration file from scratch.** The repair command
  restores from a backup or resets to `none`; it does not reconstruct arbitrary
  config content it cannot know.

## Open questions

- **Should the repair command also offer `--register-http`?** The two-step
  path (restore recognisability, then re-run setup) covers the operator who
  wants the daemon, so a direct re-register action is a convenience, not a
  necessity. Keeping it out preserves the clean boundary — the repair command
  restores recognisability, setup converges. Resolved in favour of excluding
  it unless a review finds the two-step path insufficient.
- **Should `status-mcp-server.sh` gain a `--fix` flag that delegates to the
  repair command?** The status script is deliberately read-only ("reports; it
  does not mutate"). A standalone command keeps that contract intact. Resolved
  in favour of a standalone command unless a review finds the coupling
  justified.
