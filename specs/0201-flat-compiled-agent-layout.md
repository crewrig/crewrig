---
id: "0201"
slug: flat-compiled-agent-layout
status: draft
complexity: standard
interaction-mode: MINIMAL
related-issue: 1127
version: 1.0.0
---

# Flat compiled layout for Claude Code agents

Seam (g) of epic #1100 — the compiled-layout convention the maintainer
decided at the content gate of issue #1101 on 2026-09-02. Seam (f)
(`755ea75`) landed 22 migrated agents in the nested layout and recorded, in
requirement 34 of
[`specs/0200-core-agent-profile-migration.md`](0200-core-agent-profile-migration.md),
that this seam moves them. This specification is that move. The evidence each layout decision rests on
is set out under *Vendor evidence* below.

**Complexity.** `standard`, not `small`. The emission itself is one line, but
the change set reaches four distinct kinds of surface — a build emission, a
user-home deployment whose behaviour genuinely changes (a cleanup that does not
exist today), a new blocking guard with its own continuous-integration
capability, five re-pointed test suites, and four edited documentation surfaces
— and it carries one normative contradiction with a merged spec that has to be
repaired by a delta-spec before the implementation lands. None of that is
mechanical.

## Intent

A reader of the repository finds each compiled Claude Code agent as a single
file named after the agent, directly inside the compiled Claude Code agent
directory, in the shape that command line interface documents — instead of the
undocumented per-agent sub-directory the repository ships today. The agents
themselves are unchanged: same names, same content, same behaviour, at a new
location. An operator who installs agents into their home directory ends up with
one registration per agent rather than two, and a fork that synchronizes from
upstream lands on the new layout without being asked to do anything.

## Requirements

Requirements 1 to 5 fix the layout and its emission, 6 to 9 add the guard that
keeps it, 10 to 13 fix the deployment into the user home, 14 to 18 re-point the
surfaces that name the path, 19 to 23 fix what deliberately does not change, 24
to 28 fix what the change set has to record, 29 orders this change against a
merged spec, and 30 to 31 fix portability.

1. The compiled Claude Code output for an agent SHALL be one regular file named
   `<agent-name>.md`, placed directly in the `.claude/agents/` directory of that
   agent's tier output root.
2. No compiled Claude Code agent output SHALL be placed in a sub-directory of a
   `.claude/agents/` output directory.
3. The bytes of each compiled Claude Code agent output SHALL be unchanged by
   this specification: the content written at the path of requirement 1 SHALL
   equal, byte for byte, the content the same build writes at the retired path
   immediately before this change set.
4. The 22 committed compiled Claude Code agent outputs SHALL be present at the
   path of requirement 1 and absent at the retired path, in the same change set
   that changes the emission.
5. `bash scripts/build-components.sh --target all --check` SHALL exit zero on
   the committed tree after the change set, and SHALL exit non-zero naming the
   affected output if any committed compiled agent output is edited by hand.

6. The repository SHALL ship a guard that fails, with a non-zero exit status,
   when a committed `.claude/agents/` directory holds any entry that is not a
   regular file whose name ends in `.md` directly inside it; the report SHALL
   name every offending path.
7. The guard of requirement 6 SHALL exit zero when the directory holds only such
   files, SHALL exit zero when it holds none, and SHALL exit zero when the
   directory is absent — an absent or empty compiled tree is a permitted state,
   not a violation.
8. The guard of requirement 6 SHALL run in continuous integration on every pull
   request and every push that touches the compiled Claude Code agent tree, the
   guard itself, the guard's own test suite, or the component build script, so
   that a re-appearance of the retired layout cannot reach `main` unobserved.
9. The guard of requirement 6 SHALL ship with a test suite that fails when the
   guard is mutated to accept a sub-directory, and that suite SHALL be
   registered in the continuous-integration wiring rather than exempted from it.

10. The assisted Claude Code setup SHALL install each compiled agent of an
    installed tier into the user's agent directory as one regular file named
    `<agent-name>.md`.
