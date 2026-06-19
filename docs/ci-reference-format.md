# CI capability reference format

<!-- crewrig-doc: section=reference nav_order=60 published=true title="CI capability reference format" -->

This document is the **normative description** of the shape of
`ci/ci-capabilities.yml` — the platform-neutral CI capability reference
mandated by [spec 0047](../specs/0047-ci-capability-reference.md) and decided
in [ADR-0012](adr/0012-ci-reference-contract.md). It is contract **C1**: a
candidate reference is judged valid or invalid against the rules below, and a
further continuous-integration engine is supported by describing only its
mapping of these capabilities — never by altering a capability definition
(spec 0047 R7).

The traceability convention (**C2**) — how a pipeline job in any engine is
attributed to exactly one capability — is pinned in *Traceability* below,
with the exact, tested `yq` extraction expressions sub-spec C relies on.

## Purpose and scope

The reference is **one** platform-neutral enumeration of every
continuous-integration capability the project relies on, at the granularity of
one job. It is a *description*, not a generator and not a drift check:

- It does **not** generate any engine's pipeline — that is sub-spec B (#372).
- It does **not** check divergence between the reference and the engines —
  that is sub-spec C (#373).
- It does **not** execute any pipeline on a live engine.

It exists so that, before any engine's pipeline is derived or checked, there
is one agreed answer to "what does this project's CI do", independent of any
engine.

## File location and ownership

- **Path:** `ci/ci-capabilities.yml` — one reference per repository.
- **Layer:** core, sync policy `strict` (upstream-owned; a local modification
  halts the upstream sync). Registered in
  [`docs/layers.md`](layers.md) and `.crewrig/core-paths.txt`.
- **Format:** YAML, chosen because `yq` (mikefarah) is already a CI dependency
  (`.github/workflows/build.yml`); no new validation toolchain is introduced.

## Capability entry schema

The reference is a YAML document with a single top-level key `capabilities:`
whose value is a **list** of capability entries. Each entry is a mapping with
these keys:

| Key | Required | Type | Constraint |
|---|---|---|---|
| `id` | always | string | The stable traceability identifier. Unique across the reference. Equals the pipeline job's YAML key (see *Traceability*). |
| `name` | always | string | Human-readable label for the capability. |
| `trigger` | always | list | One or more trigger objects (see *Neutral trigger vocabulary*). |
| `portability` | always | enum | `portable` or `specific` (see *Portability and exceptions*). |
| `exception` | iff `specific` | mapping | `{engine, evidence}` (see *Portability and exceptions*). |
| `command` | iff `portable` | list of strings | The business invocation command(s) that realize the job (see *Invocation command and execution requirements*). |
| `requires` | iff `portable` | mapping | The engine-agnostic execution requirement: `{runtime, tools, history-depth}` (see *Invocation command and execution requirements*). |

**Granularity — one capability is exactly one job (spec 0047 R1).** The steps
*inside* a job are an implementation detail of that one capability, **not**
separate capabilities. For example the `check-components` job runs roughly two
dozen steps; it is one capability, not two dozen. A candidate reference is not
invalid for collapsing a job's steps into a single entry — that is the
required shape.

## Neutral trigger vocabulary

Each `trigger` entry is a mapping with an `on:` kind drawn from a **closed**
set, optionally qualified by **portable filters**.

**Trigger kinds (closed set, spec 0047 R2):**

| Kind | Meaning |
|---|---|
| `push` | A push to a branch. |
| `pull-request` | A pull-or-merge request (the neutral name; GHA `pull_request`, GitLab `merge_request_event`). |
| `tag` | A tag push. |
| `scheduled` | A time-scheduled run. |
| `manual` | A manually or out-of-band initiated run. An issue/review comment (bot mention) is modeled as `manual`. |

A trigger whose `on:` kind is **not** one of these five makes the reference
invalid (see *Validity rules*, Scenario 2).

**Portable filters (normalized trigger attributes, spec 0047 R3):**

| Filter | Applies to | Meaning |
|---|---|---|
| `branches` | `push`, `pull-request` | The branch set the trigger qualifies on. |
| `paths` | `push`, `pull-request` | The path set the trigger qualifies on. |
| `tag-pattern` | `tag` | A glob qualifying the matched tag. Absent → matches any tag. |

`trigger` is a **list** so that a capability firing on both `push` and
`pull-request` (the real `build` / `lint-markdown` jobs) is **one** capability
with two trigger objects — not two capabilities. A filter key outside the set
above is invalid.

## Portability and exceptions

`portability` marks whether a capability crosses engines (spec 0047 R4):

- **`portable`** — faithfully expressible on every supported engine. Sub-spec
  B generates it into each engine's pipeline.
- **`specific`** — tied to a single engine. Hand-authored per engine; never
  generated.

Every `specific` capability **SHALL** carry an `exception` (spec 0047 R5):

| Field | Required | Meaning |
|---|---|---|
| `engine` | yes | The engine id where the capability lives (e.g. `github-actions`). |
| `evidence` | yes | A statement that the mechanism has **no faithful equivalent** on the other supported engines. |

`evidence` accepts any of: a **quoted sentence**, a **command + its output**,
or a **URL** — mirroring the gap-acceptance evidence discipline of
[`docs/cli-matrix-maintenance.md`](cli-matrix-maintenance.md). A `specific`
capability with **no** `exception`, or with an empty `evidence`, makes the
reference invalid (see *Validity rules*, Scenario 3).

**Bot-mention rule (spec 0047 R5).** A bot-mention trigger — an issue comment
or a pull-request review comment that dispatches an assistant (e.g. the
`@claude` and `@copilot-cli` workflows) — **SHALL** be treated as
engine-specific, **never** portable, regardless of how its `trigger` is
modeled.

## Invocation command and execution requirements

A `portable` capability is not merely *described* by the reference — its
pipeline on any supported engine is **derived** from the reference alone. Two
fields carry the derivable content: `command` (the work) and `requires` (the
environment that work needs). Both are mandatory on a `portable` capability
and absent on a `specific` one.

### `command` — the business invocation (spec 0047 delta-01 R10)

`command` is the **list of business commands** that realize the job — the work
the job performs, distinct from any engine-specific setup boilerplate
(checkout, runtime install). It is a **list of strings** so that a capability
composed of several ordered steps (e.g. `check-components` runs roughly two
dozen `bash scripts/*.sh` invocations) stays **one** capability with an ordered
command list, never split into several — preserving the *Granularity — one
capability is exactly one job* rule above. A derivation maps the list
one-to-one onto the engine's step sequence (GitLab `script:`, a GHA job's
`run:` steps).

