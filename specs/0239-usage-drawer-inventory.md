---
id: "0239"
slug: usage-drawer-inventory
status: approved
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 1206
version: 1.0.0
---

# MemPalace usage-record drawer inventory and purge

## Intent

A person auditing or removing CrewRig's token-consumption tracking data on a
machine gains a shipped command that lists and can remove the feature's own
`usage-records` drawers directly in MemPalace, independent of the local usage
root, the local journal, and the mirror markers under it — so a drawer
orphaned when its journal entry is already gone, or left behind from an
older, incomplete purge, can still be found and removed. The person sees
that inventory grouped and filterable across wing, CLI, and recorded
period, and every drawer the command lists or removes is one it has itself
confirmed belongs to this feature, never a room member it merely assumes
does. The existing removal procedures in `docs/usage-organization.md` gain a
way to confirm their closing verdict against MemPalace's own inventory
instead of resting only on local markers, and the fail-closed guarantee
those procedures already give — never reporting data as removed unless
removal is confirmed — carries over unchanged.

## Requirements

1. The tooling set SHALL gain a command that inventories every drawer filed
   in MemPalace's `usage-records` room, and that inventory SHALL be
   derivable from MemPalace's own drawer listing and drawer content alone:
   the command SHALL run and produce a complete inventory when the local
   usage root named by `CREWRIG_USAGE_ROOT` (default `~/.crewrig/usage`),
   the local journal under it, and the mirror markers under
   `<usage root>/mirror/` are all absent.
2. Before the command counts, lists, or offers for removal any drawer filed
   in the `usage-records` room, it SHALL confirm that drawer's own full
   content — not a truncated preview — parses as JSON whose `schemaVersion`
   matches a version `schemas/usage-record/v1.schema.json` (or a later
   schema version this repository ships) declares, and whose
   `provenance.cli` value is one of the CLI identifiers that schema's
   `provenance.cli` enumeration names. A room member whose content fails
   this confirmation SHALL be excluded from every count, listing, grouping,
   and removal the command performs, and SHALL never be deleted by it.
3. The command SHALL group its inventory, and SHALL let an operator filter
   it, by wing, by the confirmed drawer's `provenance.cli` value, and by
   the recorded period — the UTC `YYYY-MM` of the confirmed drawer's own
   `timing.requestInstant`, derived the same way
   `scripts/lib/usage-store/layout.js`'s `period()` function derives a
   period from a usage record. Each of the three groupings SHALL be usable
   independently of the other two.
4. The command SHALL, by default — when the operator supplies neither an
   explicit wing list nor a narrower scope flag — run its inventory across
   every wing MemPalace reports holding a `usage-records` room. This
   default follows CrewRig's own usage-store deployment model: the usage
   root and its MemPalace mirror are one person's personal installation on
   their own machine, never a room shared across unrelated people on one
   palace, so an all-wings sweep is the scope that actually finds the
   cross-project orphaned drawers this ticket exists to recover. The
   command SHALL also let an operator restrict the inventory to an
   explicit, operator-supplied set of wings, and SHALL state in its own
   output which scope it actually swept.
5. The command SHALL offer a removal path that deletes a confirmed drawer
   addressed by that drawer's own MemPalace drawer identifier, never
   through a match on a `source_file` value, so that a drawer whose local
   journal entry no longer exists — because the entry was lost, or because
   an older, informal purge removed the local usage root without removing
   the drawer — remains removable.
6. The removal path SHALL only ever delete a drawer that the same run's own
   inventory has confirmed under requirement 2; it SHALL NOT accept an
   externally supplied drawer identifier that bypasses that run's
   confirmation, and it SHALL NOT delete any other member of the
   `usage-records` room — confirmed or not — that the operator's chosen
   scope and filters did not select.
7. Invoking the removal path SHALL, by default, report which confirmed
   drawers it would delete without deleting any of them, mirroring the
   dry-run default MemPalace's own `mempalace_delete_by_source` tool
   already applies; deleting SHALL require an explicit input distinct from
   the default invocation.
8. The command SHALL be runnable non-interactively and SHALL report its
   outcome through both a process exit status and a structured summary a
   caller can log: exit zero only when the inventory operation completed
   and, for a removal run, every drawer it selected for deletion was
   confirmed deleted; exit non-zero for every other outcome, including one
   where MemPalace could not be reached, answered with a daemon-wide
   refusal, or could not confirm a requested deletion.