11. For every agent name it installs, the assisted Claude Code setup SHALL
    remove any directory of that name already present in the user's agent
    directory, so that the same agent name is never registered twice under one
    scope. Where no such directory is present the removal SHALL be a silent
    no-op and SHALL NOT fail the install.
12. The assisted Claude Code setup SHALL NOT remove, from the user's agent
    directory, any entry whose name does not correspond to an agent it installs
    in the same run.
13. The behaviour of requirements 10 to 12 SHALL be covered by a test that
    exercises the shipped install routine itself rather than a copy of it.

14. The install-target key that the shared component resolver emits for a
    Claude Code agent SHALL name the path of requirement 1, and the set of name
    collisions the build reports SHALL be unchanged by that edit.
15. The per-component mirror verification SHALL read the compiled Claude Code
    agent output at the path of requirement 1, and SHALL continue to treat the
    three per-command-line-interface agent mirrors as all present or all absent.
16. Every test assertion that reads, writes, or matches a compiled Claude Code
    agent output path SHALL name the path of requirement 1, and every suite so
    re-pointed SHALL retain at least one assertion that turns red if the
    emission is reverted to the retired path.
17. The upstream-synchronization test suite SHALL retain at least one fixture
    that places a compiled Claude Code agent output at the retired path and
    asserts that a synchronization removes it, so that the one-time migration a
    fork undergoes is covered by a test rather than only by prose.
18. Every documentation surface that names a compiled Claude Code agent output
    as a **file** path SHALL name the path of requirement 1. A surface that
    names the compiled Claude Code agent **directory** SHALL be left unchanged.

19. The compiled agent outputs of Gemini CLI, GitHub Copilot CLI, and
    Antigravity CLI SHALL be byte-identical before and after this change set,
    and no emission path of those three targets SHALL change.
20. The synchronization manifest `.crewrig/core-paths.txt` and the built-outputs
    table of `docs/layers.md` SHALL be unchanged by this specification, because
    each names the compiled Claude Code agent tree as a directory and this
    change set moves files inside that directory.
21. No `metadata.provenance.version` field of any component source SHALL be
    bumped by this change set, and the version-bump enforcement SHALL pass on
    the change set without an exemption.
22. The agent-surface-consumption probe SHALL keep all five of its cells with
    their existing cell keys, including the two that exercise the retired
    per-file layout, because those cells probe what a command line interface
    consumes and not what this repository ships.
23. The Claude Code plugin packaging of extension agents SHALL be unchanged by
    this specification.

24. Documentation SHALL record that the compiled Antigravity CLI agent layout is
    unchanged, and SHALL state the evidence: the Antigravity customization
    documentation shipped with the command line interface names no agent
    customization type, and requirement 3 of
    [`specs/0053-antigravity-build-pipeline.md`](0053-antigravity-build-pipeline.md)
    normatively pins the nested Antigravity path.
25. Documentation SHALL record that neither the GitHub Copilot CLI emission nor
    the shared-read guard of requirement 8 of
    [`specs/0143-copilot-subagent-model-fallback.delta-01.md`](0143-copilot-subagent-model-fallback.delta-01.md)
    changes, and SHALL cite probe B's observation that Copilot CLI consumes both
    per-file layouts of the `.claude/agents/` surface.
26. Documentation SHALL record that the Claude Code plugin packaging is
    unchanged and SHALL name the follow-up that would change it, so that a reader
    does not take this seam to have settled the plugin layout.
27. The adopter-facing migration note of `docs/agent-profile-migration.md` SHALL
    record that the move anticipated by requirement 34 of spec 0200 has happened,
    and SHALL tell an adopter who deployed the retired layout into their user
    agent directory how the stale copy is removed.
28. Documentation SHALL record the consequence for a synchronizing fork: the
    compiled agent trees carry the `regenerable` policy, so the new files are
    restored from upstream, the retired files are removed as orphans, and a
    locally diverged member is reported rather than halting the synchronization.

29. A delta-spec of
    [`specs/0007-build-install-spec-author.md`](0007-build-install-spec-author.md)
    correcting the Claude Code agent path in the replacement text of its
    requirements 2 and 3 to the path of requirement 1 SHALL be merged before the
    implementation of this specification merges, at cumulative version `2.0.0`.