- A `portable` capability **SHALL** declare `command` (delta-01 R10). A
  `portable` capability with no `command` makes the reference **invalid** (see
  *Validity rules*, Scenario 5).
- A `specific` capability **SHALL NOT** be required to declare `command`
  (delta-01 R11); its body stays hand-authored under its evidence-backed
  exception.

### `requires` — the engine-agnostic execution requirement (spec 0047 delta-02 R12)

`requires` declares **the need, not the mechanism**: the runtime and version,
the additional tools, and the source-history depth the `command` needs to run.
The engine-specific setup boilerplate that *satisfies* the requirement (a
Docker `image`, a `before_script` tool install, a clone-depth flag) is produced
by the derivation and is **never stored in the reference** (delta-02 R12).

The requirement is a closed-vocabulary mapping mirroring R12's own enumeration:

| Key | Type | Meaning | Example |
|---|---|---|---|
| `runtime` | string | The language runtime and version, as `<name>@<version>`. | `node@22`, `python@3.12` |
| `tools` | list of strings | Additional tools the command needs on `PATH`. | `[yq]`, `[task]`, `[jq]` |
| `history-depth` | enum | `full` when the command needs the complete source history (e.g. a base-ref diff); omitted otherwise. | `full` |

All three sub-keys are optional **inside** `requires`: a capability whose
command needs only POSIX shell (e.g. `grep-anti-patterns`) may omit `requires`
entirely. What is *not* optional is consistency — a command that invokes a tool
or runtime it does not declare is rejected:

- A `portable` capability whose `command` needs a runtime or tool that the
  capability does not declare under `requires` makes the reference **invalid**
  (see *Validity rules*, Scenario 6). The execution requirement must be present
  before the capability is accepted as derivable (delta-02 Scenario 2).
- A `specific` capability gains no `requires` (R12 scopes the obligation to
  portable capabilities, consistent with delta-01 R11).

### GitLab generation

