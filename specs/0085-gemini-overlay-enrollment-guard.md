---
id: "0085"
slug: gemini-overlay-enrollment-guard
status: draft
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 579
version: 1.0.0
---

# Every deployed Gemini overlay is enrolled in the context manifest

## Intent

After this change, the project's continuous integration guarantees that every
user-level context overlay the Gemini setup flow deploys to the Gemini home
directory is also enrolled in the manifest Gemini actually reads, so a deployed
overlay can no longer be silently ignored the way the priority-65 and
priority-66 overlays were before their fix. When a future overlay is added to
the deploy set but left out of enrollment, the build fails and names the missing
overlay, instead of the omission surviving until a manual audit. The check also
surfaces the reverse drift — an overlay left enrolled but no longer deployed — as
a non-blocking warning, while treating the repository-root agent-rules file,
which Gemini reads directly rather than having it deployed, as a legitimate
exception that never fails or warns.

## Requirements

1. A continuous-integration check SHALL fail the build whenever an overlay that
   `scripts/setup-gemini-interactive.sh` deploys to the Gemini home directory is
   absent from the `context.fileName` list in `config/gemini/settings.json`, and
   SHALL name the offending overlay or overlays in its output.
2. The check SHALL derive both the set of deployed overlays and the set of
   enrolled overlays from the project's own sources — the setup script and the
   settings file — rather than from a hard-coded list, so that an overlay added
   later is covered without editing the check.
3. The check SHALL recognize a deployed overlay whether its deployment names the
   target filename directly or through an intermediate target, so that the
   user-profile overlay — whose deployment target is expressed indirectly — is
   not missed.
4. The check SHALL recognize a deployed overlay even when its deployment is
   conditionally guarded, so that the priority-66 org-rules overlay, deployed
   only when the organization-rules file is present, is covered.
5. The check SHALL treat the repository-root `AGENTS.md` entry in
   `context.fileName` as a legitimate enrolled-but-not-deployed exception,
   neither failing nor warning on it.
6. The check SHALL emit a non-blocking warning when an enrolled entry other than
   the `AGENTS.md` exception is not deployed by the setup script, and SHALL NOT
   fail the build on that condition alone.
7. The check SHALL pass on the current tip of `main`, where every deployed
   overlay is enrolled.
8. The check SHALL run in the project's continuous integration on every pull
   request, and its wiring SHALL be consistent across every maintained
   continuous-integration surface the project generates.
9. A regression test SHALL accompany the check and SHALL demonstrate both that
   the check fails against the pre-fix state — the priority-65 and priority-66
   overlays removed from `context.fileName` — and that it passes against the
   enrolled state.

## Scenarios

**Scenario:** current tip of main is fully enrolled (happy path)

```text
Given a clean checkout of `main` after this specification is realized,
When   the enrollment check runs over the setup script's deployed-overlay set
       and the `context.fileName` list,
Then   every deployed overlay is found enrolled and the check passes.
```

**Scenario:** a deployed overlay is not enrolled (failure path)

```text
Given a state in which the setup script deploys an overlay that is absent from
      `context.fileName` (for example the pre-fix state with the priority-65 and
      priority-66 overlays removed from enrollment),
When   the enrollment check runs,
Then   the check fails, names the missing overlay or overlays, and the build is
       red.
```

**Scenario:** an overlay with an indirect deployment target is still covered (coverage)

```text
Given the setup script deploys the user-profile overlay through an intermediate
      target rather than naming the target filename directly,
When   the enrollment check computes the deployed-overlay set,
Then   the user-profile overlay is present in that set and is checked for
       enrollment like any other overlay.
```

**Scenario:** an enrolled overlay is no longer deployed (non-blocking warning)

```text
Given an entry in `context.fileName`, other than the `AGENTS.md` exception, that
      the setup script does not deploy,
When   the enrollment check runs,
Then   the check emits a warning naming that entry, does not fail the build, and
       emits no warning for the `AGENTS.md` entry.
```

## Out of scope

- Removing the drift at its source by generating `context.fileName` from the
  setup script's deploy set (or vice versa) so the two lists cannot diverge; this
  spec adds a guard against the divergence, it does not eliminate the two-list
  design. The single-source-of-truth refactor is deferred to a future ticket.
- The three other CLIs (Claude Code, Copilot, Antigravity), which auto-discover a
  directory or concatenate all overlays and therefore have no enrollment list
  that can drift; the guard is Gemini-specific by construction.
- End-to-end verification that Gemini actually loads the enrolled overlays at
  session time; that runtime property is covered by the layered-context
  end-to-end pillar. This check asserts enrollment, not runtime loading.
- Any change to what the setup script deploys or to what `context.fileName`
  enrolls; this spec adds a guard over the existing deploy and enrollment sets
  and alters neither.
- The realization mechanism of the check — its language, the technique it uses to
  read the two sources, and its exit-status scheme — which is a PLAN and DEV
  concern.

## Open questions

- None. The reverse-check scope (a non-blocking warning with the `AGENTS.md`
  entry as the sole enrolled-but-not-deployed exception) and the complexity tier
  (`small`) were resolved with the user during authoring.
