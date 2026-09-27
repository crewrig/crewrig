---
id: "0237"
slug: windows-hook-cli-matrix
status: approved
complexity: small
interaction-mode: MINIMAL
related-issue: 1322
version: 1.0.0
---

# Windows hook command-line parsing matrix (0215 sub-spec B)

## Intent

Before any hook script belonging to the shell-to-TypeScript migration
(`specs/0215-shell-to-typescript-migration.md`, sub-spec B of the architect
decomposition recorded on issue #1231) is migrated, a maintainer reading
`docs/cli-matrix.md` finds a row — or a coherent set of rows — that states,
for each of Claude Code, Gemini CLI, GitHub Copilot CLI and Antigravity CLI,
which command interpreter parses a hook command line on Windows, how that
interpreter treats quoting, how it expands the CLI's own project-directory
environment variable, and how it treats a path separator inside the command
line's arguments. Every one of those sixteen cells is grounded in a
reproduction that actually ran on Windows, never in documentation alone and
never in behavior observed on a different operating system; a CLI found
unable to run a hook on Windows at all is recorded as a parity gap with
concrete evidence, never left blank. This specification discharges
requirements 18 and 19 of the parent spec for this scope, and migrates no
script.

## Requirements

1. `docs/cli-matrix.md` SHALL carry, before any hook script of
   `specs/0215-shell-to-typescript-migration.md` migrates, a row or a
   coherent set of rows recording the Windows behavior of a hook command
   line for each of Claude Code, Gemini CLI, GitHub Copilot CLI and
   Antigravity CLI.
2. For each of the four CLIs, the recorded row(s) SHALL name the command
   interpreter that parses that CLI's hook command line on Windows.
3. For each of the four CLIs, the recorded row(s) SHALL state the quoting
   rule the named interpreter applies to the arguments of a hook command
   line on Windows.
4. For each of the four CLIs, the recorded row(s) SHALL state how the named
   interpreter expands the CLI's own project-directory environment variable
   (`$CLAUDE_PROJECT_DIR`, `${GEMINI_PROJECT_DIR}`, and the GitHub Copilot
   CLI and Antigravity CLI equivalents) when it appears inside a hook
   command line on Windows.
5. For each of the four CLIs, the recorded row(s) SHALL state how the named
   interpreter treats a path separator inside the arguments of a hook
   command line on Windows.
6. Every cell recorded under requirements 2 through 5 SHALL be backed by a
   reproduction that was actually executed on Windows — a `windows-latest`
   continuous-integration job or a real Windows machine — and SHALL NOT be
   backed solely by a CLI's public documentation, by behavior observed on
   macOS or Linux, or by behavior observed through a POSIX compatibility
   layer (Windows Subsystem for Linux, Git Bash). Documentation citation
   alone, sufficient elsewhere for a gap claim, is never sufficient to
   populate one of these cells, because these cells measure an observed
   behavior rather than assert an absence.
7. When a CLI is found unable to run a hook command line on Windows at all,
   that CLI's cell SHALL instead record a parity gap, backed by concrete
   evidence per `docs/cli-matrix-maintenance.md` → *Gap-acceptance evidence
   rule* — a documentation citation, an empirical reproduction of the
   refusal, or a linked upstream issue where the absence is confirmed —
   and SHALL NOT be left blank, marked "TBD", or backed only by the absence
   of a documentation mention.
8. The pull request that adds the row(s) SHALL make the reproduction
   transcript for each cell recorded under requirements 2 through 6
   retrievable: a linked continuous-integration job log for a
   `windows-latest`-runner reproduction, or a quoted command-and-output
   transcript in the pull request body for a real-machine reproduction.
9. No cell of the sixteen this specification defines — four CLIs times the
   four dimensions of requirements 2 through 5 — SHALL be left unrecorded:
   each SHALL carry either a measured value under requirements 2 through 6
   or a parity-gap entry under requirement 7.
10. This specification SHALL NOT migrate, rewrite, or remove any shell
    script, hook script, or hook wiring file; it records evidence only.

## Scenarios

**Scenario:** All four CLIs run a hook command line on Windows

```text
Given a windows-latest continuous-integration job, or a real Windows
      machine, with Claude Code, Gemini CLI, GitHub Copilot CLI and
      Antigravity CLI installed, each wired to a hook command line that
      references its own project-directory environment variable
When  the hook command line is reproduced for each of the four CLIs
Then  docs/cli-matrix.md gains a row (or a coherent set of rows) recording,
      for each CLI, the parsing interpreter, its quoting rule, its
      environment-variable expansion result and its path-separator
      handling, with every cell traceable to a captured reproduction
      transcript
```

**Scenario:** A CLI that cannot run a hook on Windows is recorded as a gap,
not omitted

```text
Given one of the four CLIs has no supported mechanism to run a hook
      command line on Windows at all
When  the reproduction is attempted for that CLI
Then  that CLI's cell in docs/cli-matrix.md records a parity gap backed by
      concrete evidence per docs/cli-matrix-maintenance.md's Gap-acceptance
      evidence rule, and the row is not merged with that cell left blank
```

**Scenario:** A non-empirical claim is rejected

```text
Given a draft update to docs/cli-matrix.md whose cell for a CLI states that
      its Windows behavior is "assumed to match Linux" and cites no
      reproduction transcript
When  the pull request adding that update is reviewed against this
      specification
Then  the reviewer rejects the cell as unsupported, because neither a
      windows-latest job log nor a real-Windows-machine transcript backs
      it, and the pull request does not merge until the cell carries an
      actual reproduction
```

## Out of scope

- Migrating, rewriting, or retiring any hook script, or any other shell
  script named in the strangler order of
  `specs/0215-shell-to-typescript-migration.md` requirement 8 — no script
  migrates in this specification.
- Any change to `hooks/*-transcript-hooks.json`, `hooks/*-usage-capture-hooks.json`,
  the installed-command rewrite mechanism, or any other hook wiring —
  reserved to the parent spec's sub-spec C.
- Constructing the `windows-latest` continuous-integration scaffolding or
  timing harness themselves — reserved to sub-spec A; this specification
  only requires that the evidence for each cell come from a reproduction
  run through that scaffolding or on a real Windows machine, not the
  scaffolding's own construction.
- The macOS and Linux behavior of a hook command line for any of the four
  CLIs — already outside the Windows-only scope of this specification.
- Any operating system other than Windows.
- The Node.js version floor check, the shell-script ratchet, and every
  other requirement assigned to sub-spec A of
  `specs/0215-shell-to-typescript-migration.md`.
- Per-script latency budgets (requirement 15 of the parent spec) —
  assigned to the sub-spec that migrates each hook script.
- Remediating any parity gap this specification's reproduction surfaces
  beyond recording it — remediation, if any, belongs to a later sub-spec
  or to a delta of the parent spec.

## Open questions

None. The four dimensions to measure (command interpreter, quoting,
environment-variable expansion, path separators) and the four CLIs in scope
are named exhaustively by the parent ticket and by requirement 18 of
`specs/0215-shell-to-typescript-migration.md`; the evidence standard is
inherited from `docs/cli-matrix-maintenance.md`'s existing Gap-acceptance
evidence rule, narrowed here (requirement 6) to require an actual Windows
reproduction, rather than documentation citation alone, for the four
measured dimensions specifically — the parent ticket's own title calls for
empirical reproduction, and a documentation citation cannot state how an
interpreter actually treats quoting or path separators.
