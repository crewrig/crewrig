# Model mapping format

<!-- crewrig-doc: section=reference nav_order=90 published=true title="Model mapping format" -->

This document is the **normative description** of the shape of
`model-mappings/<target>.yml` — the per-CLI model mapping artifact mandated by
[spec 0197](../specs/0197-model-mapping.md). It follows the precedent of
`ci/ci-capabilities.yml` / [`docs/ci-reference-format.md`](ci-reference-format.md)
(spec 0197 Decision 1): a committed, engine-neutral YAML reference whose
normative shape lives in a `docs/` format document, checked by a hermetic
script rather than by convention.

This document describes the artifact. It builds nothing, resolves nothing,
and reads no agent source: the resolution that consumes a mapping is seam (d)
of epic #1100, out of scope here (spec 0197 → *Out of scope*).

## Purpose and scope

A mapping is a committed declaration, one per target, that says which models a
command-line interface can reach, what each model provides, and how the
vocabulary of [spec 0195](../specs/0195-agent-capability-profile.md) turns into that
target's native fields and prose. It is a *description*: nothing in the
repository reads a mapping at the end of this ticket, and the checker
(`scripts/check-model-mappings.sh`) is an authoring-time gate over a proposed
change, never a resolution-time failure (spec 0197 R51).

## File location and ownership

- **Path:** `model-mappings/<target>.yml` — one file per target, `<target>`
  drawn from `claude`, `gemini`, `copilot`, `antigravity` (spec 0197 R1).
- **Layer:** core, sync policy `strict` (upstream-owned; a local modification
  halts the upstream sync). Registered in [`docs/layers.md`](layers.md) and
  `.crewrig/core-paths.txt` (spec 0197 R2).
- **Format:** YAML, chosen over JSON because a mapping cell carries a
  citation, and JSON admits no comments (spec 0197 Decision 1).
- **Not under `artifacts/`.** A mapping is a build input, not a component:
  nothing deploys it to a CLI (spec 0197 Decision 1).

## Organization-level override channel (spec 0199)

An adopting organization changes what a target resolves to without editing
the core mapping, through a second, org-owned file beside it.

- **Path:** `model-mappings/<target>.org.yml` — one file per target,
  paired with the core mapping it overrides (spec 0199 R1).
- **Layer:** org-owned, `excluded` from upstream synchronization, nested
  under the strict `model-mappings` parent in
  [`docs/layers.md`](layers.md) and `.crewrig/core-paths.txt` (spec 0199 R5).
- **Shipped state:** upstream ships one such file per supported target,
  each declaring `target: <target>` alone and nothing else — no offering,
  no surface, no template, no guard state, no secret. A fresh adopter's
  mapping in force is byte-for-byte the core mapping until it populates the
  channel itself (R7-R9). An adopter-facing how-to lives at
  [`docs/org-model-mapping-override.md`](org-model-mapping-override.md).
- **Shape:** shape-identical to a core mapping — the same node kinds, key
  sets and value domains this document makes normative — plus two org-only
  top-level keys: `remove:` (a list of addresses to remove, R13) and
  `replaces-core:` (a boolean, default `false`, R15). Every offering,
  surface item and guard term an org file declares carries the same
  `grounds:` grounding as a core declaration, with no relaxation on account
  of being org-owned (R4, R30, Decision 8).

### Addressing an override (R10-R12)

An override is expressed at one of the six addresses the *Addressing*
section above publishes. Which address an org-declared node occupies is
derived from its shape — the parent node's own required identity key —
not from a new heuristic:

| Org document shape | Address | Effect |
|---|---|---|
| `.offerings[]` element with `id: X` | `offerings/X` | whole-node replace, or add |
| `.surfaces[]` element carrying `kind:` | `surfaces/<id>` | whole-node replace, or add |
| `.surfaces[]` element carrying `template:` and no `kind:` | `surfaces/<id>/template` | scalar replace; the core surface's other keys survive |
| `.guard` carrying `id:` | `guard` | whole-node replace |
| `.guard` carrying `state:` and no `id:` | `guard/state` | scalar replace |
| `.guard.terms[]` element with `id: Y`, `.guard` carrying no `id:` | `guard/terms/Y` | whole-term replace, or add |
| anything else | — | rejected |

