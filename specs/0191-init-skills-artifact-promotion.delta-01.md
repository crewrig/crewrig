---
id: "0191"
slug: init-skills-artifact-promotion
status: approved
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 1077
version: 1.1.0
---

# Promote init-personal-profile and init-soul to single-source artifact components — delta 01

A DEV-stage probe of requirement 5 crossed this spec's contract in two ways, and
this delta records both. First, Gemini CLI 0.46.0's `SkillCommandLoader` mints an
invocable `/<name>` slash command from every discovered, non-disabled skill — a
second path alongside the model-side `activate_skill` activation the vendor
documentation describes — so requirement 2's rationale, one `## Out of scope`
bullet and one failure-path scenario each assert something false about that CLI.
All three are corrected under `## MODIFIED`; requirement 2's normative
obligation — `type: command` at `artifacts/core/commands/<name>.md` — is
unchanged, and the `command` kind remains the mandated kind. Second, that same
minting collides with the native command requirement 3 already emits: both
Gemini-visible outputs of one command source claim the same bare name, Gemini's
resolver renames both away rather than picking a winner, and the published
`gemini "/init-personal-profile"` invocation resolves to nothing. `## ADDED`
requires the arbitrated fix — a project-scoped Gemini settings file suppressing
Gemini's skill-command minting for exactly these two names — together with its
accepted trade-off and its failure path. The probe record is the three DEV
logbook comments on issue #1077: the collision discovery, probes P1–P3, and
probes P4–P6.

## ADDED

**Requirements.**

1. **Requirement 14 — the project-scoped Gemini settings file.** The
   implementation SHALL commit, in the same diff, a `.gemini/settings.json` at
   the repository root whose `skills.disabled` array names exactly
   `init-personal-profile` and `init-soul`, so that Gemini CLI does not mint a
   skill-derived `/<name>` slash command for either and the native
   `.gemini/commands/<name>.toml` command remains the sole claimant of each bare
   name. `skills.disabled` is Gemini CLI's own documented setting
   (`docs/reference/configuration.md`: *"List of disabled skills"*, default
   `[]`, requires restart), and `.gemini/settings.json` at a project root is the
   workspace scope that same document defines. The file does not exist in this
   repository today and is therefore created by this change rather than edited.
   It SHALL NOT be conflated with `config/gemini/settings.json`, the user-level
   template this framework deploys to `~/.gemini/settings.json`, which SHALL NOT
   carry this key: the suppression has to travel with the clone rather than with
   an adopter's machine.
2. **Requirement 15 — the disable list SHALL name those two names and nothing
   else.** The committed `.gemini/settings.json` SHALL list no skill beyond the
   two this spec promotes, and SHALL declare no Gemini setting other than
   `skills.disabled`. A blanket or wider suppression is prohibited because every
   other skill the clone ships depends on the discovery this key removes; a
   future component needing the same treatment SHALL be added to the list by its
   own ticket, which is the permitted path for growing it.
3. **Requirement 16 — the acceptance conditions, live-probed.** In a fresh clone
   carrying this change, with Gemini CLI launched from the repository root, all
   three of the following SHALL hold, and each SHALL be confirmed by a live probe
   of that CLI rather than by documentation inference — the same evidence
   discipline requirement 5 imposes: (a) Gemini CLI's startup command-registry
   diagnostics report no `Conflicts detected` entry naming either component;
   (b) `gemini skills list --all` reports both names as `[Disabled]`; (c)
   `gemini "/init-personal-profile"` and `gemini "/init-soul"` each resolve under
   the bare name to the corresponding `.gemini/commands/<name>.toml` workspace
   command and start the interview.
4. **Requirement 17 — the other two command-kind outputs SHALL be unaffected,
   and re-probed to prove it.** This delta SHALL alter neither
   `.agents/skills/<name>/SKILL.md` nor `.github/skills/<name>/SKILL.md` for
   either component, and SHALL change no behavior of Antigravity CLI or GitHub
   Copilot CLI, neither of which reads a Gemini settings file. The four
   requirement-5 probes for those two CLIs SHALL be re-run on the tree that
   carries `.gemini/settings.json` rather than inherited from a probe taken
   before it existed, so that "unaffected" is a measurement rather than an
   expectation.
5. **Requirement 18 — the accepted trade-off SHALL be published, not implied.**
   Disabling the two names on Gemini CLI also suppresses their model-side
   `activate_skill` path on that CLI, and this spec accepts that loss rather than
   engineering around it: both components are user-initiated bootstrap
   interviews a newcomer types by name, not capabilities a model should elect
   mid-task, and the native slash command is the Gemini path requirement 2
   mandates. `docs/cli-matrix.md` SHALL record that on Gemini CLI these two
   components are reachable as the native slash command only, and neither that
   document nor `README.md` SHALL claim model-side skill activation for them on
   Gemini CLI.
