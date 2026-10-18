---
id: "0268"
slug: hook-migration-and-token-baseline
status: implemented
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 1725
version: 1.0.0
---

# Restore usage capture on existing installs and record the token baseline

*Work package WP0 of epic #1724 (token footprint of contributing to CrewRig). Related issues: #1725 (this ticket) and #1724 (the epic, which receives the baseline comment). Builds on `specs/0243-usage-capture-hooks-typescript.md`, `specs/0247-mempalace-transcript-hook-typescript.md`, `specs/0248-worktree-git-guard-typescript.md` and `specs/0266-final-removal-and-termination.md` (requirement 9, the direct-sibling recognition of a removed `.sh`); usage attribution is `specs/0208-usage-attribution.md`.*

**Problem statement.** After #1715 removed the `.sh` hook files, an install made before that change keeps hook registrations that point at files that no longer exist. Verified on the maintainer machine on 2026-10-18:

- `~/.claude/settings.json` registers `bash "<checkout>/hooks/usage-capture.sh" claude-code Stop` and `... SessionEnd`, and `bash "<checkout>/hooks/worktree-git-guard.sh"` (PreToolUse, Bash). Neither file exists, so usage capture has recorded nothing since 2026-10-18 12:33 and the worktree guard is inert.
- The same file registers `bash "$HOME/.claude/hooks/mempalace-transcript.sh"` on four events, a user-level copy installed by an earlier setup. That copy is still on disk but is a stale shell copy, not the checkout's TypeScript hook. It is in scope: it is a framework-owned registration that must reach the checkout's TypeScript hook.
- The rewrite logic itself works. Run on a copy of that file, the usage-capture rewrite (2 commands), the guard rewrite and the transcript rewrite (4 commands) each produced the direct `node "<path>.ts"` form, backed the file up first, and left the Orca hooks in the same file untouched. Recognition of a removed `.sh` through its sibling `.ts` already exists (spec 0266 requirement 9) and unit tests exist per CLI (`hook-legacy-rewrite-without-shim-files.test.ts`).
- Therefore the gap is not the rewrite but its reach: the migration only runs inside a full interactive setup run, and for usage capture only on the "keep" branch of a keep-or-remove question; no check proves that one setup run over a realistic, pre-#1715 settings file leaves no stale framework entry on each of the four CLIs (Claude Code, Gemini CLI, Copilot CLI, Antigravity CLI). The exact cause of the failure on the maintainer machine is established as the first act of the PLAN stage (see Open questions).

## Intent

A contributor with an install older than #1715 runs setup once and, with no further action, usage capture, the worktree guard and the session-recording hook run again on all four supported CLIs, without duplicated entries and without any change to hooks the framework does not own. The maintainer then has a recorded, reproducible token baseline for the month and three reference tickets, so later work packages of epic #1724 can be compared against it.

## Requirements

1. Setup SHALL, in one run and on each of Claude Code, Gemini CLI, Copilot CLI and Antigravity CLI, replace every stale framework-owned hook registration that names a removed `.sh` file (usage capture, worktree git guard, session recording) with the registration that runs the corresponding TypeScript hook of the checkout.
2. The migration SHALL NOT depend on any answer the user gives during setup, including declining session recording or running in a non-interactive context. A stale usage-capture entry is migrated, not removed, whenever the user has not explicitly chosen removal in that run: when no answer is available (non-interactive run or cancelled question) the opt-in state is treated as unknown and the entry is migrated, because a registration the user already installed expresses an opt-in and migrating preserves it while removing would silently discard it. A user who explicitly chooses removal SHALL have the entries removed, not migrated.
3. The migration SHALL be idempotent: a second setup run over an already migrated file SHALL leave it byte-identical and SHALL NOT create a backup.
4. The migration SHALL NOT leave two registrations of the same framework hook for the same event; where a stale entry and a current entry coexist, one SHALL remain.
5. The migration MUST NOT modify, reorder or remove any hook registration that the framework does not own, including the hooks that Orca writes into the same Claude Code settings file, and MUST NOT alter any other key of the configuration.
6. A configuration file that is modified SHALL be backed up before it is written, and a file that cannot be read as a JSON object SHALL be left unchanged with a reported reason.
7. When the migration cannot proceed (for example below the minimum Node.js version), setup SHALL report which entries were left stale and why, rather than leaving them silently.
8. Setup SHALL report each migrated, removed or left entry by hook name and event, so the maintainer can confirm the result from the setup output alone.
9. A regression test, authored by the `tester` role, SHALL exercise one setup run per CLI over a fixture configuration that contains the stale `.sh` entries of every framework-owned hook that CLI registers, plus at least one foreign hook, and SHALL assert requirements 1, 3, 4 and 5 on the result. The Claude Code fixture SHALL include the user-level session-recording copy path.
10. After one setup run on the maintainer machine, a new usage record SHALL appear in the usage journal once a session ends; this is verified manually and recorded in the logbook of #1725.
11. A baseline of the indicators of epic #1724 section 4.3 SHALL be posted as one comment on #1724: E1 measured once on the repository and deployed rules; E2 to E4 measured over the last full calendar month before posting (usage journal, `claude-code`), and E2 to E4 plus Q2 (REQUEST CHANGES verdicts and blocking findings in the logbook) measured per reference ticket. The reference tickets, chosen by the maintainer, are #1205 (small bug), #1334 (standard feature) and #1175 (docs-only change).
12. The baseline comment SHALL state, for each indicator, the exact command run (for example `task usage:query -- --period <YYYY-MM> --cli claude-code` and `task usage:query -- --task-key <N> --rollup`), the usage-journal field or fields it reads, the aggregation (percentile or sum), the period or ticket, the CLI filter, and the date it was produced, so that a later run is comparable.
13. The baseline comment SHALL state the E1 byte count once, with the exact file list measured, and SHALL flag any difference between the repository rules and the deployed rules.
14. The baseline comment is a non-code deliverable: it SHALL be listed as such in the logbook of #1725 and is verified by a reviewer reading it on #1724 and checking requirements 11 to 13 against it; no automated check applies to it.
15. This ticket SHALL NOT change any rule, skill, agent definition or lifecycle document.

