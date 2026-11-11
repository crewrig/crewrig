# Org model mapping override channel

<!-- crewrig-doc: section=reference nav_order=100 published=true title="Org model mapping override channel" -->

An adopting organization changes what any supported CLI resolves a
capability declaration to through a set of org-owned files, one per
target, beside the core mapping each overrides:
**`model-mappings/<target>.org.yml`**. This is the HOW realization of
[spec 0199](../specs/0199-org-model-mapping-override.md); the normative
shape of both the core mapping and its override channel is documented in
[`docs/model-mapping-format.md`](model-mapping-format.md).

The channel plays the same role for model mappings that
[`docs/org-mcp-declaration.md`](org-mcp-declaration.md) plays for MCP
servers: an org-owned file, excluded from upstream synchronization, that
upstream ships present but empty.

## Where declarations go

One file per supported target:

- `model-mappings/claude.org.yml`
- `model-mappings/gemini.org.yml`
- `model-mappings/copilot.org.yml`
- `model-mappings/antigravity.org.yml`

Each ships declaring only `target: <target>` — no offering, no surface, no
template, no guard state. A fresh adopter that edits none of them observes
every compiled agent output stay byte-for-byte identical to what the core
mappings alone produce; no merge report is ever emitted.

## Schema

An org channel file is **shape-identical to a core mapping** — the same
`surfaces`, `offerings`, and `guard` node shapes
[`docs/model-mapping-format.md`](model-mapping-format.md) makes normative —
plus two additional top-level keys:

| Field | Meaning |
|---|---|
| `remove` | A list of addresses (`offerings/<id>`, `surfaces/<id>`, `surfaces/<id>/template`, `guard/state`) to take out of circulation. Never `guard` or `guard/terms/<id>` — removing the guard is rejected. |
| `replaces-core` | Boolean, default `false`. When `true`, the core mapping is not consulted at all: the org file alone is the mapping in force for that target. |

Which address an org-declared node occupies is derived from its own shape
— see the addressing table in
[`docs/model-mapping-format.md`](model-mapping-format.md#addressing-an-override-r10-r12).
Every declaration carries the same grounding (`grounds:` — a citation or an
explicit assumption) that a core declaration does; there is no relaxation
for being org-owned.

## Example — replacing one offering

```yaml
target: claude

offerings:
  - id: opus
    rank: 3
    native-value: opus-2026-preview
    provides:
      intelligence: xhigh
      specialization: general
    encodes:
      intelligence: opus
    supports-reasoning-surface: true
    grounds:
      - declares: native-value
        citation: "internal contract: pinned identifier for the 2026 preview rollout"
      - declares: provides.intelligence
        assumption: "matches the upstream-calibrated rung for this family"
```

This replaces the core `opus` offering entirely — no field of the core
node survives into the merged offering — and leaves every other offering,
surface, and guard state as the core mapping declares them.

## Example — removing an offering from circulation

```yaml
target: claude

remove:
  - offerings/haiku
```

`haiku` becomes unselectable; the selection over the remaining offerings
stays total across every `intelligence` rung.

## Example — substituting the whole lineup

```yaml
target: gemini
replaces-core: true

surfaces:
  - id: frontmatter
    kind: frontmatter
    items:
      - item: model
        key: model
        domain:
          values: [internal-model-a, internal-model-b]
        grounds:
          - declares: key
            citation: "internal deployment schema"
          - declares: domain
            citation: "internal deployment schema"

offerings:
  - id: internal-model-a
    rank: 1
    native-value: internal-model-a
    provides:
      intelligence: high
      specialization: general
    encodes:
      intelligence: internal-model-a
    supports-reasoning-surface: false
    grounds:
      - declares: native-value
        citation: "internal deployment schema"
      - declares: provides.intelligence
        citation: "internal calibration"
      - declares: supports-reasoning-surface
        assumption: "unconfirmed for this internal deployment"
```

`replaces-core: true` means the core Gemini mapping is not consulted at
all for this target; only `internal-model-a` is a candidate.

## Example — re-withholding the model on a bring-your-own-key provider

The core Claude Code mapping records its `copilot-shared-read` guard
`directed`: every compiled `.claude/agents/<name>.md` carries a `model:` key
and no `Run this agent on the <model> model.` sentence (spec 0291). The
evidence behind that is a probe on a standard GitHub-hosted account; it does
not cover a bring-your-own-key provider, where github/copilot-cli#4437 was
reported. An adopter whose Copilot readers run on such a provider re-withholds
the guard from `model-mappings/claude.org.yml`, setting the state and flipping
the second term, `copilot-reader-fails-on-unserved-model`, which states what
that adopter's Copilot readers may do (the first term concerns the upstream
defect on a standard account and is left alone):

