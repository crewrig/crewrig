---
id: "0121"
slug: antigravity-outputs-in-core-paths
status: implemented
complexity: standard
interaction-mode: AUTO
related-issue: 755
version: 1.0.0
---

# Antigravity built outputs carry the same upstream-sync guarantee as their siblings

## Intent

A fork that synchronises from upstream today comes away with current Claude
Code, Gemini CLI, and GitHub Copilot CLI component outputs but with whatever
Antigravity component outputs it happened to already have, and nothing says
so at the time; the divergence only surfaces later, when a drift check on the
built components fails for no apparent reason and the adopter has to work
backwards to the cause. After this spec, every set of built component outputs
the repository ships carries the same synchronisation guarantee whichever CLI
it targets, a locally edited Antigravity output stops a synchronisation the
same way a locally edited Claude Code output already does, and a further set
of built outputs cannot enter the repository while that guarantee is missing.

## Requirements

1. A fork that synchronises from upstream SHALL come away with its Antigravity
   component outputs at the same upstream revision as its Claude Code, Gemini
   CLI, and GitHub Copilot CLI component outputs.
2. Every directory that the component build writes component outputs into
   SHALL carry the same upstream-synchronisation guarantee as every other such
   directory, and no such directory SHALL be left without one.
3. A local modification to a built Antigravity component output SHALL halt an
   upstream synchronisation and name the affected core-layer path, exactly as
   a local modification to a built Claude Code, Gemini CLI, or GitHub Copilot
   CLI component output does.
4. Adopter-local Antigravity CLI state SHALL remain outside the
   upstream-synchronisation guarantee, so that it is never restored over and
   never halts a synchronisation.
5. The continuous-integration build SHALL fail whenever a directory that the
   component build writes component outputs into carries no
   upstream-synchronisation guarantee, and SHALL name that directory in its
   output.
6. The guard required in requirement 5 SHALL itself be exercised on every
   continuous-integration run against at least one case it is expected to
   reject, so that a guard which has stopped detecting the condition fails the
   build instead of passing it.
7. The core-layer classification of the Antigravity component output
   directories SHALL be stated in both the human-readable and the
   machine-readable record of the core layer, and the two statements SHALL
   agree.

## Scenarios

**Scenario:** an upstream sync brings a fork's Antigravity outputs up to date

```text
Given a fork whose `.agents/skills/spec-author/SKILL.md` and
      `.agents/agents/spec-author/AGENT.md` sit at an older upstream revision
When  the adopter synchronises from upstream across the commit that changed
      those two files
Then  both files match upstream's content at the synchronised revision, and a
      subsequent drift check over the built components reports no drift
```

**Scenario:** a locally edited Antigravity output halts the synchronisation

```text
Given an adopter has hand-edited `.agents/agents/developer/AGENT.md`
When  the adopter synchronises from upstream
Then  the synchronisation halts without restoring anything, and names the
      Antigravity output directory among the core-layer paths carrying local
      modifications, exactly as a hand-edited `.claude/agents/developer/AGENT.md`
      makes it name the Claude Code one
```

**Scenario:** adopter-local Antigravity state survives a synchronisation

```text
Given an adopter has written `.agents/settings.local.json` with local settings
When  the adopter synchronises from upstream
Then  the synchronisation neither halts on that file nor changes its content
```

**Scenario:** a built output directory without the guarantee fails the build

```text
Given a change that teaches the component build to write component outputs
      into a directory that carries no upstream-synchronisation guarantee
When  continuous integration runs on that change
Then  the build fails and names that directory
```

**Scenario:** a guard that has stopped detecting the condition fails the build

```text
Given the guard required in requirement 5 no longer reports a built output
      directory that carries no upstream-synchronisation guarantee
When  continuous integration runs
Then  the build fails, rather than reporting the repository clean
```

## Out of scope

- `.agents/ANTIGRAVITY.md` and `.agents/settings.local.json.example`. Both are
  tracked, and neither is written by the component build, so requirement 2
  does not reach them and this spec leaves their classification unchanged.
  This is deliberate and follows the standing shape of the manifest: no CLI
  output root is claimed whole — each is claimed through the subdirectories
  the build writes — and `.claude/settings.json` and
  `.claude/scheduled_tasks.lock` are tracked and unguaranteed for the same
  reason. Claiming the `.agents` root whole would hand Antigravity a broader
  guarantee than any sibling holds, and would sweep in a settings template of
  exactly the class that already needed a carve-out on the Copilot side
  (`.github/copilot/settings.json`, spec 0097). Whether those two files
  deserve a guarantee of their own is a separate classification decision and
  belongs to a separate ticket.
- `.agents/settings.local.json`. It is already untracked and adopter-local, so
  requirement 4 records the property rather than changing anything.
- Any path that is not a directory the component build writes component
  outputs into — per-CLI source material and configuration in particular.
  Requirement 2's property is bounded to built outputs, and this spec changes
  no other path's classification.
- Repairing forks that already carry stale Antigravity outputs. Re-running the
  component build regenerates them from the synchronised sources, so no
  migration path is specified here.
- Any change to what the component build produces for Antigravity, or to which
  CLIs it targets. This spec is about the guarantee over the outputs, not
  about the outputs themselves.
- Extending requirement 5's guard to output paths the build writes outside the
  repository tree, such as a CLI's user-level installation directory. Those
  are installed, not committed, and no synchronisation guarantee applies to
  them.

## Open questions

None. The two decisions this spec carried while drafting are closed rather
than parked: the granularity question (claim the `.agents` root whole, or the
two subdirectories the build writes) is settled in favour of the
subdirectories, with the sibling precedent and the two excluded files recorded
in `Out of scope`; and the question of whether a `small`-tier ticket warrants
a mechanical guard rather than a corrected record alone is settled in favour
of the guard, in requirements 5 and 6 — the record already drifted once
without anything noticing, and a guard for the opposite direction of the same
property already runs in continuous integration, so the marginal cost is an
extension of an existing check rather than a new one.