## Scenarios

**Scenario:** stale Claude Code install is migrated

```text
Given a Claude Code settings file registering usage-capture.sh on Stop and SessionEnd, worktree-git-guard.sh on PreToolUse, a user-level mempalace-transcript.sh on four events, and Orca hooks on the same events
When  setup runs once
Then  each framework-owned entry runs the TypeScript hook of the checkout
And   the Orca hooks are byte-identical
And   a backup of the original file exists
```

**Scenario:** second run changes nothing

```text
Given a settings file already migrated by a previous setup run
When  setup runs again
Then  the file is byte-identical and no new backup is created
```

**Scenario:** each CLI is covered

```text
Given a fixture file per CLI (Claude Code, Gemini CLI, Copilot CLI, Antigravity CLI) with that CLI's stale entries and one foreign hook
When  setup runs once for that CLI
Then  no framework-owned entry names a removed .sh file and the foreign hook is unchanged
```

**Scenario:** stale and current entries coexist

```text
Given a file holding both a stale usage-capture entry and the current one for the same event
When  setup runs
Then  exactly one usage-capture entry remains for that event
```

**Scenario:** declined or non-interactive run still migrates

```text
Given a stale file and a setup run in which the user declines session recording or no terminal is attached
When  setup completes
Then  the stale entries are migrated anyway
```

**Scenario:** migration blocked

```text
Given a stale file and a Node.js version below the minimum
When  setup runs
Then  the file is unchanged and setup reports which entries remain stale and why
```

**Scenario:** unreadable configuration

```text
Given a settings file that is not a JSON object
When  setup runs
Then  the file is unchanged and the reason is reported
```

**Scenario:** baseline comment is complete

```text
Given the baseline comment posted on #1724
When  a reviewer reads it
Then  E1 has one measurement with its file list, E2 to E4 each have command, field, aggregation, period or ticket and date for the month and for each of #1205, #1334 and #1175, and Q2 is given per ticket
```

## Out of scope

- Any change to rules, skills, agents, the lifecycle, or the CLI matrix.
- Deleting the stale user-level `~/.claude/hooks/mempalace-transcript.sh` copy and its siblings from disk; entries are rewritten, files are left on disk and reported.
- Changing what the usage-capture, guard or transcript hooks themselves do, or the shape of usage records.
- Reducing any token indicator; later work packages of #1724 do that, this one only measures.
- Re-baselining the targets of epic #1724 section 4.3 (the baseline comment records measured values only).
- Quality indicators Q1 to Q4 (recorded per work package after this one).

## Open questions

- The code path of setup already rewrites stale entries and a rewrite on a copy of the maintainer file succeeds; the reason the installed file is still stale (setup not re-run since #1715, a gate in the interactive flow, or a defect) is not yet established. The PLAN stage must reproduce it by running setup against a copy of the pre-#1715 file for each of the four CLIs before choosing a change, and record the finding in the logbook of #1725.
