---
id: "0212"
slug: usage-documentation
status: approved
complexity: small
interaction-mode: MINIMAL
related-issue: 1175
version: 1.0.0
---

# Usage documentation — architecture overview, user guide, and organization note for token-consumption tracking

## Intent

A person who meets CrewRig's token-consumption tracking for the first time
finds one entry point that tells them what the feature does end to end, how
to switch it on and off on each of the four CLIs as those switches actually
exist today, what it records and what it never records, how to read the
dashboard, what a comparative price does and does not mean, and how to take
history in and throw it away again. An organization weighing adoption finds
one note that states, in one place, what per-user activity data the feature
holds, how long it stays, who can read each copy, how to remove all of it,
why the price list comes from where it comes from, and what changes when
MemPalace is absent. A maintainer finds one architecture overview that names
each stage, what each stage hands to the next, and where the feature is meant
to be extended. None of these three documents competes with the per-seam
reference pages already on `main`: every detail keeps exactly one home, the
four scattered personal-data notes defer to the organization note, and the
documented removal finally reaches everything the feature writes.

## Requirements

In this section, a **per-seam document** is any of `docs/usage-capture.md`,
`docs/usage-record-format.md`, `docs/usage-storage.md`,
`docs/usage-attribution.md`, `docs/usage-pricing.md`,
`docs/usage-dashboard.md`, and `docs/adr/0017-usage-record-invariants.md`;
the **usage root** is the directory `CREWRIG_USAGE_ROOT` names, defaulting to
`~/.crewrig/usage`; the **three new documents** are those requirement 1
names. Requirements 1 and 2 cover the document set, 3 to 6 the architecture
overview, 7 to 15 the user guide, 16 to 24 the organization note, 25 to 28
the consolidation of the existing personal-data notes, 29 and 30 the
no-duplication rule, and 31 and 32 the CLI matrix and the website.

1. The documentation set SHALL gain three documents at stable, linkable
   paths: an architecture overview at `docs/usage-overview.md`, a user guide
   at `docs/usage-guide.md`, and an organization note at
   `docs/usage-organization.md`.
2. The user guide SHALL be the reader's entry point: its opening section SHALL
   link to the architecture overview and to the organization note, and every
   per-seam document SHALL link back to the architecture overview.
3. The architecture overview SHALL name the six stages in order — capture,
   record, storage, attribution, pricing, dashboard — and for each stage SHALL
   state what the stage receives, what it hands to the next stage, and which
   specification governs it, and SHALL link to the per-seam document that
   holds that stage's detail.
4. The architecture overview SHALL name the three fidelity classes
   (`per-request`, `run-total`, `session-cumulative`), SHALL state which
   capture channel yields which class on each of the four CLIs as `main`
   stands when the overview is written, and SHALL link to the record format's
   fidelity section for the definitions.
5. The architecture overview SHALL carry exactly one list of extension points.
   Each entry SHALL name the extension, the contract or file it touches,
   whether it changes the usage-record schema version, and the per-seam
   section that governs it. The list SHALL cover at least: supporting a CLI
   the feature does not yet capture (a schema change, since the record's CLI
   identifier is a closed set in schema v1); adding a capture channel for a
   CLI already supported; adopting a further framework-owned non-interactive
   launch site; declaring an organization price correction or addition,
   including the declaration of a Copilot CLI account's billing plan;
   registering a further derived store so that an explicit prune reaches it;
   adding an external-asset kind; recognizing a further forge host for
   attribution; and reading the dashboard's machine-readable view model.
6. Every extension point the list names SHALL exist on `main` when the
   overview is written; an extension `main` does not support SHALL NOT be
   listed, and a listed entry whose supporting code or document is later
   removed SHALL be removed from the list in the same change.
7. For each of the four CLIs, the user guide SHALL state how usage capture is
   enabled and how it is disabled as each exists on `main` when the guide is
   written, naming the installer prompt, setting, or manual step involved,
   and SHALL state the date on which that description was verified against
   `main`. Where no installer path disables capture on a CLI, the guide SHALL
   say so and SHALL describe only the manual steps that do exist. The guide
   SHALL also state that the framework-owned non-interactive launch sites
   `docs/usage-capture.md` → *Adopted launch sites* lists write usage records
   whenever they run, whatever was chosen at install time, SHALL link to that
   section rather than list the sites, and SHALL state whether `main` offers
   any switch that stops that channel; the organization note SHALL state the
   same.