9. The command's non-zero, MemPalace-unreachable, or
   deletion-unconfirmed outcomes SHALL NOT be reported as an empty
   inventory or as a completed removal; a scope the command could not
   inspect SHALL be reported as unconfirmed, mirroring the fail-closed
   contract `specs/0212-usage-documentation.md` requirements 20 to 22
   already place on the mirror check in `docs/usage-organization.md`.
10. `docs/usage-organization.md`'s `usage_mirror_gate` closing check SHALL
    gain a call to this command, or to an equivalent confirmation step this
    command makes possible, so that a `removed` verdict for the MemPalace
    mirror rests on this command's own confirmation against MemPalace
    rather than solely on the local mirror markers `usage_mirror_gate`
    already inspects; the check's existing marker-based pass SHALL remain,
    and neither pass SHALL report `removed` unless both agree the scope
    holds no confirmed drawer.
11. The command's own reference documentation — its invocation, options,
    defaults, output shape, and exit-status contract — SHALL live in a
    per-seam document (an existing per-seam document such as
    `docs/usage-storage.md`, which already documents the mirror and prune
    mechanics, or a new per-seam document dedicated to this command), and
    SHALL NOT be duplicated in `docs/usage-overview.md`,
    `docs/usage-guide.md`, or `docs/usage-organization.md`, per
    `specs/0212-usage-documentation.md` requirements 14, 25, 26, and 29's
    no-duplication convention. `docs/usage-organization.md`'s mirror-check
    section SHALL link to that per-seam section rather than restate its
    mechanics.
12. The command SHALL confirm a drawer under requirement 2 using that
    drawer's `recordId` and other identifying fields carried in its own
    content, never a filename or path convention, so that a drawer the
    mirror wrote for a record whose journal entry, sidecars, and directory
    structure no longer exist anywhere on disk is still identifiable as
    this feature's own record.
13. Running the inventory operation, including a run scoped by wing, CLI,
    or period filters, SHALL make no write of any kind to MemPalace and no
    write to any location under the usage root; the only write operation
    the command performs is the removal path's own drawer deletion.
14. A removal run scoped to one wing, one CLI, or one period SHALL delete
    only confirmed drawers matching every filter given for that run; it
    SHALL NOT delete a confirmed drawer belonging to a different CLI, a
    different wing, or a different period than the ones the operator
    selected, even when that drawer sits in the same `usage-records` room.
15. When MemPalace reports zero wings, zero drawers in the `usage-records`
    room, or a room holding only members that fail requirement 2's
    confirmation, the command SHALL report an empty confirmed inventory
    rather than an error, and its exit status for a plain inventory run
    SHALL be zero in that case — an empty confirmed result is a legitimate,
    reportable outcome, distinct from the unconfirmed outcome requirement 9
    describes.
16. A removal run whose scope would delete more than a small, fixed
    threshold of confirmed drawers, or whose scope is every wing MemPalace
    reports, SHALL require an explicit, distinct confirmation input beyond
    the dry-run-to-commit toggle requirement 7 already requires, before the
    command performs any deletion in that run.
17. When the removal path deletes a drawer for which a local mirror marker
    under `<usage root>/mirror/mirrored/` still exists, the command SHALL
    NOT attempt to reconcile or remove that local marker. This is a
    documented known limitation, not a defect: the command's own reference
    documentation (requirement 11) SHALL state it plainly and SHALL point
    the reader to `scripts/lib/usage-store/prune.js` as the existing path
    that keeps a local marker and its MemPalace drawer in sync when the
    local journal is still present.

## Scenarios

**Scenario:** Finding a drawer orphaned by a lost journal entry

Given a drawer was filed in MemPalace's `usage-records` room for a record
whose journal entry, sidecars, and mirror marker have all already been
deleted from disk
When an operator runs the command's inventory scoped to that drawer's wing
Then the drawer appears in the inventory, grouped under its own CLI and
period, confirmed solely from its own content

**Scenario:** A grouped, filtered inventory across many wings

Given MemPalace holds `usage-records` drawers across several wings, several
CLIs, and several periods
When an operator runs the inventory with no wing restriction and a period
filter for one month
Then the report lists only that month's confirmed drawers, grouped by wing
and by CLI