An org-declared node whose address the core mapping does not declare is
**added** to the mapping in force; one whose address the core does declare
**replaces** that core node entirely — no field of the replaced core node
survives into the merged node (R12, Decision 2).

### `remove:` (R13-R14)

A top-level `remove:` list names addresses to take out of circulation. A
node so named is absent from the mapping in force. `remove:` may not name
`guard` or an address of the form `guard/terms/<id>`: that guard encodes a
live upstream defect (spec 0143 delta-01), and deleting it would silently
re-enable the defect for the organization's own fork. An organization with
evidence the defect no longer applies replaces `guard/state` instead, and
meets the same evidence obligation the checker demands of a core mapping.

### `replaces-core:` (R15-R17)

A top-level `replaces-core: true` substitutes the whole mapping for its
target: the core mapping is not consulted for composition, and the mapping
in force is the org channel file alone. It defaults to `false` (not
substituting) when absent, and may not be declared together with a
non-empty `remove:` list — the two are mutually exclusive (R16).

Where a target has an org channel file and no core mapping at all, the
composition **degenerates to the same substituting case**: the mapping in
force is the org file alone, served exactly as a target whose core mapping
declared the same content — including a target the core layer leaves
unconfigured through a mapping declaring zero offerings (R17). No `remove:`
entry can have an effect in that case, since the core declares no address
at all; each is recorded as having had no effect rather than silently
dropped (R19).

### Validation (R29-R32)

`scripts/check-model-mappings.sh` validates three things per target:

1. **The core mapping alone**, unchanged, when one exists.
2. **The org channel file alone** — the same assertion table as a core
   mapping, with two relaxations: the surface node and the guard node may
   omit their own required keys (an org file may be a partial, addressed
   override rather than a complete node — the two node kinds requirement
   30 does not name), and five additional assertions validate `remove:`
   and `replaces-core:` against the rules above.
3. **The mapping in force** — the merged result — against the full
   assertion set requirements 47 through 50 of spec 0197 make normative,
   which is where the invariants that spanned both files actually live: rank
   total order, selection totality, and guard evidence. An org file that is
   impeccable alone can still collide with a core rank it never saw.

Each rejection names which of the three sources it concerns, so an author
is told which file to edit.

Requirements 15 through 28 of spec 0197 govern how a profile *resolves*
against a mapping — a rule about performing a resolution, never a rule about
the artifact itself. Seam (d) of epic #1100 implements that band; this ticket
and this document implement none of it. The schema below nonetheless carries
the state each of those requirements needs, so seam (d) inherits an artifact
that already carries what it will read:

- `provides` spans all seven spec 0195 selection axes, for R19's narrowing
  order.
- `encodes` carries R21's encoded reasoning rung, distinguishably from R17's
  `provides.intelligence` rung.
- `rank` carries R23's lowest-rank pick and R28's strict total order.
- `projection` carries R24's per-rung image or unmapped state.
- `supports-reasoning-surface` carries R25.
- The frontmatter item's `key` plus `domain` — including the ranged
  `type`/`min`/`max` form — carries R26's native-key direction and
  out-of-range drop.
- `grounds` carries nothing R15–R28 needs; it exists for R5 alone.

R15's non-failure invariant, R16's omitted-axis case, R20's `general`
fallback, R22's diagnostic note, and R27's drop-record shape are behaviors of
the resolver alone and reach no cell of a mapping file.

## Node shapes and closed key sets

Every node in a mapping file admits *exactly* the keys listed for its kind.
The checker's A3 assertion rejects any other key (spec 0197 R47).

### Top level

| Key | Required | Shape |
|---|---|---|
| `target` | always | one of `claude`, `gemini`, `copilot`, `antigravity`; SHALL agree with the filename stem (R3, A1, A2) |
| `surfaces` | always | list of surface nodes; at most one `frontmatter`, at most one `guidance`, any number of `out-of-band` (R10, A21) |
| `offerings` | always | list of offering nodes; MAY be empty (R9) |
| `guard` | required iff `target: claude` (R29, A13) | one guard node |
| `zero-offerings` | optional; required content of a mapping declaring zero offerings for a reason (R41) | ground/condition/grounds |
| `observed-not-declared` | optional; required content of a mapping recording observed-but-undeclared identifiers (R44) | list of entries |

