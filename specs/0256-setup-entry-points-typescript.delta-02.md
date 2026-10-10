---
id: "0256"
slug: setup-entry-points-typescript
status: approved
complexity: standard
interaction-mode: MINIMAL
related-issue: 1335
version: 1.2.0
---

# Setup entry points in TypeScript

*Delta 02 of `specs/0256-setup-entry-points-typescript.md`. Source: the golden-matrix
and prompt-inventory tests of PR A of ticket 1335, which observed the shell and found
two rows of the inventory of requirement 12 whose `Setups` cell names the GitHub Copilot
setup although that setup never asks the question. It runs under the release-branch
regime of `specs/0215-shell-to-typescript-migration.delta-04.md`: its spec-PR targets
`release/1231-ts-migration`, and the base ref of every protocol is
`origin/release/1231-ts-migration` (requirement 34 of that delta). Requirement 12
permits the plan to refine a condition but not to add, rename or drop an id, and the
askers of an id are part of the public surface that requirement 13 pins (a
`--answer` for a question the setup does not ask is accepted and ignored), so a
correction of a `Setups` cell needs a delta. Two corrections are made: `link-confirm`
(G11) and `profile-method` (G12). The reading of the other rows of the table against
the four shell setups found no third discrepancy. This delta modifies requirements 12
and 16 and adds scenarios. The version is a MINOR bump: no behaviour of the shell
changes, the table is made exact. Line references are to
`release/1231-ts-migration` at `12beaeb`. This delta opens no question; the open
questions of the parent stand.*

## ADDED

**Scenario:** A Copilot `--link` run asks nothing and places symlinks

Given the GitHub Copilot setup, the argument `--link`, one `--answer` for every
question of the inventory whose condition holds, and standard input closed
When the setup runs
Then it prints neither the `WARNING: You are using symlink mode` text nor the prompt
`Continue with symlink mode? [y/N]`, asks no `link-confirm` question, does not exit 1
with `Aborted. Run without --link for secure copy mode.`, places every rules file
and the system-context store as a symbolic link through the link-or-copy module
(`Linked:` lines for the files and a `Linked dir:` line for the system-context store,
`Install mode: link` in the summary), and exits 0; the same run
of the Claude, Gemini or Antigravity setup, given no `--answer link-confirm=...`, prints
that warning and asks the one-key question.

**Scenario:** A `link-confirm` pre-answer given to the Copilot setup is ignored

Given the GitHub Copilot setup and the arguments `--link --answer link-confirm=yes`
When the setup runs
Then the id is known and the value is one of its options, so there is no usage error,
no `[answer] link-confirm=yes` line is echoed because no question is asked, the run
places symbolic links as in the scenario above, and one warning on standard error names
`link-confirm` after the run (requirement 13).

**Scenario:** A `profile-method` pre-answer given to the Copilot setup is ignored

Given the GitHub Copilot setup, a `~/.copilot/instructions/30-profile.instructions.md`
that differs from `config/PROFILE.md`, and the arguments `--answer rules-action=refresh
--answer profile-method=overwrite`
When the setup runs
Then there is no usage error, the line `Local profile differs from repository version.`
is not printed, the destination holds the content of `config/PROFILE.md`, no
`30-profile.instructions.md.ori` exists, and one warning on standard error names
`profile-method` after the run.

**Scenario:** The profile question is reachable only when the destination survives the rules-action step

Given the Claude setup (and, for the same run on each, the Gemini and Antigravity
setups with their own destination) and a differing regular file at the profile
destination, so that the rules-action question is asked
When the answer to `rules-action` is `keep`
Then the profile step is skipped, no `profile-method` question is asked and the file
is untouched; and when the answer is `refresh` the file is deleted with the other
rules, the profile is placed as a new file, and no `profile-method` question is asked
either.

**Scenario:** A directory at the profile destination reaches the profile question

Given the Claude setup, a directory at `~/.claude/rules/30-profile.md` (no regular
file or symbolic link matching the rules pattern is in the rules directory, so the
rules-action question is not asked: `*.md` in `~/.claude/rules` for Claude,
`[0-9][0-9]_*.md` in `~/.gemini` and in the Antigravity home for the other two), and the argument `--answer profile-method=keep-local`
When the setup reaches the profile step
Then the line `Local profile differs from repository version.` is printed, the line
`[answer] profile-method=keep-local` is echoed, `Keeping local profile.` is printed
and the directory is left untouched; the Gemini and Antigravity setups behave the same
at `~/.gemini/30_USER_PROFILE.md` and `<agy home>/30_USER_PROFILE.md`.

