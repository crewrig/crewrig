---
id: "0202"
slug: model-declaration-documentation
status: draft
complexity: small
interaction-mode: MINIMAL
related-issue: 1131
version: 1.0.0
---

# Documentation of the CLI-agnostic model declaration

## Intent

A reader of CrewRig's published documentation learns, on the page where that
reader would already be looking, that an agent source states what its work
needs from a model rather than naming a model, what each of the four supported
command-line interfaces ends up carrying as a result, how an adopting
organization changes that outcome for its own fork, and what the migration of
the core agents and of the compiled Claude Code layout asks of that
organization — which is nothing. Every statement those pages carry is one a
merged specification already makes, and the pages send a reader who wants the
rule itself to the page or the specification that owns it. The website shows
the same pages once its pinned snapshot advances past this change, and its
storytelling copy says what a copywriter has agreed it should say, which may be
nothing new.

## Requirements

Requirements 1 to 8 fix what each published page must let a reader learn, 9 to
11 the linking discipline and the cross-link set, 12 to 15 the consistency pass
and the closed set of edited files, 16 and 17 the publication mechanics, 18 and
19 the verification a reviewer can run, and 20 to 25 the ordering of the
downstream website ticket this specification places but does not perform.

1. `docs/authoring.md` SHALL let a reader learn that an agent source — and only
   an agent source — declares the model its work needs as a capability profile
   under `metadata.model:`; that the profile names characteristics and never a
   model, a vendor, or a CLI-namespaced key; that a source carrying no such
   profile keeps session-model inheritance and needs no edit; and that on the
   upstream-owned tiers a source's `metadata:` block admits exactly the two
   keys `provenance` and `model`, so that a per-CLI model key such as the
   retired `metadata.claude.model` is no longer an available way to choose an
   agent's model.
2. `docs/authoring.md` SHALL carry one worked example per `intelligence` rung
   that a core agent source declares at the change set's own `HEAD`, plus one
   for the profile-less case, and each example SHALL show the source
   `metadata.model:` block together with what each of the four targets receives
   — the compiled Claude Code output's guidance sentence and the absence of a
   `model:` frontmatter field on it, the compiled Gemini CLI output's `model:`
   frontmatter field, the absence of any emission on GitHub Copilot CLI, and
   the compiled Antigravity CLI output's guidance sentence. Each example's
   emissions SHALL be derived from the repository rather than composed, by
   `bash scripts/build-components.sh --resolve <agent-source> <target>`, and
   the page SHALL name the commit on `main` the values were derived from, so a
   reviewer re-derives them with the same command.
3. `docs/authoring.md` → *The build* SHALL name all four compiled output roots
   that a `core`-tier component reaches in the committed project tree, so that
   the page's account of what each of the four targets receives is not stated
   against a three-target list.
4. `docs/concepts.md` SHALL carry one concept entry for the CLI-agnostic model
   declaration, letting a reader learn that the profile lives in the source,
   that a per-target mapping decides what the profile resolves to, that the
   build performs that resolution when components are compiled, that a
   resolution never fails a build and records what it could not serve instead,
   and that the compiled Claude Code agent output is one flat file per agent.
   The page's own count of the concepts it introduces SHALL agree with the
   number of concept entries it carries.
5. `docs/adoption-guide.md` SHALL let a reader who is adopting the framework
   learn that `model-mappings/<target>.org.yml` is the org-owned channel
   through which the organization changes what a declared rung resolves to on
   each target, that the channel is shipped present and empty, that `remove:`
   and `replaces-core:` are the two keys it adds beyond a core mapping's shape,
   and that the channel is excluded from upstream synchronization.
6. `docs/adoption-guide.md` SHALL carry the two migration notes an adopting
   organization needs, each stating the action required of that organization:
   that a fork declaring no capability profile on its own agent sources and
   populating no override-channel file takes no action; and that a stale
   per-agent directory left under the user's Claude Code agent directory by the
   retired compiled layout is removed at the next assisted setup, while a
   synchronizing fork lands on the flat compiled layout without acting, because
   the compiled agent output trees carry the `regenerable` synchronization
   policy.