30. Every script this change set adds or modifies SHALL pass
    `bash scripts/check-bash32-portability.sh`.
31. No assertion this change set adds SHALL have an exit status that depends on
    a writer surviving a closed pipe, so that the same assertion yields the same
    verdict on the macOS and Linux runners alike.

## Scenarios

**Scenario:** the committed tree ships the documented layout

```text
Given  a clean checkout of `main` after this specification is implemented
When   `bash scripts/build-components.sh --target all --check` runs
Then   it exits zero
And    `.claude/agents/` holds 22 regular files named `<agent-name>.md`
And    `.claude/agents/` holds no sub-directory and no file named `AGENT.md`
```

**Scenario:** the content survived the move unchanged

```text
Given  a clean checkout of `main` after this specification is implemented
When   the build runs against a temporary output root and the 22 files it
       writes under `<root>/.claude/agents/` are compared with the committed
       ones
Then   every pair is byte-identical
And    each committed file carries the agent's `name` and its source's
       `metadata.provenance.version`
And    no compiled agent output on any target carries a `model:` frontmatter
       field
```

**Scenario:** a re-appearing nested output is refused

```text
Given  a checkout in which `.claude/agents/developer/AGENT.md` has been
       re-created alongside `.claude/agents/developer.md`
When   the layout guard runs
Then   it exits non-zero and names `.claude/agents/developer/AGENT.md`
And    `bash scripts/build-components.sh --target all --check` still exits zero,
       which is why the guard exists rather than the drift check standing in
       for it
```

**Scenario:** an empty compiled agent tree is not a violation

```text
Given  a checkout whose `.claude/agents/` directory is absent
When   the layout guard runs
Then   it exits zero and reports no offending path
```

**Scenario:** the home install leaves one registration per agent

```text
Given  a user agent directory that already holds `~/.claude/agents/architect/`
       from a previous install of the retired layout
When   the assisted Claude Code setup installs a tier containing `architect`
Then   `~/.claude/agents/architect.md` exists
And    `~/.claude/agents/architect/` no longer exists
And    an unrelated entry the operator placed in that directory is untouched
```

**Scenario:** a fork lands on the new layout without acting

```text
Given  a fork whose checkout still holds the retired
       `.claude/agents/dev/AGENT.md` and whose manifest carries the
       `regenerable` policy for `.claude/agents`
When   the fork synchronizes from upstream
Then   the synchronization does not halt
And    `.claude/agents/dev.md` is restored from upstream
And    `.claude/agents/dev/AGENT.md` is removed as an orphan
And    a locally diverged member that was restored over is named in the report
```

**Scenario:** the move obliges no version bump

```text
Given  the change set that implements this specification, touching no file
       under `artifacts/`
When   `bash scripts/check-skill-versions.sh` runs against it
Then   it exits zero without naming any source as owing a bump
```

## Out of scope

- **The compiled Antigravity CLI agent layout.** It stays at
  `.agents/agents/<name>/AGENT.md`. Three reasons, all recorded above under
  *Vendor evidence* and requirement 24: the command line interface's own
  customization documentation names no agent type and so documents no target
  layout; the artifact the installed CLI writes for itself is nested; and
  requirement 3 of spec 0053 normatively pins that path, so moving it would
  oblige a delta of a merged spec that this ticket excludes. A later ticket may
  revisit it once Antigravity documents an agent customization type or a probe
  cell covers it.
- **The lower-case `agent.md` the installed Antigravity CLI writes for its own
  subagents**, against the upper-case `AGENT.md` this repository compiles. The
  discrepancy is real and observable at
  `~/.gemini/antigravity-cli/brain/<session-id>/.agents/agents/<name>/agent.md`;
  it is a question about the Antigravity target's file *name*, not about this
  seam's layout, and it belongs to whichever ticket revisits the bullet above.