8. The user guide and the organization note SHALL NOT describe an enable or
   disable path that `main` does not provide.
9. While enabling capture on Claude Code, Gemini CLI, or Copilot CLI remains
   part of the same installer opt-in that wires conversation-transcript
   recording into MemPalace, the user guide SHALL disclose that coupling
   where it describes enabling capture on those CLIs, SHALL state everything
   else that opt-in installs and records on each of them — every further hook
   it wires and every setting it writes — and SHALL state what the
   coupling means on a machine without MemPalace. The guide SHALL NOT carry
   that disclosure once `main` no longer couples the two.
10. The user guide SHALL state, in categories, what a usage record holds and
    what it never holds, and SHALL link to the record format and capture
    pages for field-level detail. A statement that no usage record holds
    conversation text SHALL be true of every record kind and capture channel
    `main` produces; where `main` produces a record that does hold such text,
    the user guide and the organization note SHALL each disclose the
    exception, name the capture channel and record kind concerned, and link
    to the issue that tracks its correction.
11. The user guide SHALL explain how to read the dashboard at the level of
    which of the three forms suits which purpose and which question each
    section of a view answers, and SHALL link to `docs/usage-dashboard.md`
    for commands, filters, tallies, and empty-result banners.
12. Wherever the user guide refers to the period in which a session-cumulative
    session is counted, it SHALL link to the per-seam section that states the
    placement rule on `main` when the guide is written (spec 0209 delta-01
    requirements 43 to 45 and 49) and SHALL NOT restate, paraphrase, or give
    an example of that rule; the one-sentence summary requirement 29 allows
    does not apply to it.
13. The user guide SHALL explain how to interpret a comparative price and
    SHALL make each of these points, each linked to the per-seam section that
    defines the behavior: every price is a reference figure, not an invoice;
    Copilot CLI accounts fall under one of two billing regimes — current
    billing and a legacy premium-request plan — and the comparative price
    relates to each as spec 0209 requirements 20 and 21 define; Claude Code
    subscriptions and Gemini CLI free tiers bill nothing per token, so a price
    for their records is what the same consumption would cost at listed rates,
    not what the person paid; and a Google model's cache-storage cost is not
    included (spec 0209 requirement 15), so a price for long-lived Gemini
    caches is an under-estimate.
14. Where the user guide or the organization note needs a mechanic that no
    per-seam document yet documents — for example, the organization price
    table's declaration of a Copilot CLI account's billing plan — that
    mechanic SHALL be documented in the per-seam document that owns it, and
    the guide or note SHALL link to it there.
15. The user guide SHALL cover backfilling history, pruning and unpruning a
    period, and removing everything, each as a short task description that
    links to its mechanics: backfill to `docs/usage-capture.md`, prune and
    unprune to `docs/usage-storage.md`, and removal to the organization note.
16. The organization note SHALL be the single reference for retention,
    access, and removal of the data the usage feature holds. Its account of
    what is held and who can read it SHALL be stated as a rule over the whole
    usage root — every location the feature writes there is covered, and a
    location the feature starts writing after this specification is covered
    without editing the note — plus the locations the feature writes outside
    it: the MemPalace mirror and each dashboard form's output. Locations MAY
    be named as examples, never as a closed list. Every location that can
    hold usage records or data derived from recorded activity SHALL be
    identified as such, including any location holding records verbatim
    before they reach the journal.
17. The organization note SHALL state that no record, ledger entry, or price
    expires on its own and that data stays until an explicit prune or
    removal, so that retention is the adopting organization's decision.
18. The organization note SHALL frame the data as per-user activity data in a
    GDPR context — what is held, the absence of automatic retention, who has
    access, and how erasure is carried out — and SHALL state that it is not
    legal advice.