7. `docs/introduction.md` SHALL name the CLI-agnostic model declaration within
   its existing pillar list without adding a pillar, so that the list keeps
   agreeing with the pillar enumeration in `AGENTS.md` that the page states it
   restates.
8. `README.md` SHALL name the CLI-agnostic model declaration in its account of
   the single-source artifact zone, letting a reader who never opens the
   documentation set learn that an agent source states a model need rather than
   a model, without adding an entry to the three-purpose list the file opens
   with.

9. No page this change set edits SHALL restate a normative rule that a merged
   specification or an existing reference page already owns. Where a page would
   restate such a rule, it SHALL state the reader-facing consequence and link
   the owning page or specification instead. A page MAY quote a closed value
   domain it also links, since a reader choosing a value needs the values in
   front of them.
10. The change set SHALL establish the following links, each of which SHALL
    resolve: from `docs/authoring.md` to `artifacts/FORMAT.md`,
    `docs/model-mapping-format.md`, `docs/org-model-mapping-override.md` and
    `docs/agent-profile-migration.md`; from `docs/concepts.md` to
    `docs/authoring.md` and `docs/model-mapping-format.md`; from
    `docs/adoption-guide.md` to `docs/org-model-mapping-override.md`,
    `docs/model-mapping-format.md` and `docs/agent-profile-migration.md`; from
    `README.md` to `docs/model-mapping-format.md`; from `artifacts/FORMAT.md`
    to `docs/org-model-mapping-override.md` and
    `docs/agent-profile-migration.md`; and, in the reverse direction, from each
    of `docs/model-mapping-format.md` and `docs/agent-profile-migration.md` to
    `docs/authoring.md`, so that a reader who arrives on a reference page has a
    route back to the authoring account.
11. The change set's edit to `artifacts/FORMAT.md` SHALL be confined to the
    links requirement 10 names. No field, domain, key set, obligation, or
    build-output description in that file SHALL change.

12. The change set SHALL audit rows 4, 32, 33, 34 and 35 of
    `docs/cli-matrix.md` and the per-CLI gap notes those rows cite, against the
    repository at the change set's own `HEAD`, and SHALL record a verdict for
    each audited row: either that every statement in it holds, or the statement
    that does not and the correction applied. A row that needs no edit SHALL be
    recorded as needing none. No row SHALL be added, removed, or renumbered.
13. The change set SHALL correct, in `docs/model-mapping-format.md`, each
    statement that a merged specification of epic #1100 has falsified since
    that page was written, and SHALL confine that correction to restoring the
    statement's truth. The two such statements known at authoring time are
    named in *Contradictions with merged specs* below; the audit SHALL cover
    the page rather than only those two.
14. The set of files the change set edits SHALL be exactly:
    `docs/authoring.md`, `docs/concepts.md`, `docs/adoption-guide.md`,
    `docs/introduction.md`, `README.md`, `docs/cli-matrix.md`,
    `docs/model-mapping-format.md`, `docs/agent-profile-migration.md` and
    `artifacts/FORMAT.md`. Any file outside that set that the change set finds
    it must edit SHALL be raised on the logbook issue before the edit is made.
15. The change set SHALL make no normative change: no specification file and no
    delta-specification SHALL be added or modified, and no rule stated on an
    edited page SHALL be one that no merged specification already states. A
    contradiction the change set finds that can only be repaired by a
    specification SHALL be named on the logbook issue and routed to the
    specification that owns it, and SHALL NOT be repaired here.

16. Every page the change set edits SHALL keep its `crewrig-doc` metadata block
    byte-identical: no `section`, `nav_order`, `title`, or `published` value
    SHALL change, and no page SHALL be added to or removed from the published
    set. `docs/index.json` SHALL therefore be unchanged by the change set, and
    regenerating it SHALL leave the working tree clean.
17. The change set SHALL leave green every machine check that a documentation
    change reaches: the documentation-index drift guard, the relative-link
    checker, the repository's markdownlint configuration, the machine-specific
    home-path guard, and the component-build drift guard.

18. The change set SHALL record, in its pull-request body, a structural
    verification block: one probe per mention requirements 1 to 8 and 10
    oblige, each probe naming the file and a pattern, the block runnable as a
    single paste on a shallow clone with no network access, and exiting
    non-zero when any probe finds nothing. The block SHALL be portable to
    `bash` 3.2, SHALL NOT pipe a producer into `grep -q` under `pipefail`, and
    SHALL name every probe that fails rather than stopping at the first.
