---
id: "0252"
slug: windows-service-management
status: draft
complexity: small
interaction-mode: MINIMAL
related-issue: 1545
version: 1.4.0
---

# OS service management and the daemon lifecycle scripts in TypeScript

*Delta 04 of `specs/0252-windows-service-management.md`, after its delta-01, delta-02 and
delta-03. Source: ticket #1545, a follow-up of #1330 (seat `review/1330`, passes 18 and 19,
finding `i1-F39`). The shell's `backup_file` only warns when the backup of an assistant's
configuration cannot be created, and `switch-mempalace-http` goes on; the TypeScript port
(PR #1544) kept that behaviour. The rollback of a failed switch does not depend on the file
(it restores from the registration captured in memory), but `repair-mempalace-http
--restore-backup` (requirement 19) then has no backup to restore: the documented repair path
for a switch that went wrong is silently unavailable. The spec owner's delegate decided that
the switch SHALL abort instead, which deviates from the shell contract and is therefore
recorded here as a further deviation of requirement 31, never silently. This delta runs under
the release-branch regime of `specs/0215-shell-to-typescript-migration.delta-04.md`, and its
spec-PR targets `release/1231-ts-migration`. The version is a MINOR bump: requirement 18 gains
one refusal and requirement 31 one deviation; no behaviour a plan or a seat has settled is
dropped. Its status follows the table of `docs/spec-format.md`: `draft` on its spec branch,
`approved` once this spec-PR merges, `implemented` with the last implementation PR.*

## ADDED

### Requirement 33 — the switch refuses to change an assistant whose configuration it cannot back up

`switch-mempalace-http` SHALL back up the configuration of every assistant present before it
registers any of them, as the shell does. When the backup of any one of them cannot be
created, the entry SHALL stop at that point, before the registration of the first assistant:
it SHALL print `ERROR: could not back up <file name>.` followed by the line
`No assistant has been changed.` on standard output, as the other refusals of the
all-or-nothing floor (spec 0113 requirement 12) do, and exit 1. No assistant's configuration
is modified, so no rollback runs. A backup already taken for an assistant earlier in the same
pass is a regular backup (mode 0600, same name rule) and is left in place. The message names
the configuration file and tells the user the switch can be re-run once the file's directory
accepts a new file; a re-run converges (spec 0113 requirement 15). A run that ends this way
has already installed the daemon and replaced its process (requirement 18 orders those steps
before the registration), as every other refusal of the floor; it neither registers nor
leaves an assistant half-switched.

The backup is mandatory with no opt-out: there is no `--no-backup` flag and no environment
variable that turns the refusal into a warning.

## MODIFIED

### Requirement 31 — one more deviation from the shell contract

Original (excerpt):

> … (l) the installed launcher is a TypeScript program with an endpoint record at the
> legacy path (requirement 10). A further deviation found in PLAN or DEV is added by a
> delta-spec of this spec, never silently.

Replacement:

> … (l) the installed launcher is a TypeScript program with an endpoint record at the
> legacy path (requirement 10); (m) `switch-mempalace-http` exits 1 with `No assistant has
> been changed.` when the backup of an assistant's configuration cannot be created
> (requirement 33), where the shell's `backup_file` warned and the switch went on. A further
> deviation found in PLAN or DEV is added by a delta-spec of this spec, never silently.

## REMOVED

Nothing is removed.

## Rationale and rejected alternatives

The failure that matters is asymmetric. A switch that aborts on a backup failure costs one
re-run once the user fixes the directory (read-only, full disk, permissions). A switch that
goes on without the backup produces a state that the documented repair path
(`repair-mempalace-http --restore-backup`, requirement 19) cannot undo, and the user learns
it only when they need the backup. The in-memory rollback covers a failed registration, not a
later wish to return to the previous configuration, nor a configuration the switch rewrote
correctly but the user wants back.

- **(a) Keep warn-and-continue (the shell contract).** Rejected: zero deviation, but it keeps
  the silent loss of the repair path; the warning goes to standard error among the other
  lines of a long run and is easily missed. The shell had this behaviour because it had no
  structured floor, not because it was a decision.
- **(c) Abort unless `--no-backup`.** Rejected: it adds an option to a CLI whose flags
  (`--rotate`, `-h`) are frozen by requirement 18, the shell shim and the argument oracle, for
  a failure the user can fix at the source. An opt-out would also be the first thing scripted
  around by an unattended caller, which recreates (a). It can be added later by a delta if a
  real need appears.
- **(d) Abort only when `--rotate` is given.** Rejected: the rationale does not depend on the
  token rotation; the plain switch rewrites the same configuration files.
- **(e) Delete the backups already taken when a later one fails.** Rejected: they are valid
  backups of unchanged files, deleting them is a destructive step on an error path, and a
  re-run takes a fresh one anyway.

## Scenarios

**Scenario:** the backup of one assistant's configuration cannot be created

Given three assistants present with valid configurations, and the directory of the second
one's configuration that refuses a new file
When  the user runs `switch-mempalace-http`
Then  the entry prints `No assistant has been changed.`, exits 1, and the three
      configurations are byte-identical to what they were before the run.

**Scenario:** the backups all succeed

Given three assistants present with valid configurations and writable directories
When  the user runs `switch-mempalace-http`
Then  one backup per assistant is created and printed, then each assistant is registered,
      exactly as before this delta.