19. The organization note SHALL describe two removal procedures: (a) purging
    the stored data while capture stays enabled, and (b) removing the feature
    entirely. Each procedure SHALL state which locations it removes and SHALL
    state that the CLIs' own session records, which the feature reads but
    never writes, remain in place and are a source from which usage records
    can be derived again.
20. After a person follows procedure (b) on a machine where every stage has
    run — capture on every enabled CLI, mirroring, a declaration, a ledger
    entry, a stored price, and a form A page at its default location — no
    file or directory SHALL remain under the usage root, no drawer the mirror
    wrote SHALL remain in MemPalace, and no CLI configuration SHALL still
    invoke a usage-capture entry point. Procedure (b) SHALL name the outputs
    a person may have placed outside the usage root — a form A page written
    to a chosen path, redirected form C output — as the person's own to
    delete, and SHALL state that running an adopted non-interactive launch
    site afterwards writes to the usage root again, for as long as `main`
    offers no switch that stops that channel.
21. After a person follows procedure (a), no item derived from recorded
    activity SHALL remain under the usage root or in the MemPalace mirror,
    except the capture state; the note SHALL state what the capture state
    holds and why procedure (a) keeps it. Items not derived from recorded
    activity — the pinned price list and the cached exchange rates — MAY
    remain, and the note SHALL say whether they do.
22. Both procedures SHALL be stated as a rule over the whole usage root with
    a named list of exceptions, so that a location the feature starts writing
    under the usage root after this specification is covered without editing
    the procedure; neither procedure SHALL rest on a closed list of
    directories to remove. Each procedure SHALL state its preconditions — at
    least whether MemPalace must be reachable for the mirror's drawers to be
    removed, and how the current and future periods, which the period prune
    refuses without an explicit override, are handled — and SHALL end with a
    check a person can run to confirm the outcome requirement 20 or 21
    states. That check SHALL fail closed: where it cannot inspect a location
    — the mirror while MemPalace is unreachable — it SHALL report that
    location as unverified, never as removed.
23. The organization note SHALL explain the price-source decision as one
    already taken: the MIT-licensed LiteLLM price list pinned to one commit is
    the primary source, OpenRouter is reached only on an explicit, one-shot,
    human-initiated cross-check, and the reason is section 7 of OpenRouter's
    Terms of Service. The note SHALL link to `docs/usage-pricing.md` for the
    mechanism and SHALL NOT present the decision as open.
24. The organization note SHALL describe a deployment without MemPalace: that
    the journal is a first-class backend on which every stage runs, what a
    person loses without the mirror, and — while capture enablement on three
    CLIs remains coupled to the transcript opt-in — what that coupling means
    for such a deployment.
25. The personal-data sections of `docs/usage-capture.md`,
    `docs/usage-storage.md`, `docs/usage-attribution.md`, and
    `docs/usage-dashboard.md` SHALL each keep only what their own seam stores
    and SHALL link to the organization note for retention, access, and
    removal; none of them SHALL state who can read the data or carry a purge
    or removal command.
26. The whole-root purge instructions now carried in `docs/usage-storage.md`
    and `docs/usage-attribution.md` SHALL be replaced with a link to the
    organization note's removal procedures, so the corrected removal has
    exactly one home. The period-scoped prune and unprune mechanics SHALL
    stay in `docs/usage-storage.md`.
27. After consolidation, the documentation set SHALL still discharge spec
    0207 requirement 21, spec 0208 requirement 30, and spec 0210 requirement
    23, and each obligation those requirements state SHALL be met in exactly
    one document section.
28. The *See also* section of `docs/usage-storage.md` SHALL link to
    `docs/usage-capture.md` as an existing page and SHALL NOT state that the
    page is forthcoming or that capture writes to a spool.
29. The three new documents SHALL carry no normative content that a per-seam
    document already carries. Normative content, for this requirement, is a
    command's options and defaults, an environment variable's meaning and
    default, an on-disk layout, a field-by-field shape, an ordered rule or
    resolution ladder, and a worked example. A new document MAY name a
    command, a path, a field, or a rule to identify it, and MAY summarize a
    per-seam rule in one sentence, provided the same paragraph or list item
    links to the per-seam section that defines it.