19. Every sentence the change set adds to a published page SHALL be traceable
    to a requirement of spec 0195, 0197, 0198 and its delta-01, 0199, 0200 and
    its delta-01, 0201, spec 0143 delta-01 requirement 8, or spec 0121
    delta-01, or to a fact derived from the repository by the command of
    requirement 2. The pull-request body SHALL carry that trace, one entry per
    added claim.

20. This specification SHALL order the website work and SHALL NOT perform it.
    No file of `crewrig/crewrig-website` SHALL be edited by the change set that
    realizes this specification.
21. The change set SHALL open a ticket on `crewrig/crewrig-website`, cross-
    referenced from the logbook issue, and that ticket SHALL be blocked until
    the in-project pages of requirements 1 to 17 are merged on `main`, because
    the pin the website ticket advances SHALL name a `main` commit that
    contains them.
22. The website ticket SHALL be described as performing, in order: setting the
    `ref` field of `docs-pin.json` to that `main` commit; re-running the
    vendoring sync; passing the bidirectional vendored-snapshot integrity gate;
    and updating the section-scoped browser regression suites whose pinned page
    inventories the new snapshot changes. The description SHALL name the one
    such change known at authoring time — the Reference section grows from 8
    published pages to 11, the three added being
    `docs/model-mapping-format.md`, `docs/org-model-mapping-override.md` and
    `docs/agent-profile-migration.md` — so the ticket does not discover it as a
    surprise.
23. The website ticket SHALL be described as reviewing the site's storytelling
    copy for a mention of the CLI-agnostic model declaration, and that review
    SHALL be performed by the storyteller/copywriter role before any change to
    that copy lands. Changing nothing in the copy SHALL be an admissible
    outcome of the review, and SHALL be recorded as a decision rather than
    inferred from the absence of a diff.
24. No requirement of this specification SHALL be conditioned on the website
    ticket's outcome. The in-project change set SHALL be mergeable, complete,
    and correct while that ticket is unopened, open, or abandoned.
25. The evidence the website ticket returns to this logbook issue SHALL be: the
    merged website pull-request reference, the `ref` value the pin now carries,
    the integrity gate's outcome, the regression suite's outcome, and the
    copy-review decision of requirement 23 including the no-change case.

## Scenarios

**Scenario:** an agent author learns how to declare a model need

```text
Given a contributor who has never read the model-mapping reference pages
When  they open the Authoring section of the published documentation
Then  they can state, without leaving that page, that an agent source declares
      a capability profile under metadata.model:, what an omitted profile
      means, that a per-CLI model key is no longer available, and what each of
      the four command-line interfaces receives for one declared rung
And   every normative rule behind those statements is one click away
```

**Scenario:** an adopting organization learns it has nothing to do

```text
Given an organization whose fork declares no capability profile on its own
      agent sources and has populated no override-channel file
When  it reads the Adoption section of the published documentation
Then  it learns that its own agent sources keep the behavior they have today
And   that the retired per-agent compiled directory is removed at the next
      assisted setup with no manual action
```

**Scenario:** the published index does not move

```text
Given the change set as merged
When  a reviewer regenerates the documentation index from the page metadata
      blocks
Then  the regeneration leaves the working tree clean
And   the drift guard exits zero
```

**Scenario:** a worked example is re-derived and disagrees

```text
Given a reviewer holding the change set and the commit the authoring page
      names as the origin of its worked examples
When  they run the resolution exercise for a named agent source and a named
      target
Then  the selected offering and the emitted prose or frontmatter field printed
      by that exercise equal what the page shows for that pair
And   any disagreement is a blocking finding, because the page states the
      values as derived rather than as illustrative
```

**Scenario:** a page would restate a rule

```text
Given a draft of an edited page that spells out a resolution rule of spec 0198
      in its own words
When  the review pass reads it against the linking discipline
Then  it is a finding, and the sentence is replaced by the reader-facing
      consequence plus a link to the page or specification that owns the rule
```

**Scenario:** a structural probe finds nothing