6. **Requirement 19 — the workspace-settings row of the CLI matrix SHALL be
   corrected.** Row 7 of `docs/cli-matrix.md` (*Active workspace settings file*)
   states for Gemini CLI `❌ (loaded from ~/.gemini/settings.json by the CLI; no
   in-repo workspace file)`, which requirement 14 falsifies. The same diff SHALL
   update that cell to record the in-repo `.gemini/settings.json`, the single
   purpose it serves, and this spec as its origin.

**Scenarios.**

**Scenario:** The collision is suppressed and the bare Gemini name survives

Given a fresh clone of the repository at the merge commit of this change, carrying `.gemini/settings.json` whose `skills.disabled` names `init-personal-profile` and `init-soul`
When Gemini CLI is launched from the repository root, its startup command-registry diagnostics are read, `gemini skills list --all` is run, and `gemini "/init-personal-profile"` is invoked
Then no `Conflicts detected` entry names either component, both appear as `[Disabled]` in the skills listing, and the bare `/init-personal-profile` resolves to the `.gemini/commands/init-personal-profile.toml` workspace command and starts the interview

**Scenario (failure path):** The settings file is absent, or a name is dropped from it

Given the implementation tree with `.gemini/settings.json` deleted, or with either name removed from its `skills.disabled` array
When Gemini CLI is launched from the repository root and the requirement-5 Gemini probe is executed
Then the startup diagnostics report `Conflicts detected` for the affected name, the workspace command is renamed to `/workspace.<name>` and the skill-derived command to `/<name>1`, no registration keeps the bare `/<name>`, and the probe fails — the change is not merged until the file is restored or the affected invocation is withdrawn from both `README.md` and `docs/cli-matrix.md`

**Scenario (failure path):** The Gemini trade-off is published as if it did not exist

Given the merged implementation
When `docs/cli-matrix.md` and `README.md` are read for what Gemini CLI can do with these two components
Then neither document claims model-side skill activation for them on Gemini CLI, the Gemini entry names the native slash command as the only path, and row 7's Gemini cell records the in-repo `.gemini/settings.json` — any of the three missing is a `spec`-class finding against requirements 18 and 19

**Out of scope,** extending the parent spec's own list:

- Any mechanism that restores model-side `activate_skill` for these two names on
  Gemini CLI while preserving the bare native command. Requirement 18 accepts
  the loss; recovering it is a different ticket's problem.
- Changing `build_commands` so that command-kind sources stop emitting
  `.agents/skills/<name>/SKILL.md`. Probe P1(a) on issue #1077 established that
  Antigravity CLI does not read `.gemini/commands/*.toml` and resolves these
  components only through `.agents/skills/`, so the wrapper cannot be dropped
  without failing requirement 5's Antigravity leg.
- A mechanical guard asserting that every `artifacts/**/commands/<name>.md`
  source carries a matching entry in `.gemini/settings.json` → `skills.disabled`.
  The detector this delta relies on is the requirement-5 Gemini probe, not a CI
  check; generalising the invariant to future command sources belongs with the
  guard-coverage follow-up the parent spec's `## Out of scope` already requires.
- Precedence between a project `.gemini/settings.json` and an adopter's own
  `~/.gemini/settings.json` when both declare `skills.disabled`. Neither
  `config/gemini/settings.json` — the template this framework deploys to user
  level — nor the probe machine's user-level file carries a `skills` block, so
  the case was never exercised. It is Gemini CLI's own merge semantics and this
  spec does not constrain it.
- Renaming either component to decouple the two CLIs' registrations. Probes
  P2(i) and P2(ii) on issue #1077 established that Gemini CLI and Antigravity
  CLI both key off the same frontmatter `name:` field of the same generated
  file, so a rename only moves which CLI loses the bare name.

## MODIFIED

Three statements of the parent spec are falsified by the same probe evidence and
are replaced below. Requirement 2's normative obligation is untouched in all
three cases: the `command` kind remains the mandated kind, on a corrected
rationale.

**1. Requirement 2's rationale.** The original grounds the choice of the
`command` kind on a claim the probe disproves — that Gemini CLI never exposes a
skill as `/<name>`. It does, through a second mechanism the vendor documentation
does not describe. The replacement states the two grounds that do hold, both
read from the build script and the installed CLI rather than inferred.