30. No fenced code block and no table row of the three new documents SHALL
    reproduce, verbatim or with whitespace-only changes, a fenced code block
    or a table row of a per-seam document.
31. `docs/cli-matrix.md` SHALL link to the architecture overview and to the
    user guide from its usage-capture rows or from a note adjacent to them;
    the change SHALL add no row and SHALL alter no parity verdict or its
    evidence text.
32. Each of the three new documents SHALL carry a complete `crewrig-doc`
    publication marker with `published=true`, a section from the fixed
    taxonomy, a `nav_order`, and a title; `docs/usage-dashboard.md` SHALL
    carry a complete marker with `published=true` in place of its current
    `published=false`; and the committed documentation index SHALL equal the
    index regenerated from the tree.

## Scenarios

**Scenario:** A first-time reader enables capture on Antigravity CLI

Given `main` wires Antigravity CLI capture through its own installer opt-in
and offers a removal path that restores the prior status-line command
When a person follows the user guide's Antigravity section
Then the guide names that opt-in and that removal path, states that the
installer leaves a status-line command it did not install untouched, and
carries the date on which the description was verified against `main`

**Scenario:** The guide invents a disable path

Given `main` offers no installer path that disables capture on Claude Code on
its own
When a reviewer reads a draft guide telling the person to answer "no" when
re-running the Claude Code installer to disable capture
Then the draft fails requirement 8, because answering "no" leaves the merged
capture hook in place

**Scenario:** A MemPalace-less organization reads about the coupling

Given capture enablement on Claude Code, Gemini CLI, and Copilot CLI is part
of the installer opt-in labeled as session recording to MemPalace
When an organization that will never install MemPalace reads the organization
note
Then it learns that enabling capture on those CLIs also installs transcript
recording, what that recording would write, and what the coupling means for
a deployment without MemPalace

**Scenario:** Complete removal leaves nothing behind

Given a machine where capture ran on every enabled CLI, records were
mirrored, a declaration and a ledger entry were written, a price was stored,
and a form A page was generated at its default location
When a person follows removal procedure (b)
Then no file or directory remains under the usage root, no drawer the mirror
wrote remains in MemPalace, no CLI configuration still invokes a
usage-capture entry point, and the CLIs' own session records are still
present

**Scenario:** A removal order that strands the Antigravity shim

Given `main`'s Antigravity removal path recognizes its own installation only
through a marker kept in the capture state
When a reviewer follows a draft procedure (b) that deletes the usage root
before disabling Antigravity capture
Then the status-line command still invokes the capture shim, the installer no
longer offers its removal, and the draft fails requirement 20

**Scenario:** A probe run after complete removal

Given a person has followed removal procedure (b)
When a framework-owned non-interactive launch site listed under *Adopted
launch sites* runs afterwards
Then the usage root is written again, and the user guide and the
organization note have both said so, linked to that section, and stated
whether `main` offers a switch that stops that channel

**Scenario:** Removal attempted while MemPalace is unreachable

Given records were mirrored and the MemPalace daemon is not reachable
When a person starts removal procedure (b)
Then the procedure's stated preconditions have told the person that the
mirror's drawers cannot be removed until MemPalace is reachable, and its
closing check reports the mirror as unverified rather than removed

**Scenario:** Purging data while capture stays enabled

Given a machine with capture enabled and history already recorded
When a person follows removal procedure (a) and then starts a new session
Then only the new session's usage is recorded, the purged history is not
derived again, and the organization note has stated why the capture state
was kept

**Scenario:** A location added after this specification

Given the feature starts writing a new directory under the usage root after
this specification merges
When a person follows removal procedure (b) unchanged
Then the new directory is removed with the rest of the usage root, because
the procedure is a rule over the whole root with named exceptions

**Scenario:** The guide copies a per-seam command block

Given `docs/usage-storage.md` carries the fenced block for the period prune
When a reviewer finds the same fenced block in the user guide
Then the change fails requirement 30, and the guide instead names the task
and links to the storage page's prune section