```text
Given the verification block recorded in the pull-request body
When  a reviewer pastes it into a shell on a shallow clone
Then  it names every mention it could not find and exits non-zero
And   it does not stop at the first missing mention
```

**Scenario:** the pin is bumped before the pages merge

```text
Given the website ticket open and the in-project pull request unmerged
When  someone proposes advancing docs-pin.json to a commit that predates the
      merge
Then  the ordering of this specification refuses it, because the pin must name
      a main commit that contains the merged pages
```

## Out of scope

- Any normative change. No specification or delta-specification is authored,
  amended, or superseded by the change set this specification governs.
- Any change to `artifacts/FORMAT.md` beyond the cross-links of requirement 10.
  Its `metadata.model:` block, its closed `metadata:` key set, its domains, and
  its build-output descriptions are already current and stay untouched.
- Any edit inside `crewrig/crewrig-website`. That repository's own lifecycle
  governs its pull request; this specification only orders the ticket and fixes
  the evidence it returns.
- Adding, removing, or reclassifying a documentation section. The eight-section
  set is closed by spec 0027 and cannot grow without a delta of it.
- Adding a row to `docs/cli-matrix.md`. Rows 33, 34 and 35 already cover the
  mapping surface, the build-time resolution, and the org override; requirement
  12 audits them rather than extending the table.
- Adding a sixth pillar to `docs/introduction.md`, and adding a fourth purpose
  to the list `README.md` opens with. Both enumerations stay at their current
  length; requirements 7 and 8 place the new material inside them.
- Shipping a new script for the structural verification of requirement 18. The
  block is recorded in the pull-request body, so it incurs no
  continuous-integration test-wiring obligation.
- The remaining follow-ups of epic #1100 — probe C of issue #1113, any delta of
  spec 0197 or spec 0198, the `strict` orphan cleanup, and the plugin-packaging
  follow-up of spec 0201.
- Correcting `README.md` → *Repository Structure*, whose build-output listing
  names two of the four compiled trees. The omission predates this epic and is
  unrelated to the model declaration; requirement 3 corrects the equivalent
  listing only on `docs/authoring.md`, where the four-target account this
  specification adds makes it load-bearing.

## Open questions

## Contradictions with merged specs

The audit below covers the pages requirement 14 names, read against specs 0195,
0197, 0198 and delta-01, 0199, 0200 and delta-01, 0201, 0143 delta-01 and 0121
delta-01, at `09765d3`. Each entry is classified **page-side** — repaired by
this change set — or **spec-side** — named, routed to its owning specification,
and not repaired here.

1. **Page-side.** `docs/model-mapping-format.md` → *Purpose and scope* states
   that "nothing in the repository reads a mapping at the end of this ticket".
   Spec 0198 landed the build-time resolution, so a mapping is read on every
   compilation of an agent source. The sentence's second clause — that the
   checker is an authoring-time gate and never a resolution-time failure —
   stays true and stays. Repaired under requirement 13.
2. **Page-side.** `docs/model-mapping-format.md` → *Addressing* states that the
   document "does not define the override channel itself, its location, its
   format, or its precedence", attributing all four to a later seam. The same
   page now carries an *Organization-level override channel* section, added by
   the change set of spec 0199, that defines exactly those four things. The
   clause contradicts its own page. Repaired under requirement 13 by turning it
   into a pointer to that section.
3. **Page-side.** `docs/authoring.md` never mentions `metadata.model:`, while
   presenting itself as the conceptual overview of `artifacts/FORMAT.md`, which
   makes `metadata.model:` the only surface on which an agent source declares a
   model need. The page's *The source file* section presents the per-CLI
   override sections as the escape hatch for anything beyond the three
   universal fields, which reads as licensing the retired
   `metadata.claude.model` key that spec 0200 removed from every core source.
   Repaired under requirements 1 and 2.
4. **Page-side.** `docs/authoring.md` → *The build* names three compiled output
   roots for `core`-tier components. The Antigravity CLI root is committed in
   the project tree alongside the other three, and this change set's own
   four-target account is stated against that list. Repaired under
   requirement 3.
