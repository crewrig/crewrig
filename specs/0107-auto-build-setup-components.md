---
id: "0107"
slug: auto-build-setup-components
status: draft
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 618
version: 1.0.0
---

# Auto-build setup components when the staging tree is missing

## Intent

Running any of the four interactive setup scripts for the first time on a
fresh clone — before the component staging tree has ever been produced for
the tool at hand — no longer leaves library, community, or organization
skills and agents silently un-installed behind a one-line warning. The
setup script produces what is missing for its own tool first, then installs
every tier exactly as it already does today, so a first-time run delivers
the same result as building manually beforehand — including validation-gate
skills such as `user-validate` that the current gap silently drops.

## Requirements

1. Each of the four interactive setup scripts (`setup-gemini-interactive.sh`,
   `setup-claude-interactive.sh`, `setup-copilot-interactive.sh`,
   `setup-antigravity-interactive.sh`) SHALL check, before installing the
   `library` tier to the user's home directory, whether the staging path its
   own `install_tier_to_home` already reads for the `library` tier (
   `dist/library/.gemini`, `dist/library/.claude`,
   `dist/library/.github/skills`, `dist/library/.agents`, respectively)
   exists.
2. When that path is missing, the setup script SHALL build the missing
   components for its own targeted tool automatically, with no interactive
   confirmation prompt, before installing any tier.
3. The triggered build SHALL be scoped to the script's own tool only, never
   to the full four-tool build.
4. When the triggered build exits non-zero (a missing prerequisite such as
   `yq` or `jq`, or any other build-time error), the setup script SHALL
   abort with a non-zero exit status and a message identifying the build
   failure, instead of continuing to install a partially-populated or empty
   staging tree.
5. When the staging path already exists — a prior build already ran,
   regardless of how long ago — the setup script SHALL NOT re-trigger a
   build and SHALL proceed exactly as it does today.
6. The detection condition, the automatic trigger, and the failure-abort
   behavior SHALL be identical across all four interactive setup scripts —
   a test exercising one script's behavior SHALL produce the same
   observable outcome when run against any of the other three.

## Scenarios

**Scenario:** first run on a fresh clone builds automatically

```text
Given a fresh clone of the repository where dist/ does not exist and the
      Gemini CLI target's required tools (yq, jq) are installed
When  the user runs setup-gemini-interactive.sh
Then  the script builds the Gemini-targeted components before the
      "Installing library components" step, dist/library/.gemini/skills/
      user-validate/ exists afterward, and the skill is installed to
      ~/.gemini/skills/user-validate/ without the user having run
      build-components.sh manually
```

**Scenario:** build failure aborts the setup instead of a partial install

```text
Given a fresh clone where dist/ does not exist and yq is not installed on
      the machine
When  the user runs setup-claude-interactive.sh
Then  the triggered build fails, the setup script exits non-zero with a
      message naming the build failure, and no skill or agent is copied to
      ~/.claude/skills/ or ~/.claude/agents/
```

**Scenario:** an existing build is left untouched

```text
Given dist/library/.claude already exists from a prior manual or automatic
      build
When  the user runs setup-claude-interactive.sh again
Then  the script does not re-trigger a build, prints no build-related
      message, and installs the already-staged components exactly as it
      does today
```

## Out of scope

- Detecting or rebuilding a staging tree that exists but is stale relative
  to `artifacts/` source changes, or partially built (some tiers present,
  others missing) for the same tool — a possible follow-up ticket, not this
  one.
- Any change to `build-components.sh` itself (its `--target` flag, its tier
  discovery, its output layout) beyond invoking it from the setup scripts.
- Non-interactive or CI-only setup entry points — none exist today; only the
  four `setup-*-interactive.sh` scripts are in scope.
- Adding an opt-out flag (e.g. `--no-build`) to skip the automatic build —
  not requested by the issue; the automatic, non-interruptive trigger is the
  sole behavior specified.

## Open questions