- **The Claude Code plugin packaging of extension agents.** The plugin builder
  copies extension **source** files matched by `agents/*/AGENT.md` and preserves
  their relative path; that source shape is the same pivot-authoring shape as
  `artifacts/*/agents/<name>/AGENT.md`, which this seam explicitly does not move.
  The Claude Code documentation, moreover, lists a plugin's `agents/` directory
  as a discovery location distinct from `.claude/agents/`, and scopes its
  recursive-scan sentence to the two `.claude/agents/` scopes — so it settles
  neither the safety nor the necessity of flattening the packaged copy. Deciding
  that without evidence is exactly what this seam is chartered not to do. Named
  follow-up per requirement 26.
- **Any change to compiled agent content, to model mappings, to capability
  profiles, or to the Gemini CLI and GitHub Copilot CLI layouts.** Probe C.
- **Any edit to the normative text of a merged spec.** The contradictions are
  named below and, where one is live, repaired by a new delta-spec file
  (requirement 29) — never by editing the merged file.
- **A re-run of probe B's Claude cells.** Their `indeterminate` outcome comes
  from an expired workstation credential, not from a defect; re-running it needs
  a re-authentication this change set cannot perform in continuous integration.
  The cells stay in place (requirement 22) so that a later re-run records against
  the same keys.

## Open questions

(None.)

## Vendor evidence

The layout decisions below rest on each command line interface's own
documentation, not on analogy between them.

