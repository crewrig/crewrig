---
id: "0204"
slug: protect-org-compiled-skills-from-sync-orphan-cleanup
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 1137
version: 1.0.0
---

# Protect organization-owned compiled skills from synchronization orphan cleanup

## Architectural Context and Decisions

### Background

CrewRig defines compiled output directories (`.claude/skills/`,
`.gemini/skills/`, `.gemini/commands/`, `.github/skills/`, and
`.agents/skills/`) as assembly zones (`docs/layers.md`). After a component
build, these directories host both core-provided harness components
and an adopting organization's own compiled components authored under
`artifacts/org/`.

Spec 0064 established the strict-directory orphan cleanup mechanism in
`scripts/sync-from-upstream.sh`: after restoring upstream files from
`FETCH_HEAD`, any locally tracked file absent from `FETCH_HEAD` is deleted
from the working tree as an upstream-deleted orphan.

During epic #1100 seam (e) (spec 0199, issue #1119), Decision 7 kept the
compiled skill and command output trees under the `strict` synchronization
policy, noting that organization components are additions that the strict
dirty guard ignores. However, Decision 7 overlooked that spec 0064 orphan
cleanup executes against every locally tracked file in strict directories.
Consequently, whenever an adopting organization commits its own compiled
skills or commands, running `scripts/sync-from-upstream.sh` deletes them
as spurious upstream orphans.

### Alternatives Considered

1. **Reclassify compiled skill and command trees to `regenerable`.**
   Under spec 0199 Decision 6 and test case `uu`, directory entries governed
   by `regenerable` execute the identical spec 0064 orphan cleanup loop as
   `strict` entries. Reclassifying skill trees to `regenerable` would not
   prevent the deletion of organization skills without altering orphan cleanup
   itself. Additionally, `regenerable` permits local divergence of upstream
   files without aborting synchronization; because compiled skills carry no
   organization model-mapping overrides, weakening the strict dirty guard
   would sacrifice detection of accidental modifications to core skills.
   *Rejected.*

2. **Introduce a fifth synchronization policy.**
   Adding an explicit policy token (e.g. `assembly`) in
   `.crewrig/core-paths.txt` would necessitate alterations to manifest
   parsing, `scripts/check-core-paths.sh`, and documentation across
   `docs/layers.md`. Because the behavior sought is strict enforcement of
   upstream-owned members combined with preservation of legitimate
   organization additions, introducing a new policy multiplies manifest
   complexity without functional benefit over refining orphan cleanup.
   *Rejected.*

3. **Exclude organization-tier compiled outputs from orphan cleanup.**
   In assembly directories, orphan cleanup distinguishes between files
   that upstream previously provided and subsequently deleted, and files
   originating from the organization's own definitions under `artifacts/org/`.
   Organization-owned additions remain untouched during synchronization, while
   genuine upstream deletions continue to be purged. The compiled skill and
   command directories remain `strict`, preserving the integrity guard over
   core harness skills.
   *Accepted.*

## Intent

An adopting organization that authors and commits its own skills or commands
in its repository checkout retains those compiled files across upstream
synchronizations. The synchronization process removes components that
upstream has deleted without treating the organization's own additions as
upstream orphans.

## Requirements

1. The synchronization process SHALL preserve locally tracked compiled skills
   and commands that correspond to active organization-tier component
   definitions during upstream synchronization.
2. The synchronization process SHALL NOT emit upstream-deletion removal
   notices for preserved organization-tier compiled skills and commands.
3. The synchronization process SHALL continue to delete locally tracked files
   in strict compiled directories when those files are absent from upstream
   and do not correspond to active organization-tier component definitions.
4. When an organization-tier component definition is removed from the
   repository, subsequent synchronization SHALL treat any remaining locally
   tracked compiled outputs for that component as orphans and remove them.
5. The synchronization manifest `.crewrig/core-paths.txt` policies for
   compiled skill and command trees SHALL remain strict.
6. The dirty-detection phase for strict directories SHALL continue to abort
   synchronization when upstream-owned files contain local modifications,
   while permitting organization additions.
7. The synchronization regression test suite SHALL verify the preservation of
   organization-tier compiled skills, the continued deletion of
   upstream-deleted files, and the cleanup of retired organization skills.

## Scenarios

**Scenario:** Organization-owned compiled skill preserved during sync

Given an adopting repository with an organization skill definition in
`artifacts/org/skills/org-helper/`
And locally tracked compiled outputs in `.claude/skills/org-helper/SKILL.md`
And an upstream state that does not contain `org-helper`
When the synchronization script executes
Then `.claude/skills/org-helper/SKILL.md` is not deleted
And no removal notice is emitted for `org-helper`
And the synchronization exits successfully.

---

**Scenario:** Upstream-deleted core skill removed during sync

Given an adopting repository with a locally tracked core skill
`.claude/skills/retired-core/SKILL.md`
And an upstream state where `retired-core` was removed
And no component named `retired-core` exists under `artifacts/org/`
When the synchronization script executes
Then `.claude/skills/retired-core/SKILL.md` is deleted from the working tree
And a removal notice is emitted for the deleted file
And the synchronization exits successfully.

---

**Scenario:** Retired organization skill cleaned up after source removal

Given an adopting repository where an organization skill definition was
removed from `artifacts/org/skills/`
And stale compiled outputs remain tracked in `.claude/skills/old-org/SKILL.md`
And upstream does not contain `old-org`
When the synchronization script executes
Then `.claude/skills/old-org/SKILL.md` is deleted from the working tree
And a removal notice is emitted for `old-org`
And the synchronization exits successfully.

---

**Scenario:** Local modification to upstream core skill aborts sync

Given an adopting repository where an upstream-owned file
`.claude/skills/developer/SKILL.md` has uncommitted or diverged local edits
When the synchronization script executes
Then synchronization aborts with an error naming the modified strict path
And no working tree files are modified or deleted.

## Out of scope

- Compiled agent output trees (`.claude/agents`, `.gemini/agents`,
  `.github/agents`, `.agents/agents`), which were reclassified as
  `regenerable` under spec 0199.
- Non-compiled strict directories (such as `scripts/` or
  `artifacts/core/`), which contain no organization-tier assembly outputs.
- User-home-installed component locations (`~/.claude/skills/`,
  `~/.gemini/skills/`), which are managed out-of-band by setup and component
  installer scripts.

## Open questions

*(None. All design alternatives were evaluated and resolved in the Architectural
Context and Decisions section.)*
