# Usage architecture overview

<!-- crewrig-doc: section=reference nav_order=112 published=true title="Usage architecture overview" -->

Token-consumption tracking runs through six stages, each governed by its own
specification and documented on its own page. This page names the stages in
order, says what each one receives and hands on, and lists the places where
the feature is meant to be extended. It holds no mechanics of its own: every
entry links to the page that defines it. For switching the feature on and
off, start with the [usage guide](usage-guide.md); for retention, access, and
removal, read the [organization note](usage-organization.md).

## The six stages

1. **Capture.** Receives a trigger (a CLI hook event, the Antigravity status
   line, or the end of a framework-owned non-interactive run) and reads the
   CLI's own session record, status-line payload, or output envelope. Hands
   on one normalized usage record per unit it could read, or an `uncaptured`
   record naming what it could not read, to the storage stage's write
   function. Governed by spec 0206, with the per-CLI opt-in of spec 0211.
   Detail: [Usage capture architecture](usage-capture.md#architecture-overview).
2. **Record.** A contract rather than a process: it receives what capture
   derives and defines the one shape every later stage reads, validated
   against `schemas/usage-record/v1.schema.json`. Governed by spec 0205 and
   [ADR 0017](adr/0017-usage-record-invariants.md). Detail:
   [Usage record format](usage-record-format.md#field-reference).
3. **Storage.** Receives each record from capture and writes it once to the
   local journal, the source of truth, then mirrors it into MemPalace when
   MemPalace is present. Hands on journal entries through the read surface
   that pricing and the dashboard use. Governed by spec 0207 and its
   delta-01. Detail: [Usage storage](usage-storage.md#on-disk-layout).
4. **Attribution.** Receives the record at the moment capture hands it to
   storage, together with the declared task, the environment, and the
   checkout. Hands on the task key or external reference the record carries
   from then on, plus the ledger corrections applied when records are read.
   Attribution resolves once, at that hand-over, and the ledger applies only
   at read time (see
   [Attribution resolution and the sidecar](usage-capture.md#attribution-resolution-and-the-sidecar)).
   Governed by spec 0208. Detail:
   [Usage attribution](usage-attribution.md#what-attribution-is).
5. **Pricing.** Receives records read from storage, the pinned public price
   list, the organization's own price table, and cached exchange rates. Hands
   on one comparative price per record, stored beside the journal, and period
   rollups. Governed by spec 0209 and its delta-01. Detail:
   [Usage pricing](usage-pricing.md#primary-source).
6. **Dashboard.** Receives records, with the ledger applied, and their
   prices. Hands on three forms of one view for people and programs: a static
   page, a local server, and a terminal report. Governed by spec 0210.
   Detail: [Usage dashboard](usage-dashboard.md#the-three-forms-and-their-commands).

## Fidelity classes

Every record declares one of three fidelity classes: `per-request`,
`run-total`, or `session-cumulative`. They are defined in
[Fidelity declarations](usage-record-format.md#fidelity-declarations). Which
class a record carries depends on the CLI and the channel that captured it,
as `main` stands on 2026-09-24:

| CLI on `main` | Capture channel | Fidelity class it yields |
|---|---|---|
| Claude Code | `own-record-tail`, interactive sessions | `per-request` |
| Gemini CLI | `own-record-tail`, interactive sessions | `per-request` |
| Copilot CLI | `sqlite-assistant-usage-events`, interactive sessions | `per-request` |
| Copilot CLI | `headless-envelope`, adopted non-interactive runs | `run-total` |
| Antigravity CLI | `statusline-shim`, interactive sessions | `session-cumulative` |
| Antigravity CLI | `headless-envelope`, adopted non-interactive runs | `run-total` |

The `headless-envelope` adapter reads the envelopes of all four CLIs, but on
`main` only Copilot CLI and Antigravity CLI have
[adopted launch sites](usage-capture.md#adopted-launch-sites-non-interactive-runs),
so no Claude Code or Gemini CLI record carries `run-total` today.

## Extension points

This is the one list of the places the feature is built to be extended. Each
entry names what it touches, whether it changes the usage-record schema
version, and the section that governs it. An entry is listed only while
`main` supports it.

- **Support a CLI the feature does not capture yet.**
  - Touches: the closed `provenance.cli` set in
    `schemas/usage-record/v1.schema.json`, a new adapter under
    `scripts/lib/usage-capture/adapters/`, and that CLI's setup script.
  - Schema version: **changes it.** Schema v1 lists its four CLIs as a closed
    set, so a fifth CLI needs a new schema version.
  - Governed by: [Field reference](usage-record-format.md#field-reference) and
    [Per-adapter field sources](usage-capture.md#per-adapter-field-sources).
- **Add a capture channel to a CLI already supported.**
  - Touches: a new adapter module under `scripts/lib/usage-capture/adapters/`,
    naming its own `provenance.captureChannel`, which the schema leaves open.
  - Schema version: no change.
  - Governed by:
    [Architecture overview](usage-capture.md#architecture-overview).
- **Adopt a further framework-owned non-interactive launch site.**
  - Touches: the launch site's script, which wraps its CLI call with one of
    the call shapes of `scripts/lib/usage-headless.sh`, and the list of
    adopted sites.
  - Schema version: no change.
  - Governed by:
    [Adopted launch sites](usage-capture.md#adopted-launch-sites-non-interactive-runs).
- **Declare an organization price correction or addition, including a Copilot
  CLI account's billing plan.**
  - Touches: `model-prices.org.json` at the repository root.
  - Schema version: no change.
  - Governed by:
    [Adding and correcting entries](usage-pricing.md#adding-and-correcting-entries)
    and
    [Declaring a Copilot CLI billing plan](usage-pricing.md#declaring-a-copilot-cli-billing-plan).
- **Register a further derived store, so that a period prune reaches it.**
  - Touches: the registry `derivedStores()` in
    `scripts/lib/usage-store/layout.js`.
  - Schema version: no change.
  - Governed by: [Prune and unprune](usage-storage.md#prune-and-unprune).
- **Add an external-asset kind.**
  - Touches: the open registry of `attribution.externalAsset.kind` values.
  - Schema version: a MINOR bump, as the governing section states.
  - Governed by:
    [External asset kinds](usage-record-format.md#external-asset-kinds-r14).
- **Recognize a further forge host for attribution.**
  - Touches: the `CREWRIG_FORGE_HOSTS` environment variable, read by the
    worktree-or-branch channel.
  - Schema version: no change.
  - Governed by:
    [Channel 3: Worktree or branch derivation](usage-attribution.md#channel-3-worktree-or-branch-derivation).
- **Read the dashboard's machine-readable view model.**
  - Touches: the JSON output of the dashboard's terminal report.
  - Schema version: no change.
  - Governed by:
    [The three forms and their commands](usage-dashboard.md#the-three-forms-and-their-commands).

## Governing specifications

- [Spec 0205 — usage record model](../specs/0205-usage-record-model.md)
- [Spec 0206 — capture adapters](../specs/0206-capture-adapters.md)
- [Spec 0207 — usage record storage](../specs/0207-usage-record-storage.md)
  and its [delta-01](../specs/0207-usage-record-storage.delta-01.md)
- [Spec 0208 — usage attribution](../specs/0208-usage-attribution.md)
- [Spec 0209 — usage pricing](../specs/0209-usage-pricing.md) and its
  [delta-01](../specs/0209-usage-pricing.delta-01.md)
- [Spec 0210 — usage dashboard](../specs/0210-usage-dashboard.md)
- [Spec 0211 — usage-capture opt-in](../specs/0211-usage-capture-opt-in.md)
- [Spec 0212 — usage documentation](../specs/0212-usage-documentation.md)