5. **To be adjudicated by the consistency pass of requirement 12, not
   pre-judged here.** `docs/cli-matrix.md` row 34's Claude Code cell reads that
   the resolution "writes `effort:` (frontmatter)". No core agent source
   declares the `reasoning` axis at `09765d3` — spec 0200 delta-01 records
   that — so no compiled Claude Code agent output carries an `effort:` field
   today. Whether the cell states a capability of the resolution, in which case
   it holds, or a property of the compiled tree, in which case it does not, is
   the pass's call. If the pass finds it false the correction is page-side and
   lands in this change set; the row is owned by requirement 42 of spec 0198
   and no specification changes either way.
6. **Fact-base correction, no contradiction.** Issue #1131 and the epic's seam
   (h) scope both speak of "two published reference pages" produced by the
   epic. There are three: `docs/model-mapping-format.md` (nav order 90),
   `docs/org-model-mapping-override.md` (nav order 100) and
   `docs/agent-profile-migration.md` (nav order 110). The cross-link set of
   requirement 10 and the website page-inventory of requirement 22 are both
   stated against three.

No spec-side contradiction was found. `docs/agent-profile-migration.md` already
carries a follow-up note recording that seam (g) landed, so its conditional
forward reference to the flat compiled layout resolves rather than misleads;
`docs/org-model-mapping-override.md` carries no statement that a later seam has
falsified; and the out-of-scope clauses of spec 0197 that hand the resolution
and the override channel to later seams are claims about that specification's
own scope, which stay true.

## Acceptance criteria

Every command below runs from the repository root on a shallow clone, with no
network access, and is portable to `bash` 3.2.

| # | Command | Expected |
|---|---|---|
| A1 | `bash scripts/build-docs-index.sh --check` | exit 0 |
| A2 | `bash scripts/build-docs-index.sh && git diff --exit-code -- docs/index.json` | exit 0 — regeneration is a no-op, proving requirement 16 |
| A3 | `bash scripts/check-markdown-links.sh` | exit 0 |
| A4 | `task lint-markdown` | exit 0 |
| A5 | `bash scripts/check-no-machine-paths.sh` | exit 0 |
| A6 | `bash scripts/build-components.sh --target all --check` | exit 0 |
| A7 | the structural block of requirement 18 | exit 0, every probe reported found |
| A8 | `bash scripts/build-components.sh --resolve <source> <target>` for each pair shown on `docs/authoring.md` | the printed offering and emission equal what the page shows |

The structural block of A7 takes this shape — one line per mention, no producer
piped into `grep -q`, no `bash` 4 construct:

```bash
#!/usr/bin/env bash
# One probe per required mention: "<file>|<extended-regex>|<what it proves>".
set -uo pipefail
rc=0
probes='
docs/authoring.md|metadata\.model:|R1 profile declaration
docs/authoring.md|model-mapping-format\.md|R10 link to the mapping format
docs/concepts.md|model-mapping-format\.md|R10 link from concepts
docs/adoption-guide.md|org-model-mapping-override\.md|R10 link from adoption
README.md|model-mapping-format\.md|R10 link from the README
'
while IFS='|' read -r file pattern label; do
  [ -n "${file:-}" ] || continue
  if grep -Eq -- "$pattern" "$file"; then
    echo "ok   $file  $label"
  else
    echo "MISS $file  $label"
    rc=1
  fi
done <<EOF
$probes
EOF
exit "$rc"
```

The five probes above are the shape, not the set: the change set records one
probe per mention requirements 1 to 8 and 10 oblige.

## Complexity

`small`, per the ADR-0010 tiers: documentation only, one repository, nine
edited files, no script, no test, no build output, and no normative artifact. A
`small` ticket runs `developer` + `pr-logbook` + `pr-reviewer`, which is the
right shape here — the two pieces of real work are a derivation the repository
performs on demand (requirement 2) and an audit with a recorded verdict
(requirement 12), neither of which needs an architect-led decomposition.

The argument for `standard` is that requirement 12 is an audit across a table
whose cells are long and cross-referential, and that requirements 18 and 19
oblige a traceability record. That argument is answered by the fact that this
specification has already performed the audit's discovery pass and recorded its
findings in *Contradictions with merged specs*: what remains is application and
verification, not design. Should the consistency pass of requirement 12 surface
a row whose correction requires a specification change, requirement 15 routes
it out of this ticket rather than growing it.
