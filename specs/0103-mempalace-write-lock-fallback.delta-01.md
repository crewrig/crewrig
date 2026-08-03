---
id: "0103"
slug: mempalace-write-lock-fallback
status: draft
complexity: small
related-issue: 637
version: 2.0.0
---

# 0103 — mempalace-write-lock-fallback (delta-01)

This delta makes spec 0103's direct-filing fallback **forge-agnostic**.
The original Requirements 2 and 3 assumed GitHub unconditionally: R2 said
the fallback *"SHALL be to file the friction directly as a GitHub issue"*,
and the in-flight implementation (PR #669, drafted but not yet merged)
realized that literally — it hardcodes `gh issue create` and strips
`https://github.com/` from the `canonical` URL, so it silently breaks for
any component whose canonical repository lives on a non-GitHub forge.

That contradicts this project's own established convention: `AGENTS.md` →
*Forge Access* (single-sourced from `artifacts/core/rules/60-tools.md` →
*Forge Access*) mandates that forge operations are CLI-only and
forge-specific — `gh` for GitHub, `glab` for GitLab, `tea` for Gitea —
and CrewRig is explicitly multi-forge-capable: an adopting organization's
component can declare a `canonical` repository on a self-hosted GitLab or
Gitea instance, not only GitHub. A write-lock fallback that assumes GitHub
loses the friction signal for exactly those components.

The correction is grounded in data the friction payload already carries.
The `canonical:` field (`artifacts/core/system-context/friction-reporting-reference.md`
→ *Payload schema*; `harness-report/SKILL.md` → step 3) is the offender's
`provenance.canonical` value — a full `https://<host>/<owner>/<repo>` URL
whose host names its forge unambiguously — so selecting the correct CLI
from the URL host requires no new data collection.

This delta MODIFIES Requirements 2 and 3 and the two fallback scenarios,
and ADDS one requirement (the host→CLI selection rule) plus three
scenarios. Every other requirement of spec 0103 — Requirements 1 and 4–8
— is **UNCHANGED** and remains in force; in particular R8's payload-
substance preservation and R4's single-sourcing split between
`60-tools.md` (contract) and `harness-report/SKILL.md` (procedure) are
untouched. No open questions are introduced by this delta.

The version bump is **MAJOR** (`1.0.0` → `2.0.0`): R2 and R3 are modified
in a way that invalidates the in-flight PR #669 implementation, whose
unconditional GitHub assumption must be reworked to conform. Per
`docs/spec-format.md` → *Delta-spec convention → Versioning*, a
"requirement modified … in a way that invalidates an in-flight
implementation" is the MAJOR trigger.

## ADDED

1. **New requirement — forge selection is derived from the canonical URL
   host.** The following requirement SHALL be added to spec 0103's
   `## Requirements` (numbered R9, continuing the parent's list):

   > **R9.** The direct-filing fallback SHALL select the forge
   > command-line tool from the host of the offender's `canonical`
   > repository URL — a `github.com` host selects `gh`; a `gitlab.com`
   > host, a host whose name begins with `gitlab.`, or a host the
   > environment is already configured to treat as a self-hosted GitLab
   > instance selects `glab`; any other self-hosted host is assumed to be
   > a Gitea instance and selects `tea` — consistent with `AGENTS.md` →
   > *Forge Access*. This is written guidance for an agent to apply by
   > reading the URL, not a pattern to codify in a regular expression;
   > when a host is genuinely ambiguous the agent SHALL prefer the tool
   > whose authenticated login is already established for that host. When
   > the offender cannot be identified and `canonical` is empty (per R8
   > and the payload convention), the fallback SHALL default to the
   > framework's own canonical repository and the forge that hosts it,
   > mirroring the manual filing of issues #636 and #637.

2. **New scenario — GitLab-hosted canonical files via `glab`.** The
   following scenario SHALL be added to spec 0103's `## Scenarios`:

   ```text
   **Scenario:** GitLab-hosted canonical — fallback files via glab

   Given the MemPalace write path is unavailable (a peer lock persists
         after one retry, or the server is disconnected)
   And   the offender's canonical repository URL host identifies a GitLab
         instance (gitlab.com or a self-hosted gitlab.<org> host)
   When  the agent applies the direct-filing fallback
   Then  it files the friction as a harness-feedback-labeled issue on that
         repository using glab, not gh
   ```

3. **New scenario — Gitea-hosted canonical files via `tea`.** The
   following scenario SHALL be added to spec 0103's `## Scenarios`:

   ```text
   **Scenario:** Gitea-hosted canonical — fallback files via tea

   Given the MemPalace write path is unavailable
   And   the offender's canonical repository URL host is neither
         github.com nor a recognized GitLab host (a self-hosted Gitea
         instance)
   When  the agent applies the direct-filing fallback
   Then  it files the friction as a harness-feedback-labeled issue on that
         repository using tea, not gh
   ```

4. **New scenario — unknown offender defaults to the framework forge.**
   The following scenario SHALL be added to spec 0103's `## Scenarios`:

   ```text
   **Scenario:** Unknown offender — fallback defaults to the framework forge

   Given the MemPalace write path is unavailable
   And   the offender cannot be identified, so canonical is empty
   When  the agent applies the direct-filing fallback
   Then  it files the friction on the framework's own canonical repository
         using the forge tool that hosts it, and the friction signal is
         still recorded rather than lost
   ```

5. **New out-of-scope bullet — the curator's automated path is untouched.**
   The following bullet SHALL be added to spec 0103's `## Out of scope`:

   > - This delta amends only the manual write-lock-fallback procedure
   >   spec 0103 introduced in `harness-report/SKILL.md`. It does not touch
   >   the `harness-curator`'s automated apply path
   >   (`artifacts/library/skills/harness-curator/scripts/apply.py`), which
   >   itself hardcodes GitHub (`target.replace("https://github.com/", "")`
   >   and `gh issue create`). That GitHub-only assumption in the normal
   >   curator-mediated path is a **separate, pre-existing** gap — not
   >   introduced by spec 0103 or its implementation — and is out of scope
   >   here; it is worth an independent future friction or ticket.

## MODIFIED

1. **Requirement 2 is replaced** to make the fallback forge-agnostic.

   - Original R2:

     > **R2.** The documented fallback SHALL be to file the friction
     > directly as a GitHub issue on the canonical repository, mirroring
     > the manual workaround already used for the GitHub issues #636 and
     > #637.

   - Replacement R2:

     > **R2.** The documented fallback SHALL be to file the friction
     > directly as an issue on the offender's canonical repository, using
     > the forge-appropriate command-line tool — `gh` for a GitHub-hosted
     > repository, `glab` for a GitLab-hosted repository, `tea` for a
     > Gitea-hosted repository — selected from the host of the canonical
     > repository URL rather than assuming GitHub unconditionally,
     > consistent with `AGENTS.md` → *Forge Access*. The manual workaround
     > used for issues #636 and #637 (filed on the framework's own
     > GitHub-hosted canonical repository) remains one valid instance of
     > this rule, not the only target.

2. **Requirement 3 is replaced** to state the label name is
   forge-independent.

   - Original R3:

     > **R3.** The directly-filed friction issue SHALL carry the
     > `harness-feedback` label, so the direct-filing path lands in the
     > same triage lane as a friction that reaches GitHub through the
     > normal MemPalace-mediated curator path.

   - Replacement R3:

     > **R3.** The directly-filed friction issue SHALL carry the
     > `harness-feedback` label, so the direct-filing path lands in the
     > same triage lane as a friction that reaches the forge through the
     > normal MemPalace-mediated curator path. `harness-feedback` is a
     > single, forge-independent wire-protocol label name — the curator
     > applies the identical label name on every target repository (see
     > `artifacts/library/skills/harness-curator/scripts/setup-labels.sh`
     > and `curate.py`) — so this spec introduces **no** per-forge
     > label-name mapping; the label name SHALL NOT vary by forge. The
     > only forge-conditional precondition is that the `harness-feedback`
     > label already exist on the target repository, provisioned by that
     > instance's own label setup.

3. **Scenario "Peer-writer lock — one retry, then direct GitHub filing"
   is replaced** to generalize the GitHub-specific outcome to the selected
   forge.

   - Original scenario:

     ```text
     **Scenario:** Peer-writer lock — one retry, then direct GitHub filing

     Given a peer MCP writer holds the write lock and `mempalace_add_drawer`
           returns MCP error `-32001`
     When  the agent applies the documented fallback
     Then  it retries the tag at most once and, the lock still holding, files
           the friction as a `harness-feedback`-labeled GitHub issue on the
           canonical repository
     ```

   - Replacement scenario:

     ```text
     **Scenario:** Peer-writer lock — one retry, then direct forge filing

     Given a peer MCP writer holds the write lock and mempalace_add_drawer
           returns MCP error -32001
     And   the offender's canonical repository is hosted on GitHub
     When  the agent applies the documented fallback
     Then  it retries the tag at most once and, the lock still holding, files
           the friction as a harness-feedback-labeled issue on the canonical
           repository using the forge tool selected for its host (here gh)
     ```

4. **Scenario "MemPalace disconnected — direct GitHub filing, no retry"
   is replaced** to generalize the GitHub-specific outcome to the selected
   forge.

   - Original scenario:

     ```text
     **Scenario:** MemPalace disconnected — direct GitHub filing, no retry

     Given the MemPalace MCP server is unreachable and all its tools are
           unavailable
     When  the agent applies the documented fallback
     Then  it files the friction as a `harness-feedback`-labeled GitHub issue
           on the canonical repository without attempting any retry against
           MemPalace
     ```

   - Replacement scenario:

     ```text
     **Scenario:** MemPalace disconnected — direct forge filing, no retry

     Given the MemPalace MCP server is unreachable and all its tools are
           unavailable
     And   the offender's canonical repository is hosted on GitHub
     When  the agent applies the documented fallback
     Then  it files the friction as a harness-feedback-labeled issue on the
           canonical repository using the forge tool selected for its host
           (here gh) without attempting any retry against MemPalace
     ```

## REMOVED

(None. This delta modifies Requirements 2 and 3 and two scenarios, and
adds one requirement and three scenarios; it removes no requirement,
scenario, or out-of-scope item. Requirements 1 and 4–8 of spec 0103
remain in force unchanged.)