### Surface

Every surface, of any kind, carries `id` (stable, unique across every surface
— A6) and `kind` (`frontmatter`, `guidance`, or `out-of-band` — R10, A19).
Beyond those two, the admitted keys are kind-specific:

| Kind | Further keys | Notes |
|---|---|---|
| `frontmatter` | `items` | Each item declares a native `key` and a `domain` (R4). |
| `guidance` | `carries`, `template`, `items` | `carries` names the items the template states; `template` is the prose (R14). |
| `out-of-band` | `location`, `items` | `location` names where the target expresses the item(s); naming directs no emission (R12). |

A frontmatter item further carries `key`, `domain`, `grounds`, and —
**only** on the `reasoning` item, and only when the target expresses
reasoning on that surface — `projection` (R24, A12). A guidance or
out-of-band item carries `item` and `grounds` alone: `key` and `domain` are
forbidden there (A18), because neither surface directs onto a native field
the way a frontmatter key does.

### Offering

| Key | Required | Shape |
|---|---|---|
| `id` | always | stable, unique across offerings (A6) |
| `rank` | always | integer, unique across offerings, a strict total order (R28, A7) |
| `native-value` | always | the value the mapping directs; SHALL be a member of the frontmatter model item's declared domain when one exists (A9) |
| `provides` | always | mapping of spec 0195 characteristics the model provides; `intelligence` is **required** (A26 — see *Schema obligations* below) |
| `encodes` | optional (empty/absent means the native value encodes nothing) | mapping of characteristic → the token of `native-value` that encodes it (R48, Decision A) |
| `supports-reasoning-surface` | always | boolean; `false` where the mapping declares no frontmatter reasoning item (R25, A17) |
| `grounds` | always | R5 grounding list |

### Guard (Claude Code only)

```yaml
guard:
  id: <stable id>
  spec: <requirement reference>
  state: <withheld|directed>
  terms:
    - id: <stable id, unique>
      statement: <string>
      holds: <true|false>
      evidence: <string>
      grounds: [<entry>, …]
```

`terms` carries **exactly two** entries (R30, A22), and `state` SHALL agree
with them: `withheld` while either term `holds`, `directed` only while
neither does (R31, A23). In the `directed` state, every term's `evidence`
SHALL be present and non-empty (R30, R33, A14a) and its `holds` declaration's
ground SHALL be a `citation`, never an `assumption` — R33's "not on the
strength of an indeterminate or absent observation" (A14b, *coherence*).

### `zero-offerings` and `observed-not-declared`

```yaml
zero-offerings:
  ground: <string>       # R41 — why no offering is declared
  condition: <string>    # R42 — what a later delta must establish
  grounds: [<entry>, …]

observed-not-declared:
  - native-value: <string>   # R44 — an observed identifier with no offering
    ground: <string>
    grounds: [<entry>, …]
```

Neither node is one of the three R5 node kinds (offering, surface item, guard
term), so A4/A5/A16/A24/A25 do not bind on them; their own `grounds:` list is
carried by convention, for the same reason every other declaration in this
file is grounded, and is additive rather than checked.

## Domains (spec 0195, pinned literally)

The checker pins these domains literally rather than deriving them by
parsing `specs/0195-agent-capability-profile.md`: specs are append-only, so a
delta that adds a rung ships as a **new file**, and a derived guard would keep
passing while stale — a green that certifies nothing. **Obligation:** a
future delta of spec 0195 that changes one of these domains SHALL be
accompanied by an update to this block and to the identical block in
`scripts/check-model-mappings.sh`.

| Axis | Domain | Spec 0195 |
|---|---|---|
| `intelligence` | `minimal`, `low`, `medium`, `high`, `xhigh`, `xxhigh`, `max` (ascending) | R6 |
| `reasoning` | `none`, `low`, `medium`, `high`, `xhigh`, `max` (ascending) | R10 |
| `specialization` | open enum of kebab-case tokens; not validated against a closed set | R12 |
| `context` | positive integer | R13 |
| `speed` | `standard`, `fast` | R14 |
| `modalities` | list, each ⊆ `text`, `vision`, `image-out` | R15 |
| `locality` | `any`, `local-only` | R16 |

