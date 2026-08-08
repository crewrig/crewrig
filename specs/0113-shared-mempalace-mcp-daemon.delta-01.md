---
id: "0113"
slug: shared-mempalace-mcp-daemon
status: approved
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 739
version: 2.0.0
---

# Concurrent sessions all write to shared memory — delta 01

Closes two `spec`-class findings from the cold PLAN review on issue #739
(comment 5226727241). Both concern the parent's `## Out of scope`, which
excluded work the parent's own requirements depend on.

`MAJOR` bump. The delta modifies no existing requirement — it narrows
`## Out of scope`, which brings previously excluded work inside the spec and
invalidates any implementation drafted against the parent as merged. That is the
convention's "invalidates an in-flight implementation" criterion, not its
"requirement modified or removed" one.

Requirement numbering continues the parent's sequence (which ends at R10), per
the precedent of `specs/0112-spec-id-reservation.delta-01.md`.

## ADDED

1. **R11.** Setup SHALL replace an assistant's previous shared-memory
   arrangement rather than leave it alongside the new one, so that no assistant
   remains able to reach shared memory the previous way after setup completes.
2. **R12.** Before applying any change, setup SHALL establish at least that each
   supported assistant present on the machine has a configuration it can both
   read and write. When setup establishes, before it has applied any change,
   that a required change cannot be applied, it SHALL apply none.
3. **R13.** When a change fails after setup has begun applying changes, setup
   SHALL restore every assistant it has already changed to the arrangement that
   assistant had before the run started.
4. **R14.** When the restoration required by R13 does not itself succeed, setup
   SHALL report which assistants are in which arrangement, and SHALL name the
   repair the operator must perform. An assistant whose configuration is in
   neither arrangement SHALL be reported the same way rather than treated as
   convergeable — repetition cannot resolve a configuration it cannot
   recognise.
5. **R15.** Setup SHALL be repeatable: an assistant already on the new
   arrangement SHALL be treated as switchable, and a repeated run SHALL converge
   on the state a single uninterrupted run would have produced. A repeated run
   SHALL re-enter the obligations of R12, R13 and R14 rather than assume the
   previous run was moving forward — a run killed during R13's restoration was
   moving backward, and the repeat cannot tell the difference. When such a run
   finds assistants in mixed arrangements, it SHALL report that it found and
   resolved a partial state — a run that died before it could report leaves no
   other trace, so the next run is the only place the operator can learn it
   happened.
6. **R16.** An operator SHALL be able to determine which arrangement each
   assistant on the machine is currently configured for.

**Definition.** *Every supported assistant present on the machine* means each
assistant for which this repository ships a setup script and whose own
command-line tool is detectable on that machine. An assistant whose tool is
absent is not part of the obligation and its absence SHALL NOT block a run.

**Scenario:** A blocking condition is established before any change

Given an assistant's configuration cannot be read or written
When setup runs
Then no assistant SHALL be changed
And the operator SHALL be told which assistant blocked the run

**Scenario:** A change fails partway through

Given setup has already switched one assistant
When switching a later assistant fails
Then the already-switched assistant SHALL be restored to its previous
  arrangement

**Scenario:** Restoration itself fails

Given setup has changed an assistant and a later change has failed
When setup restores that assistant and the restoration does not succeed
Then setup SHALL report each assistant's resulting arrangement
And SHALL name the repair the operator must perform

**Scenario:** An assistant is left in neither arrangement

Given an assistant's configuration is in neither the previous nor the new
  arrangement
When setup runs
Then that assistant SHALL be reported the way R14 requires
And SHALL NOT be treated as one a repeated run can converge

**Scenario:** Setup is re-run after an interrupted run

Given a previous run was interrupted with some assistants switched
When setup is run again
Then it SHALL converge on the state an uninterrupted run would have produced
And SHALL NOT refuse on the grounds that some assistants are already switched
And SHALL report that it found and resolved a partial state

**Scenario:** The previous arrangement is replaced, not duplicated

Given an assistant is configured for the previous arrangement
When setup switches it
Then that assistant SHALL no longer be able to reach shared memory the previous
  way

**Scenario:** Operator inspects per-assistant configuration

Given assistants are configured on the machine
When the operator inspects their configuration the documented way
Then each assistant's current arrangement SHALL be reported

## MODIFIED

Original `## Out of scope`:

> - **Migration of an already-configured machine**, and the operator diagnostics
>   that report which arrangement a machine is on. ADR 0016 derived spec 3.

Replaced by:

> - **Repairing a machine that a further run of setup cannot correct.** Switching
>   an already-configured machine is in scope here, and so is converging a
>   machine left inconsistent by an interrupted run (R15). What remains excluded
>   is the residue that repetition cannot reach — the case R14 reports and hands
>   to the operator. ADR 0016 derived spec 3.

Rationale: parent requirements 3 and 4 forbid a partly-configured machine, and a
machine that already reaches shared memory the previous way is the ordinary case,
not an edge case. Excluding the replacement of that previous arrangement while
forbidding the state it produces left the parent internally inconsistent — a spec
cannot forbid an outcome and exclude the only mechanism that prevents it. The
measurement recorded on issue #739 is what makes this load-bearing: an assistant
left on the previous arrangement is refused every write for its whole life, so
the half-switched state is worse than either end state.

The exclusion is now drawn by **mechanism** rather than by origin: what is out of
scope is what repetition cannot fix, which is observable from the machine's
state. "An external cause" would not have been — nothing in the machine's state
reveals why a configuration is inconsistent.

Original `## Out of scope`:

> - **Reference documentation and the CLI matrix rows** this change will
>   invalidate. ADR 0016 derived spec 5, which follows once the behaviour is
>   settled.

Replaced by:

> - **Reference documentation** — runbook, README, ADR cross-references. ADR
>   0016 derived spec 5, which follows once the behaviour is settled. The CLI
>   matrix rows are NOT excluded: `AGENTS.md` → *CLI Matrix Maintenance*
>   requires any change touching the setup scripts to update
>   `docs/cli-matrix.md` in the same diff, and that rule exists to prevent
>   exactly the silent asymmetry this change could introduce.

Rationale: the parent excluded the CLI matrix, which contradicts a repository
rule that is mandatory and whose purpose is to catch this class of change. The
conflict was resolved in favour of the repository rule at the PLAN gate, but a
plan comment cannot amend a merged spec — hence this delta. Note for the reader
of ADR 0016: its *Derived spec plan* step 5 still lists `docs/cli-matrix.md`, and
this delta supersedes that placement.

## REMOVED

None.