**Claude Code.** The public subagents page —
`https://code.claude.com/docs/en/sub-agents`, reached by a 301 redirect from
`https://docs.claude.com/en/docs/claude-code/sub-agents` — documents two
filesystem scopes for subagent definitions in its location table:
`.claude/agents/` ("Current project") and `~/.claude/agents/` ("All your
projects"), alongside a third, distinct entry for a "Plugin's `agents/`
directory". It states the file format as *"Subagent files use YAML frontmatter
for configuration, followed by the system prompt in Markdown"*, and its worked
example is a single file labelled `.claude/agents/code-reviewer.md`. **The
nested per-agent directory form `.claude/agents/<name>/AGENT.md` is not
documented anywhere on that page.** It works today only as an incidental
consequence of a separate documented behaviour: *"Claude Code scans
`.claude/agents/` and `~/.claude/agents/` recursively, so you can organize
definitions into subfolders such as `agents/review/` or `agents/research/`. The
subdirectory path doesn't affect how a subagent is identified or invoked,
because identity comes only from the `name` frontmatter field."* Two
consequences follow, and both are load-bearing below: the flat form is the
documented one, and because identity comes from the `name` field rather than
the path, two files carrying the same `name` at two paths under one scope are
two registrations of one agent.

**Antigravity CLI.** Its customization documentation ships on disk at
`~/.gemini/antigravity-cli/builtin/skills/agy-customizations/`. The *Customization
Types: Quick Reference* table of that document enumerates exactly five
discoverable types — Rules, Skills, Plugins, Hooks, MCP Servers — and **names no
agent or subagent customization type at all**; its `docs/` directory likewise
carries `rules.md`, `skills.md`, `plugins.md`, `hooks.md`, `mcp_servers.md` and
`json_configs.md`, and no agents document. There is therefore no documented
Antigravity agent layout to move to. What the installed CLI does exhibit is the
nested form: a subagent definition it wrote itself sits at
`~/.gemini/antigravity-cli/brain/<session-id>/.agents/agents/<name>/agent.md`,
a per-agent directory. This specification consequently leaves the Antigravity
layout alone.

**GitHub Copilot CLI.** Probe B of spec 0194
(`tests/e2e/scenarios/06-agent-surface-consumption/`, run
`20260902T154627Z-0d89`, published on issue #1103) records **all three Copilot
cells `consumed`** — `.claude/agents/` nested, `.claude/agents/` flat, and its
own documented `~/.copilot/agents/` surface. Its own verdict comment states the
consequence for this seam verbatim: *"migrating compiled outputs to the flat
layout does NOT remove Copilot's consumption of the `.claude/agents/` surface —
the R8 guard remains necessary regardless of per-file layout."* Nothing about
the Copilot emission or the shared-read guard changes here. The same run leaves
**both Claude cells `indeterminate`** (the workstation credential had expired,
`control: in-cell-liveness-baseline-only`), so probe B establishes nothing about
Claude Code either way; the documentation quoted above is the whole of the
evidence for the target layout, and it is sufficient — it is the vendor's own
statement of the supported form.

## Contradictions with merged specs

One live normative contradiction, and eight mentions that are informational.
No merged spec is edited.

### Live — a delta-spec is required

**`specs/0007-build-install-spec-author.delta-01.md`** (cumulative `1.0.1`,
replacement text for requirements 2 and 3). Quoted:

> Replacement: the three agent paths SHALL be:
> `.claude/agents/<NAME>/AGENT.md` (Claude uses a sub-directory layout for
> agents, parallelling the skill layout, NOT a flat `<NAME>.md`).

and, in the replacement of requirement 3, clause (c):

> For all skill outputs … AND for Claude / GitHub-Copilot agent outputs
> (`.claude/agents/<NAME>/AGENT.md`, `.github/agents/<NAME>.md`) …

**Normative.** These bind the `skill:check` target of `Taskfile.yml`, which is
the very mirror check requirement 15 changes, and the parenthesis "NOT a flat
`<NAME>.md`" contradicts requirement 1 head-on. Proposed repair:
`specs/0007-build-install-spec-author.delta-02.md`, correcting both path
enumerations to `.claude/agents/<NAME>.md`, at cumulative version **`2.0.0`** —
`MAJOR`, because an implementation conforming to the current text becomes
non-conforming. Requirement 29 orders it before the implementation merges.

### Informational — no delta

- **`specs/0200-core-agent-profile-migration.md`**, requirement 34: *"The change
  set SHALL record that it lands in the nested `.claude/agents/<name>/AGENT.md`
  compiled layout, that seam (g) of epic #1100 later moves those files, and that
  the move regenerates the same content at a different path rather than
  re-deciding any profile."* Normative in form, but it binds spec 0200's **own**
  change set — already merged and already satisfied — and it names this move as
  the expected sequel. Its Intent says the same: *"seam (g) later moves the same
  files, regenerating the same content at a different path."* This specification
  is what requirement 34 anticipated, not a contradiction of it.
- **`specs/0200-core-agent-profile-migration.delta-01.md`**: *"one changed line
  in `.claude/agents/architect/AGENT.md` (the `description`)"*, inside a
  replacement paragraph describing a measured diff, and two scenario lines naming
  `.claude/agents/developer/AGENT.md`. A historical measurement of a past change
  set. Nothing obliges the path to persist.
- **`specs/0127-copilot-subagent-model-guard.md`**, requirement 1: *"The
  repository SHALL ship a guard script at
  `scripts/check-copilot-subagent-model.sh` that scans the built
  `.claude/agents/*/AGENT.md` files for a `model:` field."* Spent:
  `specs/0127-copilot-subagent-model-guard.delta-01.md` **REMOVED** requirements
  1 to 4 and voided all three scenarios naming that path, and the script is
  absent from the tree. Only retired text names the retired path.
- **`specs/0143-copilot-subagent-model-fallback.md`**, requirements 1 and 3:
  *"`scripts/build-components.sh` SHALL NOT emit hardcoded `model:` frontmatter
  fields into compiled `.claude/agents/*/AGENT.md` output files"* and *"SHALL
  regenerate all committed `.claude/agents/*/AGENT.md` files in the repository
  tree without `model:` fields."* Normative in form, but its own delta-01
  deliberately generalized the scope and said so: *"Where the meaning is the
  output surface, the text below names the directory — `.claude/agents/` — rather
  than a file pattern within it. Copilot CLI reads that directory, so a later
  change to the per-file layout of the compiled outputs under it requires no
  delta of this delta."* The letter of requirements 1 and 3 becomes vacuously
  satisfied after the move; their whole intent is carried, unweakened, by
  requirement 8 of the delta, which closes with *"This requirement constrains the
  `.claude/agents/` surface alone, whatever per-file layout the compiled outputs
  under it adopt."* A `PATCH` delta-02 restating requirements 1 and 3 at
  directory scope would be harmless, and is **not** recommended: delta-01 already
  made the generalization on purpose, and a second delta re-litigating it invites
  the reader to think the surface scope was in doubt.
- **`specs/0143-copilot-subagent-model-fallback.delta-01.md`**, requirement 8:
  quoted immediately above. Explicitly layout-agnostic. Untouched, and — per
  probe B — still necessary.
- **`specs/0121-antigravity-outputs-in-core-paths.md`** and its **delta-01**:
  *"exactly as a hand-edited `.claude/agents/developer/AGENT.md` is restored and
  reported"*, a comparison clause inside a scenario whose subject is the
  Antigravity output. The requirement the scenario serves — requirement 3 as
  replaced by delta-01 — names the four compiled agent trees as **directories**
  (`.claude/agents`, `.gemini/agents`, `.github/agents`, `.agents/agents`), so
  the normative content is layout-agnostic and the file name in the clause is
  illustration.
- **`specs/0092-claude-code-implicit-team-model.md`** and
  **`specs/0166-stable-reviewer-seat.md`**: every `AGENT.md` they name is
  `artifacts/core/agents/pr-reviewer/AGENT.md` — an **authoring source** path,
  which this seam does not move. Not contradictions at all.
- **`specs/0065-copilot-plugin-build.md`** and its **delta-01**: *"each
  `agents/<name>/AGENT.md` source directory is flattened to
  `agents/<name>.agent.md` in the output"* — the GitHub Copilot **plugin**
  output, from extension sources, not the compiled Claude Code tree. Untouched.
  Worth naming for a second reason: it is the repository's own precedent that a
  packager may flatten a nested source into a flat output, which is the shape the
  Claude plugin follow-up of requirement 26 would take.
- **`specs/0053-antigravity-build-pipeline.md`**, requirement 3: *"the build
  script SHALL emit compiled agent outputs to
  `<output-root>/.agents/agents/<name>/AGENT.md`."* Live and normative — and
  **honoured**, because requirement 19 leaves the Antigravity layout alone. Named
  here because it is the reason moving Antigravity in this seam was rejected.
- **`specs/0119-overlay-tier-component-resolution.md`**: names no filesystem
  path in any requirement. Its collision rule (requirement 12) is stated over an
  abstract *landing zone*; the concrete key `.claude/agents/<name>` lives in
  `scripts/lib/component-resolve.sh`, which requirement 14 updates while
  preserving the reported collision set. No delta.

## Acceptance criteria

Every command below runs at `HEAD` on a shallow clone. No criterion compares
against a past commit.

| # | Command | Expected |
|---|---|---|
| A1 | `bash scripts/build-components.sh --target all --check` | exit 0, no `DRIFT:` line |
| A2 | `find .claude/agents -mindepth 1 \( -type d -o -not -name '*.md' \)` | no output |
| A3 | `find .claude/agents -maxdepth 1 -type f -name '*.md' \| wc -l` | `22` |
| A4 | the layout guard of requirement 6, on the committed tree | exit 0 |
| A5 | the layout guard's own test suite (requirement 9) | exit 0, and red when the guard is mutated to accept a sub-directory |
| A6 | `bash scripts/check-bash32-portability.sh` | exit 0 |
| A7 | `bash scripts/check-test-wiring.sh` | exit 0 — the new suite is wired, not exempted |
| A8 | `bash scripts/check-skill-versions.sh` | exit 0 — no source touched, so no bump owed |
| A9 | `bash scripts/check-core-paths.sh` | exit 0 with `.crewrig/core-paths.txt` unchanged |
| A10 | `task spec:lint` | exit 0 |
| A11 | `bash scripts/check-agent-profiles.sh` | exit 0 — profile conformance reads sources, unaffected |
| A12 | `task skill:check NAME=spec-author` | exit 0 against the flat mirror |

The suites re-pointed under requirement 16, each with the nature of its change:

| Suite | Nature of the change |
|---|---|
| `scripts/tests/test-model-resolution.sh` | real assertions on built output in a temporary root — re-point `.claude/agents/<name>/AGENT.md` to `.claude/agents/<name>.md`; the `.agents/agents/…` assertions stay |
| `scripts/tests/test-agent-profile-migration.sh` | real assertions on the committed tree and on a `dist/library/` build, plus a mutation leg matching the `--check` drift line `.claude/agents/developer/AGENT.md differs from source` — re-point both, keep the leg red-then-green |
| `scripts/tests/test-check-agent-profiles.sh` | one built-output assertion in a temporary build root — re-point |
| `scripts/tests/test-sync-from-upstream.sh` | synthetic fork fixtures — re-point the fixtures that model the shipped layout, and keep one nested fixture asserting orphan removal per requirement 17 |
| `scripts/tests/test-artifact-build-install-scope.sh` | exercises the shipped `install_tier_to_home` verbatim; today it asserts skills only — add the agent-layout and nested-cleanup assertions of requirement 13 |
| `scripts/tests/test-gemini-agent-frontmatter.sh` | iterates with `find`, so it works for either shape — **comment only**: the line describing the Claude layout as a nested directory becomes stale |
| `scripts/tests/test-e2e-probes.sh` | synthetic probe verdict payloads describing probe cells, not repository paths — **no change**; requirement 22 keeps the cells |

The documentation surfaces under requirement 18, and the ones deliberately left
alone:

| Surface | Change |
|---|---|
| `docs/cli-matrix.md` rows 4, 28, 30 | name the flat compiled Claude agent file path |
| `docs/cli-matrix.md` row 32 and the Copilot subagent-routing gap note | record that the repository now ships the flat layout while the probe keeps both cells; the gap note's claim about the `.claude/agents/` **surface** is unaffected |
| `artifacts/FORMAT.md` → *Build Outputs* and the agent output block | flat path; and the collision worked example, where an agent now lands at `.claude/agents/architect.md` against a skill at `.claude/skills/architect` — still distinct landing zones, so the example's conclusion is unchanged |
| `CONTRIBUTING.md` component table | flat path |
| `docs/agent-profile-migration.md` | flat path, plus the adopter note of requirement 27 |
| `docs/layers.md` | **unchanged** — names the directory only |
| `docs/version-bump-convention.md` | **unchanged** — every path it lists is an `artifacts/…` or `extensions/…` **source** glob |
| `.crewrig/core-paths.txt` | **unchanged** — a depth-2 directory entry |
| `model-mappings/*.yml` | **unchanged** — the Claude mapping names the `.claude/agents/` surface; only the Antigravity mapping names an `AGENT.md`, and Antigravity does not move |

**Proving byte-identity (requirement 3).** Two halves, because only one of them
is observable at `HEAD`.

- *At `HEAD`, in continuous integration:* criterion A1. The build recomposes each
  output from its source and compares; a green `--check` says the committed flat
  file is exactly what the emission produces. Combined with the fact that the
  change set alters the target path of `check_or_write` and nothing that composes
  `claude_content`, identity with the retired bytes is structural.
- *On the pull request, by the implementer and by the reviewer:*
  `git diff -M100% --diff-filter=R --name-status <base>..<head> -- .claude/agents`
  SHALL list all 22 outputs, and `git diff -M100% <base>..<head> -- .claude/agents`
  SHALL contain no content hunk at all — a pure-rename diff has none. Run the
  second command and read its output rather than counting lines through a
  short-circuiting reader, for the reason requirement 31 gives. This half is a
  review-time procedure, not a continuous-integration criterion, because a
  shallow clone has no base commit to diff against.

**Assertion hygiene (requirement 31).** Assertions SHALL read from a here-string
or a variable rather than piping a writer into a reader that can exit first —
`grep -q pattern <<< "$out"`, not `printf '%s' "$out" | grep -q pattern`. Under
`pipefail` the second form passes on macOS and fails on the Linux runner, because
`grep -q` exits on its first match and the writer takes `SIGPIPE`.