## Item vocabulary (closed)

An `item:` value — on a frontmatter item, a guidance item, or an out-of-band
item — is drawn from exactly seven admitted tokens: `model`, `reasoning`, and
the five spec 0195 R17 tuning knobs — `temperature`, `top-p`, `top-k`,
`max-output-tokens`, `max-turns`. A27 rejects an `item:` outside this set
(R47's "a key the mapping schema does not admit" fairly reaches an item
*value* the same way it reaches a node key, since both name something this
vocabulary must recognize before a mapping can direct or drop it).

A target's own native field spelling that this vocabulary has no item for —
`effortLevel`'s companion `contextTier` on GitHub Copilot CLI, for
example — is **not** smuggled in as a new `item:` value. It is recorded as
prose in the surface's `location:` (out-of-band) or documented alongside the
surface's own commentary (frontmatter/guidance), because R12 obliges a mapping
to name a surface only for "an item this vocabulary can declare" — a native
field this vocabulary cannot declare is recorded as evidence, not as a
directable item.

## Addressing (R6/R7)

A mapping's offerings, surfaces, guidance templates, and guard state are each
individually addressable by a stable identifier, so that the organization-level
override channel of seam (e) can add or replace one without touching the rest
of the file (R6, R7). The addressing grammar:

| Address | Names |
|---|---|
| `surfaces/<id>` | one surface, by its `id` |
| `surfaces/<id>/template` | a guidance surface's template |
| `offerings/<id>` | one offering, by its `id` |
| `guard` | the guard block as a whole |
| `guard/state` | the guard's recorded state |
| `guard/terms/<id>` | one guard term, by its `id` |

This document defines the addressability; it does not define the override
channel itself, its location, its format, or its precedence (R7 — that is
seam (e)'s contract, not this one's).

## Grounding — the `grounds:` list (R5, Decision B)

Every offering, every surface item, and every guard term SHALL carry either a
citation of the observation that grounds it or an explicit statement that it
is an assumption, and SHALL NOT carry both and SHALL NOT carry neither (R5).

Grounding is **per declaration**, not per node. R36 obliges the Claude
`haiku` offering's `supports-reasoning-surface` declaration to carry *two*
marks of different kinds on one node — an assumption on the per-model fact
and a citation of the content gate of issue #1111 for the behavior it
encodes — which node-granularity grounding cannot express without fusing the
two into one opaque field (the collision plan v1 found, and the reason this
design was revised). So each R5 node carries a `grounds:` **list**:

```yaml
grounds:
  - declares: <dotted path>[.<aspect>]
    citation: <string>
  - declares: <dotted path>[.<aspect>]
    assumption: <string>
```

- Each entry names, in `declares:`, the declaration it grounds — a field or
  mapping key the node itself declares (e.g. `native-value`,
  `provides.intelligence`, `key`, `domain`, `holds`), optionally suffixed by
  **one** aspect token from the closed aspect vocabulary below.
- Each entry carries exactly one of `citation` or `assumption`, non-empty
  (A16).
- A node's `grounds:` list SHALL carry at least one entry — R5's "SHALL NOT
  carry neither" (A4).
- No two entries of one node may name the same `declares` target with
  different mark kinds — R5's "SHALL NOT carry both", enforced at the
  granularity where it binds: per `declares:` target, not per node (A24).
- A `declares:` target that does not resolve to a field or mapping key the
  node declares, or whose aspect suffix is outside the closed aspect
  vocabulary, is rejected (A25).

### The aspect vocabulary is closed

`declares:` admits **one** trailing kebab-case aspect token, and that
vocabulary is closed to exactly `behavior` — the aspect R36 itself needs, to
separate the citation of the guard's *behavior* from the assumption on the
Haiku carve-out's underlying *fact*. An open aspect vocabulary would let a
second `grounds` entry manufacture a fresh `declares:` target by appending an
arbitrary token, re-opening the very collision A24 exists to close on the one
cell R36 protects — a citation and a directly contradicting assumption on
`provides.intelligence` and `provides.intelligence.rung` would both be legal,
which is R5's prohibition made expressible again. Extending this vocabulary
requires a documented reason here, at the same authority that closes the
spec 0195 domains above.

