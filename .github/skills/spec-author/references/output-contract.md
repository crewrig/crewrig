# Output contract

## Output contract

The skill writes exactly one new file:

```text
/specs/<NNNN>-<slug>.md
```

The file SHALL conform to `docs/spec-format.md` (the normative format
contract). Below is the skill-side summary; on any conflict, the format
document wins.

### Ticket pickup check

Before anything else — before the id is secured, and before any branch,
filename, or frontmatter exists — the skill runs the cross-contributor
ownership check of `docs/ticket-ownership.md`
(`specs/0244-multi-contributor-assignment.md`, requirements 11 and 15), in
spec and delta-spec mode alike:

```sh
task -x ticket-pickup -- --issue <related-issue>
```

Without `task`, run `node scripts/lib/node-floor-guard.js`, then — only if
it exits `0` — `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON
scripts/ticket-pickup.ts --issue <related-issue>`, as two separate steps
(never chained with `&&`).

Only exit `0` lets the skill continue. On any other exit the skill SHALL
stop before securing an id or creating a branch, and relay the tool's stderr
sentence to the user: `3` names the owner and the permitted paths, `4` and
`2` report what could not be determined, `5` reports that a maintainer was
asked to assign the ticket. The skill SHALL NOT retry the check hoping for a
different answer, SHALL NOT assign, unassign, or reassign anyone itself, and
SHALL proceed without the check only on the user's explicit instruction in
the same session.

### ID allocation

`<NNNN>` is **secured on the reference repository before the spec file is
written**, by `scripts/reserve-spec-id.ts`. The skill SHALL NOT compute it
from the local working tree.

What this replaces, and why (`specs/0112-spec-id-reservation.md`): an
unsynchronised `max(existing) + 1` hands the same number to two sessions
that pick up two tickets in the same second, and the collision is
discovered by an unrelated third pull request *after* both offending specs
have merged — by which point the id is carried by an issue, a branch name,
a pull-request title and a logbook, and repairing it means renaming all of
them.

Run the tool FIRST, before the filename, the branch name, or the
frontmatter exist (requirement 2 — so that all three agree from the first
commit):

```sh
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/reserve-spec-id.ts --issue <related-issue>
```

The first line of stdout is always the id. The exit code is the only thing
the skill interprets:

| Exit | Meaning | What the skill does |
|---|---|---|
| `0` | The id is secured. | Use it. Write no mark. |
| `3` | The id is allocated locally but **not** secured — offline, unreachable remote, or no write access (the fork case). | Use it, AND copy the emitted `unsecured-id: true` line verbatim into the frontmatter. |
| `1` | Genuine failure. | Stop. Relay the stderr reason to the user. |

The marker is emitted on stdout line 2 in the exact frontmatter form, so the
skill pastes it rather than composing it. The exit code already carries the
boolean; the line exists to be copied.

The `--issue <N>` invocation is idempotent per issue: if this issue already
holds a secured reservation — from an earlier invocation of this exact
command, or because a parent orchestrator secured a specific id on this
issue's behalf via `--id <ID> --issue <N>` before spawning this session —
the tool returns that existing id instead of computing a new one, and no
second reservation is created (`specs/0112-spec-id-reservation.delta-02.md`,
requirements 17-18). The skill does not need to know which of these
happened, and this does not change its own contract below: it continues to
never pass `--id` itself.

Three obligations, each closing a tempting shortcut:

- On exit `1` the skill SHALL NOT fall back to `max(existing) + 1`, and
  SHALL NOT re-run the tool hoping for a different answer. Exit `1` names a
  condition a retry cannot change: an invalid carrier setting, a
  non-representable identifier, an id already held by another ticket, or a
  retry budget already exhausted by lost races.
- On exit `3` the mark is **not optional**. It is the machine-readable
  statement that the id may still be taken by another session, and it is
  what `scripts/check-spec-id-reserved.ts` reports at pull-request time —
  blocking for a pull request from the reference repository, non-blocking
  for one from a fork, where a maintainer secures the id and removes the
  mark before merge (requirement 10).
- The skill never passes `--corpus`, never passes `--id`, and never sets
  `CREWRIG_SPEC_ID_CARRIER`. Securing a chosen identifier is the maintainer's path
  and the org-corpus path; changing the carrier is a pull request against
  `.crewrig/spec-id-carrier`, not something a session decides.