**Scenario:** Deleting exactly one confirmed drawer by its own identifier

Given the inventory has confirmed one drawer as a usage record for the
`claude-code` CLI
When an operator runs the removal path with an explicit commit input against
that same scoped inventory
Then only that drawer is deleted, addressed by its own MemPalace drawer
identifier, and no other drawer in the room is touched

**Scenario:** An unrecognized room member is never deleted

Given the `usage-records` room in one wing also holds a drawer whose content
is not JSON or lacks a recognized `schemaVersion`
When the command runs its inventory and a subsequent removal pass over that
wing
Then the unrecognized drawer is excluded from every count and listing and is
never selected for deletion

**Scenario:** MemPalace is unreachable

Given MemPalace's MCP daemon is not reachable when an operator runs the
command
When the run completes
Then the command exits non-zero, reports the scope as unconfirmed rather
than empty or removed, and deletes nothing

**Scenario:** Dry run is the default

Given an operator runs the removal path without the explicit commit input
When the run completes
Then the command reports which confirmed drawers it would delete, and every
one of them is still present in MemPalace afterward

**Scenario:** The closing check confirms against MemPalace itself

Given a removal procedure in `docs/usage-organization.md` has pruned every
local mirror marker it can find
When its closing check also calls this command's confirmation step
Then the check's `removed` verdict reflects MemPalace's own inventory, not
only the absence of local markers

**Scenario:** A wing-scoped removal never reaches another wing

Given an operator restricts a removal run to one named wing
When the run executes
Then a confirmed drawer belonging to a different wing is never inspected for
deletion, even though it also sits in a `usage-records` room

**Scenario:** An all-wings sweep is the default

Given an operator supplies neither an explicit wing list nor a narrower scope
flag
When the operator runs the command's inventory
Then the command sweeps every wing MemPalace reports holding a
`usage-records` room and states in its output that this was the scope swept

**Scenario:** A wide deletion requires an added confirmation

Given a removal run's scope resolves to more confirmed drawers than the
command's threshold, or to every wing
When an operator supplies the dry-run-to-commit input alone, without the
additional confirmation requirement 16 requires
Then the command deletes nothing and reports that the added confirmation is
missing

## Out of scope

- Any change to the capture, journal-write, mirror, or prune code paths
  themselves (`scripts/lib/usage-store/{journal,mirror,prune,layout}.js`)
  beyond what this new command reads. Those write paths and their own
  contracts (spec 0207, spec 0207 delta-01, spec 0208) are unchanged.
- Editing `docs/usage-organization.md`, `docs/usage-storage.md`, or any
  other documentation file. This specification is itself the single file
  its own SPECS stage produces; the doc edits requirements 10 and 11
  describe are the implementation's to make.
- Choosing the exact script, subcommand, or file this command ships as — a
  HOW decision for the PLAN stage, not this WHAT-level specification.
- General-purpose MemPalace administration tooling for rooms other than
  `usage-records`, or for wings and drawers unrelated to this feature.
- Scheduling, automating, or triggering the removal path on any cadence —
  every invocation remains operator-initiated.
- Any change to the MemPalace MCP server or its tool surface
  (`mempalace_list_drawers`, `mempalace_get_drawer`,
  `mempalace_delete_drawer`, and related tools). This specification only
  consumes that surface as it exists.
- The listing already shipped in `docs/usage-organization.md` → *Older
  Antigravity records holding reply text*, which finds records holding
  conversation text through a `jq` scan of the local journal. Unaffected by
  this specification.
- Legal or regulatory guidance beyond what `docs/usage-organization.md`
  already states. This specification closes a tooling gap, not a compliance
  opinion.

## Open questions

None. The SPECS-stage validation gate resolved all three open questions the
draft carried:

- Default sweep scope (requirement 4): every wing, by owner decision — the
  usage root and its MemPalace mirror are one person's personal
  installation, never a room shared across unrelated people on one palace.
- Added confirmation for a wide deletion (requirement 16): required, by
  owner decision, beyond a threshold or for an every-wing scope.
- Local mirror-marker reconciliation (requirement 17): explicitly left
  undone and documented as a known limitation, by owner decision —
  `scripts/lib/usage-store/prune.js` remains the path that keeps a local
  marker and its MemPalace drawer in sync while the local journal exists.
