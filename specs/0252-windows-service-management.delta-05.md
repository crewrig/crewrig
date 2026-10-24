---
id: "0252"
slug: windows-service-management
status: approved
complexity: small
interaction-mode: AUTO
related-issue: 1477
version: 1.5.0
---

# OS service management and the daemon lifecycle scripts in TypeScript

*Delta 05 of `specs/0252-windows-service-management.md`, after its delta-01 to delta-04.
Source: bug #1477. The installed launcher (`scripts/lib/service/launcher/mcp-daemon-launcher.ts`)
resolves `mempalace-http-wrapper.py` under the baked `CREWRIG_REPO_DIR`, the checkout that ran
setup. When that checkout is an ephemeral ticket worktree and is removed, the supervisor
restarts the launcher forever with `wrapper not found`, and `task mempalace:status` still says
"in sync with the repository", because drift compares only a source hash. Delta-01's
requirement 10 stated the intent that "no program reaches into the repository", but it bundled
only the TypeScript imports and the original out-of-scope line left the Python wrapper behind.
This delta amends both. The version is a MINOR bump: requirement 10 gains installed files, the
status gains two outputs, and the out-of-scope line is narrowed; no behaviour a plan or a seat
has settled is dropped. Its status follows the table of `docs/spec-format.md`: `draft` on its
spec branch, `approved` once this spec-PR merges, `implemented` with the last implementation
PR.*

## ADDED

Nothing is added as a new numbered requirement; the change lives in the amendments below.

## MODIFIED

### Requirement 10 — the Python data files join the installed tree

Original (excerpt, as amended by delta-01):

> … a bundle directory `service-lib/` that holds exactly the repository files the installed
> programs import, copied verbatim, so that no program reaches into the repository. …
> `LAUNCHER_SOURCE_SHA` is the SHA-256 of the launcher entry source, then the trust wrapper
> source, then the bundle files in a fixed order … uninstalling the MCP daemon removes the
> launcher program and its endpoint record …

Replacement (the unchanged parts of delta-01's text stand; these sentences are added):

> The installer SHALL also copy, verbatim (mode 0644, staged and renamed like the bundle),
> three Python data files into the `service-lib/` beside the launcher program:
> `scripts/lib/mempalace-http-wrapper.py`, `scripts/lib/mempalace_pin.py` and
> `scripts/lib/mempalace-pin.json`. The wrapper locates its siblings through
> `os.path.dirname(os.path.realpath(__file__))`, so same-directory placement keeps it
> working unchanged. These three files are a separate list: they are NOT members of the
> TypeScript bundle list, and the import-closure test keeps asserting the TypeScript list only.
> `LAUNCHER_SOURCE_SHA` also covers these three files, in that order, after the bundle
> files, so a change to the wrapper or to the pin is drift. Uninstalling the MCP daemon removes
> the three files with the launcher program; the trust wrapper never imports them, so the
> ChromaDB uninstall leaves them alone.

### Requirement 11 — the launcher runs the wrapper from its own `service-lib/`

Original (excerpt, item (g) and (i)):

> … (g) the wrapper's absence is a diagnosed failure; … (i) the hand-off runs
> `<MEMPALACE_PYTHON> scripts/lib/mempalace-http-wrapper.py --transport http …`

Replacement:

> … (g) the absence of the installed wrapper is a diagnosed failure that names the installed
> path and tells the user to re-run setup or `switch-mempalace-http`; … (i) the hand-off runs
> `<MEMPALACE_PYTHON> <service-lib>/mempalace-http-wrapper.py --transport http …`, where
> `<service-lib>` is the `service-lib/` directory beside the launcher's own program file.
> The launcher SHALL NOT read the wrapper, or anything else needed to start serving, from
> `CREWRIG_REPO_DIR`. That variable stays baked in the endpoint record only for operator hint
> text.

### Requirement 15 — what `task mempalace:status` reports about the installed launcher

Original: the status compares the installed launcher's `LAUNCHER_SOURCE_SHA` with the
repository.

Replacement (added to it):

> When the installed `service-lib/` lacks any of the three Python files of requirement 10,
> the launcher section SHALL print a plain `*** BUNDLE INCOMPLETE ***` block naming the missing
> file(s), tell the user to re-run setup or `switch-mempalace-http`, and the command SHALL
> exit non-zero. When the baked `CREWRIG_REPO_DIR` no longer exists, the section SHALL print
> a non-failing informational note that the daemon no longer depends on it; this note alone
> does not change the exit code.

### Out of scope — the Python wrapper (spec 0252, Out of scope list)

Original (excerpt):

> - The Python wrapper `scripts/lib/mempalace-http-wrapper.py`, `scripts/lib/mempalace_pin.py`
>   and the MemPalace server itself.

Replacement:

> - The content of the Python wrapper `scripts/lib/mempalace-http-wrapper.py`,
>   `scripts/lib/mempalace_pin.py` and the MemPalace server itself. Installing, hashing and
>   uninstalling those files and the pin data file as installed-tree members is in scope
>   (requirement 10).

## REMOVED

Nothing is removed.

## Rationale and rejected alternatives

The launcher is the process a supervisor restarts for as long as the user's session lasts, so
it must not depend on a directory that the user's workflow deletes. The checkout that ran setup
is exactly such a directory when setup runs from a ticket worktree. The fix completes the
"no program reaches into the repository" intent of delta-01.

- **(a) Resolve the wrapper from the main worktree, and have status check that it exists.**
  Rejected: it needs no new installed file, but it still breaks when the checkout is moved or
  deleted, and it makes the daemon's liveness depend on a path the installer cannot guarantee.
  It treats the symptom, a dead worktree, not the dependence on the checkout.
- **(b) Make status detect a dead `CREWRIG_REPO_DIR` and fail.** Rejected as the only fix: it
  reports the outage but does not prevent it. After this delta the dead directory is
  informational, because the daemon no longer needs it.
- **(c) Bundle the three Python files as TypeScript bundle members.** Rejected: they are not
  imported by any TypeScript entry, so the import-closure test (no file that no entry imports)
  would fail; a separate list keeps that test meaningful.
- **(d) Copy only the wrapper.** Rejected: the wrapper imports `mempalace_pin.py`, which reads
  `mempalace-pin.json`; all three or the wrapper fails at start.

## Scenarios

**Scenario:** the launcher survives the removal of the checkout

Given the daemon installed from a copy of the repository tree, and that copy then deleted
When  the installed launcher starts
Then  it reaches the spawn of `<service-lib>/mempalace-http-wrapper.py` without reading
      `CREWRIG_REPO_DIR`.

**Scenario:** status flags a missing installed wrapper

Given an installed `service-lib/` from which `mempalace-http-wrapper.py` was removed
When  the user runs `task mempalace:status`
Then  the output holds `*** BUNDLE INCOMPLETE ***` naming that file, and the exit code is non-zero.

**Scenario:** status notes a dead baked repository directory without failing

Given a complete installed `service-lib/` and a baked `CREWRIG_REPO_DIR` that no longer exists
When  the user runs `task mempalace:status`
Then  the output holds an informational note that the daemon no longer depends on it, and
      the exit code is unchanged by the note.

**Scenario:** drift when the wrapper source changes

Given an installed launcher in sync with the repository
When  `scripts/lib/mempalace-http-wrapper.py` or `scripts/lib/mempalace-pin.json` changes in
      the repository
Then  `LAUNCHER_SOURCE_SHA` no longer matches and the status reports drift.
