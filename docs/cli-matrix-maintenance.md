<!-- Extracted from AGENTS.md. Cross-references to other sections refer to AGENTS.md. -->

# CLI Matrix Maintenance

`docs/cli-matrix.md` is the source of truth for every CLI-specific
integration point. It MUST stay in lockstep with the code.

**Trigger surface.** A change is CLI-specific when it touches any of:
`.claude/**`, `.gemini/**`, `community-config/**`, `extensions/**`,
`hooks/*-transcript-hooks.json`, `config/claude/**`, `config/gemini/**`,
`scripts/build-components.sh`, any `scripts/{build,install,setup,import,manage}-*.sh`,
`.github/workflows/claude.yml` or `.github/workflows/gemini.yml`,
the top-level entry-point files (`CLAUDE.md`, `GEMINI.md`), or a
CLI-prefixed entry in `Taskfile.yml` / `.gitignore`.

**Obligation.** Any PR that modifies the trigger surface MUST consult
`docs/cli-matrix.md` and update it in the same diff — new row, edited
cell, or refreshed `Parity gaps` entry. Drift is a parity bug.

**Parity check.** When adding or modifying a feature for one CLI,
verify every other supported CLI. The default is **implement
symmetrically in the same PR**. Recording a gap is an exception that
requires written evidence (see *Gap-acceptance evidence rule* below);
linking a follow-up issue is not, by itself, sufficient justification
to defer. Silent asymmetry is prohibited.

**Gap-acceptance evidence rule.** A `Parity gaps` entry MAY be added
only when the agent has produced concrete evidence that no mechanism
exists in the target CLI to support the feature. "Concrete evidence"
means at least one of:

- A citation from the CLI's public reference documentation explicitly
  stating the absence (with URL and quoted sentence in the PR body
  or the matrix entry itself).
- An empirical reproduction (command + output) showing the CLI
  rejecting or ignoring the symmetric artifact.
- An upstream issue link where the CLI maintainers have declined or
  deferred the capability.

The following are **NOT** acceptable evidence and MUST NOT be used to
justify a gap:

- "The public reference does not mention it" (absence of mention is
  not absence of mechanism — search for user-level, hook-level, and
  alternative file-system paths first).
- "A follow-up issue is filed."
- "Out of scope for this PR."

If the agent's own ADR, design note, or research surfaced a viable
path — even an unconventional one (user-level config, hook directory,
env var injection, wrapper script) — that path MUST be implemented in
the current PR. Documenting a viable path and then declining to use
it is a parity violation, not a deferral.

**Protocol-only exemption.** When the only file touched on the trigger
surface is a top-level entry-point file (`AGENTS.md`, `CLAUDE.md`,
`GEMINI.md`) AND the diff adds purely lifecycle / process documentation
with no CLI-specific behaviour (no new path, command, hook, or
configuration unique to one CLI), the obligation to update
`docs/cli-matrix.md` does NOT apply. This codifies the precedent set by
PRs #181 (Spec-PR workflow) and #183 (Plan review protocol) — both
AGENTS.md-only, both pure lifecycle-protocol additions. The exemption
SHALL NOT extend to changes that introduce or modify CLI-specific
behaviour even when delivered exclusively through an entry-point file.

**Symmetric-script rule.** When adding a new CLI target, every script
under `scripts/` that already has a target for an existing CLI MUST
gain a target for the new CLI in the **same PR** that introduces the
CLI. This is a direct extension of working code, not new research,
and is therefore in-scope by default. The list of trigger scripts is
authoritative:

- `scripts/setup-<cli>-interactive.sh`
- `scripts/import-<cli>-history.sh`
- `scripts/manage-<cli>-component.sh` (or a new `--target <cli>`
  branch in `scripts/manage-workspace-component.sh` if that script
  already serves multiple CLIs)
- `scripts/build-components.sh` `--target <cli>` branch
- Every `Taskfile.yml` entry whose name carries a CLI prefix

Deferring any of the above to a follow-up ticket requires **explicit
prior user authorization** captured in the PR or its linked logbook
issue. Agent-initiated deferral of a symmetric script is prohibited.
