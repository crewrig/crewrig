---
id: "0105"
slug: forge-agnostic-curator-apply
status: implemented
complexity: small
interaction-mode: AUTO
related-issue: 671
version: 1.0.0
---

# Forge-agnostic curator apply step

## Intent

When the harness curator opens a feedback issue for a friction cluster, the
issue lands on whichever forge actually hosts the offending component's
canonical repository, instead of always assuming a single forge. A cluster
whose canonical repository lives on a forge other than the framework's own no
longer misroutes or fails silently — both the duplicate check that prevents
re-opening the same issue and the issue that is finally filed reach the
correct forge — so the automated feedback loop covers every component the
project's multi-forge policy already allows.

## Requirements

1. The apply step SHALL select the forge command-line tool from the host of
   the cluster's target (canonical) repository URL: a `github.com` host
   selects `gh`; a `gitlab.com` host, a host whose name begins with
   `gitlab.`, or a host configured as a self-hosted GitLab instance selects
   `glab`; any other host selects `tea` (Gitea) — consistent with
   `AGENTS.md` → *Forge Access* and spec 0103 R9.
2. The issue-creation invocation SHALL use the selected tool's own
   subcommand and flag names — `gh issue create --body` for GitHub, `glab
   issue create --description` for GitLab, `tea issues create --description`
   for Gitea — passing the cluster title, the cluster body, and the cluster
   labels (at minimum `harness-feedback`, plus any `room:` and `severity:`
   labels the cluster carries) through the flag each tool expects.
3. The repository reference passed to the selected tool SHALL be derived from
   the canonical URL so each tool receives a reference it accepts —
   `owner/repo` for `gh`, a reference `glab` resolves (covering self-hosted
   hosts and subgroups) for GitLab, `owner/repo` for `tea` — after first
   stripping any `/blob/…` or `/tree/…` file-URL suffix (the existing issue
   #63 defensive normalization).
4. The `harness-feedback` label name SHALL be identical on every forge; the
   apply step MUST NOT vary the label name by forge (a single
   forge-independent wire label, per spec 0103 R3).
5. The duplicate-detection lookup SHALL query open `harness-feedback` issues
   on the selected forge through that tool's own list or search invocation
   and SHALL decide the skip on the canonical title prefix `Friction cluster:
   <key> (`; the skip decision MUST NOT depend on any forge-specific field
   beyond the issue title.
6. Parsing the list output for the matched issue URL SHALL read the URL
   defensively across the forges' differing JSON shapes, and the lookup MUST
   fail open — treating any error as no-match and letting the cluster's issue
   be opened — preserving the current behavior that a missed friction is
   worse than a duplicate.
7. `--dry-run-apply` SHALL emit the resolved forge argv for each cluster so
   the selected tool and its arguments are inspectable without contacting any
   forge, and the emitted argv for a GitHub-hosted canonical MUST remain
   byte-for-byte unchanged from the current output (no regression to existing
   behavior or tests).
8. Every existing apply-step behavior for a GitHub-hosted canonical SHALL be
   preserved: the `opened_as` drawer write-back (issue #69), the `/blob/` and
   `/tree/` normalization warning (issue #63), the missing-`_drawer_id`
   warnings, and the run summary.

## Scenarios

**Scenario:** GitHub-hosted canonical — apply resolves to gh, argv unchanged

```text
Given a friction cluster whose target (canonical) repository URL host is
      github.com
When  the apply step resolves the forge invocation for that cluster
Then  it builds a gh issue create invocation and the resolved argv is
      byte-for-byte identical to the current GitHub output
```

**Scenario:** GitLab-hosted canonical — apply resolves to glab

```text
Given a friction cluster whose canonical repository URL host is gitlab.com or
      a host whose name begins with gitlab.
When  the apply step resolves the forge invocation for that cluster
Then  it builds a glab issue create --description invocation with the cluster
      labels passed, not a gh invocation
```

**Scenario:** Gitea-hosted canonical — apply resolves to tea

```text
Given a friction cluster whose canonical repository URL host is neither
      github.com nor a recognized GitLab host (a self-hosted Gitea instance)
When  the apply step resolves the forge invocation for that cluster
Then  it builds a tea issues create --labels invocation, not a gh invocation
```

**Scenario:** Dedup on a non-GitHub target — skip decided on the title prefix

```text
Given dedup is enabled and an open harness-feedback issue already exists on a
      GitLab- or Gitea-hosted target repository whose title starts with
      "Friction cluster: <key> ("
When  the apply step runs the duplicate-detection lookup for that cluster
Then  it queries the target through the selected tool's own list invocation
      and skips the cluster on the title-prefix match, independent of the
      forge's URL field name
```

**Scenario:** Dedup lookup errors on the target — fail open

```text
Given dedup is enabled and the duplicate-detection lookup against the target
      forge fails (a tool error or unparseable output)
When  the apply step evaluates the lookup result
Then  it treats the failure as no-match and still opens the cluster's issue
```

## Out of scope

- `setup-labels.sh` (which provisions the `harness-feedback` label through
  the GitHub-only `gh label create`) and `schedule-curator.sh` (whose
  messaging and status-check calls are GitHub-only). A fully multi-forge
  curator also needs these two scripts made forge-agnostic; that is a
  **separate follow-up ticket**, not covered by this spec.
- Multi-login disambiguation when several authenticated logins exist for the
  same forge kind, and ambiguous-host resolution beyond the deterministic
  host rule in R1 (including an optional self-hosted-GitLab host override).
  The manual path's "prefer the already-established login" is agent judgment
  (spec 0103 R9) and does not apply to this automated, deterministic path.
- The auto-fix mode (issue #42) and any change to `curate.py` clustering,
  routing, or target-repository selection. This spec changes only how the
  apply step files against the target `curate.py` has already chosen.

## Open questions

None — every requirement is resolved by design.