Ids are never reused and a gap in the sequence is an accepted outcome (per
`docs/spec-format.md` → *Naming convention*). An abandoned reservation is
harmless by design: no expiry, no reclamation pass, no release protocol.

**Delta-specs secure nothing.** A delta-spec reuses its parent's id by
construction, so in delta-spec mode the skill does not call the tool at
all.

### Frontmatter

Populate every required field per `docs/spec-format.md` → *Frontmatter
schema*:

| Field | Source |
|---|---|
| `id` | Secured as above, quoted string. |
| `slug` | Generated from the intent; kebab-case, ASCII, ≤ 40 chars. |
| `status` | Always `draft` on first write. |
| `complexity` | From the user (INTERMEDIATE/FULL) or skill-judged (AUTO/MINIMAL). |
| `interaction-mode` | The mode the skill is running in. MAY be omitted in `draft`; the skill SHOULD write it explicitly to lock the choice. |
| `related-issue` | The GitHub issue number the skill is invoked against. |
| `version` | `1.0.0`. |
| `max-iterations` | Omitted by default (inherits ADR-0010's 5). |
| `superseded-by` | Omitted (only present for `superseded` status). |
| `unsecured-id` | Omitted. Present, and copied verbatim from the tool's stdout, only on the exit-`3` path above. |

The filename slug and the frontmatter slug SHALL match exactly.

The `status` field is written `draft` on first write and flipped to
`approved` in the spec-PR's own commit (the Merge mechanic). The subsequent
`approved` → `implemented` transition is **not** this skill's job: it is
recorded by the implementation team's `pr-logbook` on the implementation
feature branch, folded into the implementation PR's own squash commit
(`docs/spec-format.md` → *Recording a status transition*). This skill SHALL
NOT open a separate, post-merge, metadata-only PR to record `implemented`.

The spec-PR is opened as a Draft PR/MR (`gh pr create --draft`,
`glab mr create --draft`). After the approval flip is committed and pushed,
mark it ready (`gh pr ready`, `glab mr update --ready`), wait for the CI run
created by that ready transition, and only then merge. Procedure and per-forge
caveats: `docs/spec-pr-workflow.md` → *Draft-PR procedure*.

### Body sections

All five mandatory sections per `docs/spec-format.md` → *Mandatory body
sections* SHALL be present, in order, with their headings verbatim:

1. `## Intent` — one paragraph, no HOW words.
2. `## Requirements` — numbered list, every line uses SHALL or MUST.
3. `## Scenarios` — at least one happy-path AND at least one failure-path
   scenario in Given/When/Then form.
4. `## Out of scope` — bullet list; MAY be empty only for `trivial` tier.
5. `## Open questions` — bullet list; MAY be empty.

A section MAY be empty in `draft` (the linter checks header presence,
not body content) but the skill SHOULD avoid emitting empty sections
when content is derivable — empty sections in a draft are a smell the
spec reviewer will flag.

### Delta-spec mode

When the skill is invoked on a ticket that already has a parent spec
(activation trigger 3), the output file is named
`/specs/<NNNN>-<slug>.delta-<NN>.md` where `<NN>` is the next free
two-digit delta number for the parent. The body replaces the five
mandatory sections with the three delta sections defined in
`docs/spec-format.md` → *Delta-spec convention* (`## ADDED`,
`## MODIFIED`, `## REMOVED`), all three present even when empty.

### Self-validation (best-effort)

Before writing, the skill SHALL run the spec linter on the drafted file
(`task spec:lint -- specs/<NNNN>-<slug>.md`, i.e.
`scripts/lib/spec-linter.js`) and fix what it reports. It reads
`docs/spec-format.md` only when the linter output requires it. The linter
is the enforcement; this run replaces a manual re-read of the format.

In addition, per R18 of spec 0002, the skill SHALL enforce a mandatory
null-case and permitted-path self-check during the authoring phase. For
each drafted requirement, verify that the requirement explicitly answers
the null/degenerate case and names a permitted path, rather than solely
stating what is forbidden or describing only the happy path. If a
requirement fails this check, revise it before finalizing the draft.