```yaml
target: claude

guard:
  state: withheld
  terms:
    - id: copilot-reader-fails-on-unserved-model
      statement: >-
        A GitHub Copilot CLI reader of .claude/agents/ fails, or silently
        misroutes a subagent, whose `model:` it cannot serve.
      holds: true
      evidence: >-
        Observed on our bring-your-own-key provider: <what was observed>.
      grounds:
        - declares: holds
          assumption: "observed on our provider, no upstream probe covers it"
```

A replaced term is a whole node, so it carries every key a term requires
(`statement`, `holds`, `evidence`, `grounds`), not `holds` alone. The checker
requires the state and the terms to agree (rule A23): `withheld` while a term
holds. The mapping in force then passes the checker, and the build, for every
Claude Code agent, writes no `model:` key, keeps the sentence in the
description and emits one `model-note ... guard-withheld` line (spec 0197 R31
withheld clause and R32). Apart from the lines the guard drives, the compiled
Claude files are unchanged.

### Migration: the retired term id

Before spec 0291 the guard's second term was
`copilot-reader-consumes-claude-surface`. An organization file that overrides
that id is addressed `guard/terms/<id>`: the mapping in force then holds three
terms, which the checker rejects under rule A22 (a guard carries exactly two).
Rename the override to `copilot-reader-fails-on-unserved-model`, as above.

## The merge report

Every override — an added offering, a replaced surface, a removed
address, a substituted mapping — is recorded on the build's diagnostic
stream, one line per address, naming the target, the address, and whether
it was added, replaced, removed, or had no effect. Nothing here is ever
written into a compiled agent output, and no override can cause a
resolution to fail: a mapping the checker would reject still resolves,
degrading the cells it cannot read.

## Per-CLI effect

An override reaches the build through `mapping_in_force`, the single
point every agent resolution reads a mapping through — the same function
every target's compiled output already goes through. Populating
`model-mappings/claude.org.yml` changes only what Claude Code agents
compile to; the other three targets are unaffected unless their own
channel file is populated too. See
[`docs/cli-matrix.md`](cli-matrix.md) row 35 for how the four compiled
agent output trees are affected by an override.

## Applying an override

After editing an org channel file, re-run the component build:

```sh
node scripts/lib/node-floor-guard.js
node scripts/build-components.ts
```

Run the two commands as separate steps, not chained with `&&`. The build needs
Node.js 24 or newer; `js-yaml` comes from the setup dependency step.

The compiled agent outputs for the affected target(s) are regenerated
from the mapping in force. Continuous integration's drift check
(`node scripts/build-components.ts --target all --check`) fails a change
that edits an org channel file without regenerating and committing the
affected outputs in the same change.

### Synchronizing from upstream afterward

Because the four compiled agent output trees carry the `regenerable` sync
policy (not `strict`), an upstream synchronization no longer aborts when
your regenerated outputs diverge from upstream's own. `node
scripts/sync-from-upstream.ts` restores each diverged agent output from
upstream and reports which ones it restored over — re-run the build
afterward to regenerate them from your override again. Run
`node scripts/lib/node-floor-guard.js` first on an unverified Node.js: the command
needs Node.js 24 or later; `node scripts/sync-from-upstream.ts` remains a
forwarding shim. The compiled skill
and command output trees are unaffected: no mapping ever reaches them, so
they remain `strict` and a hand edit there still halts the sync.

## Credentials

Securing credentials is out of scope for this channel: the framework
delivers whatever an organization declares verbatim, and the organization
owns whatever it later adds. The shipped `model-mappings/<target>.org.yml`
files carry no operational offering, no surface, and no secret of any
kind — each declares `target: <target>` alone. Nothing in the schema
above (offerings, surfaces, guard state) is a place a credential belongs;
a native model identifier or an internal deployment name is not a secret
in the sense this section is about, but an organization that needs to
reference one should still avoid committing anything genuinely sensitive
(an internal endpoint, a customer identifier) into a tracked file.