Original requirement 2:

```text
2. Each of the two sources SHALL be declared with `type: command` and SHALL live
   at `artifacts/core/commands/<name>.md`. The `command` component kind is
   required rather than the `skill` kind because it is the only kind whose build
   emits a Gemini CLI native slash-command definition
   (`.gemini/commands/<name>.toml`), which is the sole carrier of the published
   `gemini "/init-personal-profile"` invocation; a `skill`-kind source emits
   `.gemini/skills/<name>/SKILL.md` instead, which Gemini CLI discovers for
   model-side activation only and never exposes as `/<name>`.
```

Replacement requirement 2:

```text
2. Each of the two sources SHALL be declared with `type: command` and SHALL live
   at `artifacts/core/commands/<name>.md`. The `command` component kind is
   required rather than the `skill` kind for two reasons, neither of which is
   that a skill cannot be typed as `/<name>` on Gemini CLI — it can, and the
   claim to the contrary is withdrawn. First, the command build path is the only
   one whose GitHub Copilot CLI output carries the source's
   `claude.allowed-tools` set into `.github/skills/<name>/SKILL.md`; the skill
   build path emits only `name`, `description`, `license` and `compatibility`
   there, so requirement 9's obligation that the generated Copilot output carry
   the interview's tool set is satisfiable by the `command` kind alone. Second,
   it is the only kind emitting `.gemini/commands/<name>.toml`, whose
   registration submits the interview prompt directly as the turn's prompt,
   without depending on Gemini's skills-support or skill-administration
   settings; the slash command Gemini otherwise mints from a discovered skill
   reaches the interview indirectly, through the `activate_skill` tool, and is
   minted only while both of those settings are enabled and the skill is absent
   from `skills.disabled` — where requirement 14 deliberately places these two
   names, leaving the native command the sole claimant of the bare `/<name>` on
   that CLI.
```

**2. The `## Out of scope` bullet on `init-expertise` and `init-team`.** Its
second sentence asserts that `gemini "/init-expertise"` is not a slash command
today. Probe P5 on issue #1077 established that it is one, minted from the
discovered skill with nothing competing for the name. The exclusion itself
stands; only its stated reason changes.

Original bullet:

```text
- Migrating `init-expertise` and `init-team` from the `skill` kind to the
  `command` kind. `gemini "/init-expertise"` is not a slash command today and
  this spec does not make it one.
```

Replacement bullet:

```text
- Migrating `init-expertise` and `init-team` from the `skill` kind to the
  `command` kind. `gemini "/init-expertise"` does resolve today — Gemini CLI
  mints a slash command from every discovered, non-disabled skill, and nothing
  competes with those two names for it — so such a migration would change how
  that invocation is served rather than whether it exists, and this spec does
  not make that change.
```

**3. The failure-path scenario "A skill-kind source drops the Gemini slash
command".** Its middle clause states that a skill-kind source leaves
`gemini "/init-personal-profile"` unresolved. Probe P4 on issue #1077 established
the opposite: with the native command absent and only the skill wrapper present,
the bare name resolves cleanly as the skill-minted command. The candidate
implementation is still rejected, but on the grounds that actually hold — the
lost native command and the lost Copilot tool set — so requirement 9 replaces
requirement 5 as the second failing requirement, requirement 5 being one such a
candidate would in fact pass.

Original scenario:

```text
**Scenario (failure path):** A skill-kind source drops the Gemini slash command

Given a candidate implementation that promotes the two components as
`type: skill` sources under `artifacts/core/skills/`
When the build runs and the Gemini CLI probe of requirement 5 is executed
Then `.gemini/commands/init-personal-profile.toml` is absent from the build
output, `gemini "/init-personal-profile"` no longer resolves as a slash command,
and the candidate implementation is rejected as failing requirement 2 and
requirement 5
```

Replacement scenario:

```text
**Scenario (failure path):** A skill-kind source drops the native Gemini command
and the Copilot tool set

Given a candidate implementation that promotes the two components as
`type: skill` sources under `artifacts/core/skills/`
When the build runs and the Gemini CLI probe of requirement 5 is executed
Then `.gemini/commands/init-personal-profile.toml` is absent from the build
output, `.github/skills/init-personal-profile/SKILL.md` carries no
`allowed-tools` field, and `gemini "/init-personal-profile"` resolves only as the
command Gemini mints from the discovered skill — reaching the interview through
the `activate_skill` tool rather than through the native command requirement 2
mandates — and the candidate implementation is rejected as failing requirement 2
and requirement 9
```

## REMOVED

(none)
