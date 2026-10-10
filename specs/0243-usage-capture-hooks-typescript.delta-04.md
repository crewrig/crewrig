---
id: "0243"
slug: usage-capture-hooks-typescript
status: implemented
complexity: small
interaction-mode: MINIMAL
related-issue: 1437
version: 3.2.0
---

# Usage-capture hook and Antigravity statusline in TypeScript

*Delta 04 of `specs/0243-usage-capture-hooks-typescript.md`, cumulative on
`specs/0243-usage-capture-hooks-typescript.delta-01.md`,
`specs/0243-usage-capture-hooks-typescript.delta-02.md` and
`specs/0243-usage-capture-hooks-typescript.delta-03.md`. Source: ticket #1437.
Ticket #1398 probed the missing-dependency path of requirement 12 on every
event the capture fragments wire
(<https://github.com/crewrig/crewrig/issues/1398#issuecomment-5935751970>).
Status 1 blocks no wired event on any CLI. That result is recorded in
`docs/usage-capture.md` → *Exit status and blocking* (merged by #1435). The
probe also showed that the diagnostic line does not reach the user on every
CLI, and that it repeats within one turn on Gemini CLI. The owner chose a
documentation-only delta: the measured visibility is recorded and accepted as a
gap while requirement 11 keeps the path unreachable, and the duty to close it
falls on the first change that makes the path reachable. This delta changes no
code, test, hook manifest or setup behaviour. It runs under the release-branch
regime of `specs/0215-shell-to-typescript-migration.delta-04.md`: its spec-PR
targets `release/1231-ts-migration`. The version is a MINOR bump. Requirement 38
adds an obligation on a future change, and requirement 39 adds a documentation
duty. No requirement the shipped implementation satisfies is invalidated. No
question is left open.*

## ADDED

**Requirement 37 — Visibility of the diagnostic, accepted as a gap.** Where the
diagnostic of requirement 12 reaches the user was measured on 2026-10-01 on
macOS, on every wired event, headless and interactive (ticket #1398):

| CLI and version | Wired events | What the user sees |
|---|---|---|
| Claude Code 2.1.285 | `Stop`, `SessionEnd` | Once per event. `Stop`: the transcript notice `Stop hook error: Failed with non-blocking status code: <line>` (interactive only). `SessionEnd`: a terminal line `SessionEnd hook [<command>] failed: <line>` after exit |
| Gemini CLI 0.46.0, interactive | `AfterModel` | A generic notice once per `AfterModel` firing: `⚠ Hook(s) [<name>] failed for event AfterModel. Press F12 to see the debug drawer for more details.` The diagnostic text itself (the package name and "re-run setup") appears only in the debug drawer behind F12 |
| Gemini CLI 0.46.0, headless | `AfterModel` | The line itself on standard error, `Hook system message: Warning: <line>`, once per `AfterModel` firing |
| Copilot CLI 1.0.87 | `agentStop`, `sessionEnd` | Nothing. The line reaches only `~/.copilot/logs/process-*.log` |

On Gemini CLI, in both modes, `AfterModel` fires once per streamed chunk
(three times for a one-word reply), so the notice or the line can repeat
several times in one turn.

This state SHALL be recorded as an accepted, explicit gap for as long as
requirement 11 holds. While no entry point imports a third-party package, no
firing takes the path of requirement 12, so no user can meet the gap. The
measurement covers macOS only. Linux and Windows visibility was not measured.
Antigravity CLI is out of this requirement's reach. No capture hook is wired
for it, and its statusline shim always exits zero (requirement 14), so
requirement 12 does not apply there.

**Requirement 38 — Obligation on the change that makes the path reachable.**
The trigger is the first change that makes `hooks/usage-capture.ts`, or a module
it loads, depend on a third-party package. That change is the first one under
which a firing can take the path of requirement 12, and it must also amend
requirement 11. In the same pull request, that change SHALL:

- (a) make the diagnostic of requirement 12 reach the user on every CLI whose
  capture fragment wires `hooks/usage-capture.ts`, during the session or at its
  end. A line written only to a log file does not count. A generic notice
  that does not show the diagnostic text itself, the package name and the
  instruction to re-run setup, does not count either, such as the interactive
  Gemini CLI notice that defers it to a debug drawer. For a CLI where the
  change cannot reach the user, it SHALL instead record a per-CLI parity gap in
  `docs/cli-matrix.md` → *Parity gaps*, with evidence that the CLI offers no
  surface that reaches the user, as the multi-CLI parity rule of `AGENTS.md`
  requires;
- (b) show the diagnostic at most once per turn on Gemini CLI, whatever the
  number of `AfterModel` firings in that turn;
- (c) keep the exit-status contract of requirement 12: never status 2. Any
  exit status, or any standard-output content, that its mechanism adds on a
  wired event SHALL be probed on that event as #1398 did, and SHALL be shown
  not to block or alter the turn on that CLI;
- (d) cite, from `docs/usage-capture.md` → *Exit status and blocking*, one
  probe result per wired CLI and event, recorded on its ticket, that shows the
  outcome of (a) and (b).

This spec does not choose the mechanism. A sentinel read by a later hook or by
the status line, a per-session marker under the usage root, or a CLI-native
message field are all left to that change's plan. A setup or doctor check may
complement an in-session surface, but it cannot satisfy (a) on its own,
because it does not reach the user during the session or at its end. A
review of that change SHALL treat a missing item (a) to (d) as unmet. This
delta authorises no third-party import.

**Requirement 39 — Documentation that implements this delta.** The
implementation pull request SHALL change documentation only:

- `docs/usage-capture.md` → *Exit status and blocking* SHALL state the per-CLI
  visibility of requirement 37 as an accepted gap, Claude Code included, citing
  ticket #1398. It SHALL also state the obligation of requirement 38. The
  existing paragraph that introduces "Two observed facts" and its two bullets
  already carry the Copilot CLI and Gemini CLI facts. They SHALL be reworded
  into that statement, not duplicated;
- `docs/cli-matrix.md`, row 8c, already points to that section for the exit
  statuses. It SHALL gain one clause saying that where the diagnostic is
  visible differs per CLI, and that this difference is an accepted gap while
  requirement 11 holds;
- `docs/cli-matrix.md` → *Parity gaps* SHALL gain one `[GAP]` entry. The entry
  names Copilot CLI (no notice, log only) and Gemini CLI. For Gemini CLI it
  names the interactive generic notice, which hides the diagnostic text behind
  F12, and the repetition once per streamed chunk in both modes. It cites the #1398 evidence, states that the gap is latent
  while requirement 11 holds, and points to requirement 38.

No hook, setup script, manifest or test changes.

**Scenario:** The accepted gap is documented

Given the release branch after this delta's implementation pull request
When a reader opens `docs/usage-capture.md` → *Exit status and blocking*
Then it states, for Claude Code, Gemini CLI and Copilot CLI, what the user sees
of the diagnostic of requirement 12 as measured on 2026-10-01, calls that an
accepted gap while no third-party package is imported, cites ticket #1398, and
states the obligation of requirement 38. Row 8c of `docs/cli-matrix.md` and one
`[GAP]` entry under *Parity gaps* say the same and point to that section.

**Scenario:** A third-party import that leaves Copilot CLI silent is incomplete

Given a pull request that makes a module loaded by `hooks/usage-capture.ts`
import a third-party package
And its diff leaves the Copilot CLI diagnostic in `~/.copilot/logs/` only, with
no *Parity gaps* entry giving evidence that no user-facing surface exists
When it is reviewed
Then requirement 38(a) is unmet and the review records it.

**Scenario:** The Gemini CLI repetition is bounded

Given the change of requirement 38 and a Gemini CLI turn whose reply streams in
three chunks, with the added package unresolvable
When the turn ends
Then the user has seen the diagnostic at most once in that turn, and the model's
response is kept.

**Scenario:** A change without a third-party import is not bound

Given a pull request that edits `hooks/usage-capture.ts` but adds no
third-party import to it or to any module it loads
When it is reviewed
Then requirement 38 does not apply, and requirement 37's gap stays accepted.

## MODIFIED

Requirement 12 — the per-CLI verification the plan owed is discharged, and the
visibility of the diagnostic is governed by requirements 37 and 38. Original:

<!-- markdownlint-disable-next-line MD029 -->
> 12. **Missing-dependency diagnostic.** Should a package a later change adds
>     become unresolvable when a hook fires, and the failure reach the entry
>     module as the `MissingDependencyError` of spec 0240 requirement 7, the hook
>     SHALL write that diagnostic — naming the package and telling the user to
>     re-run setup — to standard error, SHALL exit with status 1 and never
>     status 2, which some of the four CLIs give a blocking meaning, and SHALL
>     show no unhandled module-resolution error. This is how parent requirement 6
>     is discharged for a hook, and the only case in which requirement 5's
>     exit-zero contract yields; the plan SHALL verify, per CLI, that status 1
>     does not block that CLI's turn.

Replacement:

<!-- markdownlint-disable-next-line MD029 -->
> 12. **Missing-dependency diagnostic (reworded at delta-04).** Should a package
>     a later change adds become unresolvable when a hook fires, and the failure
>     reach the entry module as the `MissingDependencyError` of spec 0240
>     requirement 7, the hook SHALL write that diagnostic — naming the package
>     and telling the user to re-run setup — to standard error, SHALL exit with
>     status 1 and never status 2, which some of the four CLIs give a blocking
>     meaning, and SHALL show no unhandled module-resolution error. This is how
>     parent requirement 6 is discharged for a hook, and the only case in which
>     requirement 5's exit-zero contract yields. The per-CLI check that status 1
>     does not block the turn is discharged: ticket #1398 measured it on every
>     wired event on 2026-10-01
>     (<https://github.com/crewrig/crewrig/issues/1398#issuecomment-5935751970>).
>     Writing to standard error does not by itself make the diagnostic reach
>     the user. Requirement 37 records where it does and accepts the gap while
>     requirement 11 holds, and requirement 38 binds the change that makes this
>     path reachable.

## REMOVED

Nothing is removed.