The GitLab pipeline generator `scripts/build-ci.sh` (spec 0048) is the
reference's consumer: it reads `command` + `requires` for every `portable`
capability and produces `.gitlab-ci.yml` at the repo root. For each capability
it emits one job keyed by the capability `id` (the C2 primary path below), with
`requires` translated into the GitLab setup boilerplate — `runtime` →
`image:`, `tools` → `before_script:` installs, `history-depth: full` →
`variables: { GIT_DEPTH: "0" }` — and `command` becoming the job's `script:`.
The boilerplate is the generator's own output; it is never written back into
the reference (the R12 need-vs-mechanism boundary). Engine-specific
capabilities are skipped with no placeholder (spec 0048 R4), and the existing
GitHub Actions workflows are **not** regenerated (spec 0048 R5) — they stay
hand-authored and are only *described* here.

## Traceability (contract C2)

**The capability `id` IS the pipeline job's YAML key, on every engine.** A
pipeline job named `lint-markdown` in any engine is, by that fact, attributed
to the capability whose `id` is `lint-markdown`. There is no separate
annotation to keep in sync — the id is the job's name in the structured
document, so it is directly addressable in `yq`'s data model. Renaming a job
and renaming its capability become the same act; they cannot silently
disagree.

**Uniqueness (spec 0047 R6).** Each `id` is unique across the reference, so a
job key attributes to **exactly one** capability. A missing or duplicated `id`
makes the reference invalid (see *Validity rules*, Scenario 4).

**Untraceable jobs.** A pipeline job whose key is **not** an `id` in the
reference (and which carries no fallback annotation, below) is *untraceable*.
Sub-spec C's drift harness fails closed on it.

### Tested extraction expressions

Sub-spec C relies on these exact `yq` (mikefarah v4.x) access paths. Each is
shown with a passing sample.

**GitHub Actions — list every job's capability id (primary path):**

```console
$ yq '.jobs | keys' .github/workflows/build.yml
- build
- check-components
- lint-markdown
- lint-specs
- test-harness-curate
- check-skill-versions
- check-extension-version-bump
- check-agents-size
- check-feedback-routing
```

The GHA job keys are already valid id syntax and unique by the schema's own
rule, so the ids fall straight out of the data model.

**GitLab CI — list job ids (top-level keys minus the reserved keyword set):**

GitLab pipelines place jobs at the top level, alongside reserved keywords
(`stages`, `workflow`, `default`, `include`, `variables`, `image`,
`before_script`, `after_script`, `cache`, `services`, `pages`). The
extraction **MUST bind the key before testing membership** — binding it with
`as $k` first, so the reserved-set membership test runs against the key and
not against a pipe-rebound `.`:

```console
$ yq '[ keys[] as $k | $k
        | select(["stages","workflow","default","include","variables",
                  "image","before_script","after_script","cache","services",
                  "pages"] | contains([$k]) | not) ]' .gitlab-ci.yml
- lint-markdown
- check-skill-versions
```

> **Do not** use the form `select([reserved] | contains([.]) | not)`. Inside
> `select(...)` the pipe in `[reserved] | contains([.])` rebinds `.` to the
> reserved **array**, so `[.]` wraps the array rather than the current key;
> the predicate never matches, `not` is always true, and **every reserved key
> leaks through unfiltered**. The `keys[] as $k | $k | … contains([$k])` form
> above binds the key before the pipe and filters correctly.

### Reserved-name fallback annotation

Where an engine **forces** a job key that cannot equal the capability id —
GitLab reserves `pages`, and a descriptive id like `pages-deploy` deliberately
differs from the GHA job key `deploy` — the job carries a **trailing
key-comment** binding it to its capability:

```yaml
# GitLab CI (.gitlab-ci.yml, authored by sub-spec B)
pages: # ci-capability: pages-deploy
  stage: deploy
  script: [...]
```

retrieved with (passing sample):

```console
$ yq '.pages | key | line_comment' .gitlab-ci.yml
ci-capability: pages-deploy
```

This trailing key-comment placement **is** addressable in yq's data model
(`key | line_comment`), unlike an own-line comment placed as the first child
of the job map, for which `line_comment` / `head_comment` / `foot_comment`
all return empty on the job node. The fallback is used only for
reserved-or-forced job names; the primary contract remains id == job key.

### The complete harvest

To attribute every job, sub-spec C harvests the set of capability ids as:

> **(top-level job keys − reserved keywords) ∪ (reserved-named jobs bearing a
> `# ci-capability: <id>` trailing key-comment, mapped to their `<id>`).**

The second clause is what keeps a reserved-named deploy job (e.g. GitLab
`pages`) from being silently dropped as untraceable. The combined harvest,
proven against a realistic GitLab document containing the reserved keywords,
two portable job keys, and a `pages: # ci-capability: pages-deploy` job:

```console
$ yq '
  [ keys[] as $k | $k
      | select(["stages","workflow","default","include","variables","image",
                "before_script","after_script","cache","services","pages"]
               | contains([$k]) | not) ]
  + [ .[] | select(key | line_comment | test("^ci-capability: "))
          | (key | line_comment | sub("^ci-capability: ", "")) ]
' .gitlab-ci.yml
- lint-markdown
- check-skill-versions
- pages-deploy
```

On GitHub Actions the harvest is the same primary ∪ fallback union, scoped
under `.jobs`. Most job keys already equal their capability `id`, so the
primary clause (`yq '.jobs | keys'`) attributes them directly. But where a
descriptive `id` deliberately differs from the job key — the `pages-deploy`
capability versus the `deploy` job in `.github/workflows/pages.yml` (see
*Reserved-name fallback annotation* above) — that job carries a
`# ci-capability: pages-deploy` trailing key-comment, and the fallback clause
resolves it:

```console
$ yq '.jobs | (.[]
        | select(key | line_comment | test("^ci-capability: "))
        | key | line_comment | sub("^ci-capability: ", ""))' \
    .github/workflows/pages.yml
pages-deploy
```

The fallback clause is therefore exercised on GitHub Actions **today**, not
only where a future engine forces a reserved job name: sub-spec C's harness
applies the same primary ∪ fallback harvest to both engines. (Use the
`select(key | line_comment | …)` form above, which binds the job **key**; the
form `select(.value | key | line_comment …)` binds the job *body* and silently
matches nothing.)

## Validity rules (judgeability)

A candidate reference is **valid** iff every entry satisfies the schema above.
The conditions below map one-to-one onto the spec 0047 scenarios; sub-spec C's
checker implements against them.

1. **Portable capability resolves (Scenario 1, valid).** An entry with a
   unique `id` and a `trigger` whose every `on:` kind is in the neutral
   vocabulary is **accepted**; its `id` and trigger resolve, and any pipeline
   job whose key (or fallback annotation) equals that `id` attributes to
   exactly that capability.
2. **Unknown trigger (Scenario 2, invalid).** Any `trigger` whose `on:` kind
   is not one of `push`, `pull-request`, `tag`, `scheduled`, `manual` (or any
   filter outside `branches`, `paths`, `tag-pattern`) makes the reference
   **invalid**, naming the unrecognized trigger.
3. **Engine-specific without evidence (Scenario 3, invalid).** A capability
   marked `portability: specific` that carries no `exception`, or whose
   `exception.evidence` is empty, makes the reference **invalid** — the
   evidence is required before the capability is accepted as a known
   exception.
4. **Missing or duplicate id (Scenario 4, invalid).** If two capabilities
   share one `id`, or any capability has none, the reference is **invalid** —
   the traceability id must be present and unique.
5. **Portable without command (delta-01 Scenario 2, invalid).** A capability
   marked `portability: portable` that declares no `command` makes the
   reference **invalid** — the invocation command is required before the
   capability is accepted as portable (delta-01 R10).
6. **Portable with an unmet execution requirement (delta-02 Scenario 2,
   invalid).** A capability marked `portability: portable` whose `command`
   needs a runtime or tool it does not declare under `requires` makes the
   reference **invalid** — the execution requirement must be present before the
   capability is accepted as derivable (delta-02 R12). In practice the
   derivation enforces this: `scripts/build-ci.sh` has exactly one
   GitLab install recipe per declarable tool, so a command invoking an
   undeclared tool produces no `before_script` line for it, and the generator
   fails closed when asked to translate a requirement it has no mapping for.

## Adding a further engine

A new continuous-integration engine is supported by describing **only** its
mapping of the existing neutral vocabulary (spec 0047 R7, R9):

- It names each portable job by the capability's existing `id` (the C2
  contract), or carries the `# ci-capability: <id>` trailing key-comment where
  the engine forces a reserved job name.
- It maps each neutral trigger kind to the engine's own trigger syntax (e.g.
  `pull-request` → GHA `on: pull_request`, GitLab `rules:` on
  `$CI_PIPELINE_SOURCE == "merge_request_event"`).
- It hand-authors the `specific` capabilities whose `exception` names that
  engine, and skips those whose exception names another engine.

It **never** edits a capability definition. The capability set and the neutral
vocabulary are the stable contract; each engine is one mapping over them.