**Residual, recorded rather than re-argued.** If a future reading holds R5 to
bind irreducibly at node granularity, R5 and R36 conflict in a merged spec,
and the fix is a spec 0197 delta — not a correction of this document, which
adopts the per-declaration reading because it is the only one that satisfies
both requirements as written.

## Schema obligations beyond a reading of R4

Four obligations the assertion table enforces beyond the literal text of R4,
each because leaving it unchecked would let a spec-legal-looking mapping ship
broken:

1. **A composite offering must provide what it encodes, and a shared family
   token is expected, not a gap.** `encodes:` is a mapping from characteristic
   to the `-`-delimited token of `native-value` that encodes it (R48,
   Decision A), and A10 asserts it on three clauses: (i) the characteristic is
   a key of `provides` — an offering whose `encodes:` names a characteristic
   SHALL also declare that characteristic under `provides:`, otherwise the
   disagreement check rejects every composite offering before its real teeth
   can run; (ii) the token is a `-`-delimited segment of `native-value`; (iii)
   where that token is itself a member of the characteristic's closed spec
   0195 domain, it SHALL equal `provides.<characteristic>`. Clause (iii) has
   real teeth on a `reasoning` token — `gemini-3.8-flash-low` encoding
   `reasoning: low` must also *provide* `low`, and does — but it is
   **deliberately vacuous** on a family token that is not itself a domain
   member: `intelligence: flash` and `intelligence: haiku` name a vendor
   family or alias, not a rung, so clause (iii) never fires on them. A family
   token MAY be shared by two offerings at two different rungs — the Gemini
   mapping's `gemini-3.1-flash-lite` (`low`) and `gemini-3.5-flash`
   (`medium`) both encode `intelligence: flash` — and this is the intended
   reading, not a gap clause (iii) failed to catch: the rung distinction
   lives entirely in `provides.intelligence`, and the encoded family token
   exists to satisfy clause (i)/(ii) alone. A reader auditing A10's coverage
   should expect this vacuity on every family-named `intelligence` encoding
   and reserve suspicion for a `reasoning` encoding, where clause (iii) is
   the assertion doing the real work.
2. **Every offering must declare `provides.intelligence`.** R4 does not
   single out the `intelligence` characteristic, so an offering that declares
   none is schema-legal today and permanently unselectable under R17 — dead
   weight that ships green. A26 requires the key.
3. **A guidance template places at most one placeholder per sentence**,
   whenever its `carries` list holds more than one item (A20b). A sentence
   boundary is: a `.`, `!`, or `?` followed by whitespace or the end of the
   template; a newline is also a sentence boundary. This is what lets a
   later reader drop an undirected item's clause without having to
   re-segment prose it did not author (the `haiku` reasoning-drop case).
4. **An `item:` value is drawn from the closed vocabulary** above (A27).

## Conventions — enforced and unenforced

**Enforced**, beyond the literal R47–R50 minimum (marked *(coherence)* in
the assertion table): a guard term's directed `holds` ground must be a
citation (A14b); `supports-reasoning-surface: true` requires a frontmatter
reasoning item to exist (A17); an out-of-band surface may not declare `key`,
`domain`, `projection`, or `template` (A18); a guidance template's
placeholder set must equal its `carries` set (A20a) and respect the
one-per-sentence rule (A20b); a guard's `state` must agree with its terms
(A23); a `grounds` entry's `declares:` target must resolve and its aspect
must be in the closed vocabulary (A25); every offering must declare
`provides.intelligence` (A26); every `item:` value must be in the closed
vocabulary (A27).

**Deliberately not enforced:** agreement between an offering's `rank` order
and its `provides.intelligence` rung order. Spec 0197 mandates no such
agreement — a cheaper offering at a *higher* rung is a legitimate lineup —
so the checker does not assume rank and rung move together.

## The checker

`scripts/check-model-mappings.sh` implements the assertion table this
document makes normative (spec 0197 R46–R51). Its own header comment carries
the full usage and exit-code contract, including the `--print-selection`
mode used to pin the golden per-rung selection tables in
`scripts/tests/test-check-model-mappings.sh`.