**Scenario:** The period rule changes after the guide ships

Given the user guide links to the per-seam section that states the placement
rule and restates nothing of it
When the implementation of spec 0209 delta-01 (issue #1193) moves or amends
the per-seam text that states the rule
Then the user guide needs at most its link target updated, and none of its
own prose

**Scenario:** A legacy Copilot plan holder reads a price

Given a Copilot CLI user on a legacy annual premium-request plan
When the person reads the user guide's comparative-price section
Then the guide explains that the price is a reference computed at listed
rates rather than the account's billed cost, and links to the per-seam page
that documents how the organization price table declares the plan

**Scenario:** A record kind that does hold conversation text

Given a record kind or capture channel on `main` whose stored record holds
model response text
When a reviewer reads the guide's "what is never recorded" statement
Then the guide and the organization note each disclose that exception, name
the channel and record kind, and link to the issue tracking its correction,
and neither states an unconditional exclusion

**Scenario:** An extension point that does not exist

Given a draft overview that lists "add a fifth CLI by dropping in an adapter
module" as needing no schema change
When a reviewer checks the entry against `main`
Then the entry fails requirement 5, because schema v1's CLI identifier is a
closed set and supporting a new CLI changes the schema

**Scenario:** Consolidation keeps the merged obligations

Given the consolidated personal-data notes and the organization note
When a reviewer traces spec 0207 requirement 21, spec 0208 requirement 30,
and spec 0210 requirement 23 through the documentation set
Then every obligation they state maps to exactly one document section, and
no per-seam personal-data section still carries a purge command

**Scenario:** The CLI matrix gains links and nothing else

Given issue #1174 also edits `docs/cli-matrix.md`
When the change for this specification is diffed against `main`
Then the matrix gains links to the overview and the user guide, and no row
is added and no parity verdict or evidence text changes

**Scenario:** The website lists the usage pages

Given the three new documents and the dashboard page carry published markers
When the documentation index is regenerated and checked against the
committed one
Then the check passes and the index lists all four pages beside the other
published usage pages

## Out of scope

- Any change to the setup scripts, the hook manifests, or the way capture is
  enabled or disabled on any CLI, including decoupling capture from the
  transcript opt-in — issue #1174 (seam h). The documentation update that
  decoupling requires is that ticket's to make.
- The placement rule for session-cumulative sessions that straddle a period
  boundary — issue #1193. This specification only links to the rule.
- Any behavior change in the usage scripts, libraries, schema, or price
  engine, including the correction of any record that holds conversation
  text; this specification documents `main` as it stands.
- Rewriting the per-seam reference content — the per-adapter field sources,
  format fingerprints, and known traps already in `docs/usage-capture.md`,
  the storage layout, the attribution channels, the pricing ladder, the
  dashboard's forms — beyond the consolidation requirements 25 to 28 name.
- New rows, parity verdicts, or gap evidence in `docs/cli-matrix.md`.
- Legal advice, a data-protection impact assessment, or any statement of an
  organization's own obligations under GDPR.
- MemPalace's own retention, access control, or deletion behavior.
- Translated editions of the new documents.

## Open questions

None. The one question raised while drafting is resolved:

- Grounding finding for requirement 10: the headless-envelope adapter
  (`scripts/lib/usage-capture/adapters/headless-envelope.js`, `raw:
  envelope`) stores the whole non-interactive output envelope as the
  record's `raw` block, and Antigravity CLI's `--output-format json`
  envelope carries the model's `response` text, so `run-total` records from
  the adopted Antigravity launch sites hold response text in the journal —
  contrary to spec 0206 requirement 18 and to every "never conversation
  text" statement on `main`. Resolved as a spec 0206 defect tracked in
  issue #1201, which requirement 10's disclosure links for as long as the
  defect is on `main`.

## Rationale (informative)

**Tier.** `small`: documentation only, no code, no schema, no behavior. The
change touches three new pages, the personal-data and purge sections of four
per-seam pages, one link in the CLI matrix, and the regenerated index.
`standard` was considered because the consolidation crosses four seams'
documents, but every edit is prose whose correctness a reviewer can check
against `main` directly, and no design choice is left for an architect.

**Sequencing.** DEV should follow issue #1174 when possible, so that the
enable/disable section is written once against the decoupled installers
rather than disclosing a coupling that is about to disappear. If DEV must go
first, requirement 9's disclosure applies and #1174 removes it. The link to
the placement rule (requirement 12) keeps this specification independent of
issue #1193. Spec 0209 delta-01 merged before this specification did; its
requirement 49 places the rule in the organization-facing pricing
documentation and forbids describing a divergence the implementation does
not exhibit, which requirement 12's no-restatement rule already honours.
PLAN resolves the link target against `main` at DEV time.

**Why the purge moves rather than grows.** The owner's two decisions — the
organization note is the single reference for removal, and the documented
purge must reach everything the feature writes — are met together by moving
the whole-root purge out of `docs/usage-storage.md` and
`docs/usage-attribution.md` into the organization note and correcting it
there. Patching both copies in place would keep two homes for one
procedure, which is how they diverged in the first place.

**Grounding observed on `main` at `e1319ae`** (inputs to PLAN, not
requirements):

- The usage root holds `journal/`, `declarations/`, `ledger/`, `prices/`,
  `pricelist/`, `fx/`, `dashboard/`, `mirror/`, `cache/`, `pruned/`,
  `locks/`, `tmp/`, legacy `spool/`, and the capture-owned `state/`
  (`scripts/lib/usage-store/layout.js`). The documented purge in both
  `docs/usage-storage.md` and `docs/usage-attribution.md` names only
  `journal`, `declarations`, `ledger`, `mirror`, `cache`, and `tmp`: it also
  misses `pruned/`, `locks/`, `spool/`, `pricelist/`, and `fx/`, not only
  `prices/` and `dashboard/`. It removes no MemPalace drawer, although the
  period prune does.
- `state/` holds the capture cursors, memoized CLI versions, and
  `state/antigravity-statusline.json`, the marker the Antigravity installer
  reads to offer its removal path. Removing `state/` while capture is
  enabled makes the next capture derive the whole CLI history again;
  removing it before disabling Antigravity capture strands the shim. Hence
  procedure (a) keeps `state/`, and procedure (b) disables capture first and
  then removes the whole root.
- On Claude Code, Gemini CLI, and Copilot CLI, the capture hook is merged
  inside the "Enable automatic session recording to MemPalace?" opt-in, which
  also installs the transcript hook and sets `MEMPALACE_TRANSCRIPT_ENABLED`.
  The prompt is not gated on MemPalace being installed, so a MemPalace-less
  machine can enable capture, at the cost of also wiring and enabling a
  transcript hook whose purpose is to record conversation text into
  MemPalace (its behavior while MemPalace is absent is for PLAN to verify
  before the guide states it). `hooks/usage-capture.sh` does not read
  `MEMPALACE_TRANSCRIPT_ENABLED`, so setting it to `0` stops transcript
  recording while capture continues. Answering "no" on a re-run removes
  nothing; no installer path removes the capture hook on these three CLIs.
- `provenance.cli` is a closed enum in `schemas/usage-record/v1.schema.json`;
  `provenance.captureChannel` and `attribution.externalAsset.kind` are open.
  The derived-store registry is `derivedStores()` in `layout.js`. The
  organization price table is `model-prices.org.json` at the repository root,
  and its `copilot.plan` and `copilot.aiuRateUsd` keys
  (`scripts/lib/usage-price/copilot.js`) appear in no per-seam document
  today — the case requirement 14 addresses.
- `docs/usage-dashboard.md` is `published=false` on purpose: the spec 0210
  plan (issue #1173, step 16) and PR #1195 defer its publication and
  navigation to this ticket.

**Default publication placement.** All published usage pages sit today in
the `reference` section (`nav_order` 115 to 140). The default is to keep the
three new pages and the dashboard page in that section, with the overview,
guide, and organization note ahead of the per-seam pages and the dashboard
page after pricing; PLAN may choose otherwise within the fixed taxonomy.