## MODIFIED

**Requirement 12 — Prompt ids: the `link-confirm` row (G11).** Original, the row:

> | `link-confirm` | `no`, `yes` | all four | `--link` is given | none: a one-key question (requirement 16), any answer but `y` and any cancel exit 1 |

Replacement:

> | `link-confirm` | `no`, `yes` | Claude, Gemini, Antigravity | `--link` is given | none: a one-key question (requirement 16), any answer but `y` and any cancel exit 1 |

The Copilot setup parses `--link` and asks no such question (requirement 16). The id
stays in the inventory, so `--answer link-confirm=...` given to that setup is a known
id whose question is not asked (requirement 13).

**Requirement 12 — Prompt ids: the `profile-method` row (G12).** Original, the row:

> | `profile-method` | `keep-local`, `overwrite` | all four | the local profile differs | abort |

Replacement:

> | `profile-method` | `keep-local`, `overwrite` | Claude, Gemini, Antigravity | the profile destination exists and differs from `config/PROFILE.md` after the rules-action step | abort |

Observed reachability, recorded for the plan's inventory test: in the three setups the
question is asked only when the destination exists and differs from `config/PROFILE.md`
once the rules-action step has run. That step lists the regular files and symbolic
links that match the rules pattern, the profile destination among them
(`scripts/setup-claude-interactive.sh:101`, `setup-gemini-interactive.sh:93`,
`setup-antigravity-interactive.sh:97`), and either keeps them, which skips the whole
profile step (`SKIP_RULES_CONFIG=1`), or deletes them
(`setup-claude-interactive.sh:101-119`, `setup-gemini-interactive.sh:93-111`,
`setup-antigravity-interactive.sh:97-115`); the profile step follows
(`setup-claude-interactive.sh:352-369`, `setup-gemini-interactive.sh:310-327`,
`setup-antigravity-interactive.sh:334-351`). A regular file at the destination, in a rules directory that is a real directory, is
therefore either kept, with no profile step, or deleted, so the profile is placed as a
new file; the branch is reachable only when the destination survives that step, for
example a directory at that path, or when the rules directory is itself a symbolic link
(`find` without a trailing slash lists nothing in it, so `rules-action` is not asked and
a differing profile file reaches the profile question). The TypeScript twin keeps the branch faithfully
(requirement 6), and the inventory test of the plan pins it. The Copilot setup has no
such question: it places `30-profile.instructions.md` with `install_file` among the
other instruction files and asks nothing about a differing profile
(`scripts/setup-copilot-interactive.sh:145-146`), and no other question of the
inventory is asked by a different set of setups than its row says.

**Requirement 16 — The `--link` warning and stdin ownership (G5, G11).** Original, the
closing sentence of the paragraph as delta-01 replaced it:

> The exit and the
> pre-answer are unchanged (exit 1 with `Aborted. Run without --link for secure copy mode.` unless the key is `y` or `Y`; the `--answer
> link-confirm=yes` pre-answer of requirement 13 stands for the key, `no` for any other
> key); the line-mode prompter SHALL be created only after that question, so the two
> readers never contend for standard input.

Replacement:

> The exit and the
> pre-answer are unchanged (exit 1 with `Aborted. Run without --link for secure copy mode.` unless the key is `y` or `Y`; the `--answer
> link-confirm=yes` pre-answer of requirement 13 stands for the key, `no` for any other
> key); the line-mode prompter SHALL be created only after that question, so the two
> readers never contend for standard input. The warning and the question are those of
> the Claude, Gemini and Antigravity setups alone
> (`setup-claude-interactive.sh:28-45`, `setup-gemini-interactive.sh:29-46`,
> `setup-antigravity-interactive.sh:33-50`). The GitHub Copilot setup parses `--link`
> and nothing else (`setup-copilot-interactive.sh:28-33` sets `INSTALL_MODE="link"`),
> prints no warning, asks no question and cannot exit 1 for it; it places its files
> through the link-or-copy module (requirement 22) as the shell's `install_file`
> places a symbolic link under `INSTALL_MODE=link` (`scripts/lib/common.sh:470-479`),
> with the copy fallback of deviation (i),
> and `--answer link-confirm=...` given to it is a known id whose question is not asked
> (requirement 13), accepted and ignored with the warning that requirement names. This
> asymmetry already exists in the shell and the twin keeps it; an adopter who wants
> the warning on Copilot asks for it in a later delta.

## REMOVED

None.
