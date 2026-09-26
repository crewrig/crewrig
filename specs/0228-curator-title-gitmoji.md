---
id: "0228"
slug: curator-title-gitmoji
status: implemented
complexity: small
interaction-mode: AUTO
related-issue: 1273
version: 1.0.0
---

# Curator issue titles carry a per-room Gitmoji prefix

## Intent

When the Harness Curator opens a feedback issue for a friction cluster, the
issue title carries a Gitmoji prefix chosen from the cluster's dominant
friction room, so a maintainer scanning the open-issues list recognizes a
curator-authored issue's category at a glance — the same visual convention
commit and pull-request titles already carry. Duplicate detection continues
recognizing an already-open cluster issue whether its title carries the new
prefix or predates the change, so the two behaviors move together and no
duplicate issue opens during the transition.

## Requirements

1. `curate.py` SHALL derive the cluster's dominant room through a single
   computation shared by both the `room:<dominant>` label (`cluster_labels()`)
   and the issue title's Gitmoji prefix (`compose_body()`); no second,
   independently-tallied room-detection pass SHALL be introduced for the
   title, so the label and the emoji can never disagree about which room a
   cluster is attributed to.
2. For a cluster whose dominant room (per Requirement 1) is one of the five
   fixed friction rooms (`tool`, `prompt`, `format`, `behavior`, `process`),
   `curate.py` SHALL prefix the composed issue title with the room's mapped
   Gitmoji, per the following fixed table, and no other table SHALL be
   introduced or consulted:
   - `tool` → 🐛
   - `process` → 📝
   - `behavior` → 🚸
   - `format` → 🎨
   - `prompt` → 💬
3. For a cluster whose dominant room is not one of the five fixed rooms
   (including the `unknown` room that `cluster_key_for` falls back to when a
   friction carries no room, and any future room value the table in
   Requirement 2 does not cover), `curate.py` SHALL prefix the composed issue
   title with a fixed fallback Gitmoji (🔧) rather than emitting a title with
   no Gitmoji prefix or raising an error.
4. The composed issue title SHALL take the exact shape
   `<emoji> Friction cluster: <cluster_key> (<size> report[s])` — the mapped
   or fallback Gitmoji from Requirement 2 or 3, followed by exactly one
   space, followed by the pre-existing `Friction cluster: …` text unchanged
   in every other byte — so every consumer of the title downstream of the
   emoji-and-space prefix keeps reading the identical text it read before
   this spec.
5. The apply step (`apply.py`, function `_match_existing`) SHALL recognize
   the dedup skip prefix `Friction cluster: <key> (` at either of two
   positions in a candidate issue's title: (a) at the very start of the
   title (the pre-existing behavior, preserved unconditionally for issues
   opened before this spec and for any title with no leading token to
   strip), or (b) immediately after stripping exactly one leading run of
   non-word, non-whitespace characters followed by whitespace (the
   Gitmoji-and-space prefix Requirement 4 now composes). Position (a) SHALL
   be tried first; position (b) SHALL be attempted only when (a) does not
   match.
6. The trailing `(` (preceded by a space) anchor of the skip prefix SHALL be
   preserved unchanged at whichever position (per Requirement 5) makes the
   match, so the existing sibling-cluster-key disambiguation (for example, a
   cluster keyed
   `yq` SHALL NOT match an issue titled for `yq-merge`) is unaffected by the
   relaxation.
7. Neither Requirement 5 nor Requirement 6 SHALL change `_dedup_list_cmd`'s
   per-forge search or list invocation strings; the relaxation is confined
   to the pure, no-I/O title matcher `_match_existing`.

## Scenarios

**Scenario:** Cluster with a dominant room in the fixed table gets its
mapped Gitmoji

```text
Given a friction cluster whose dominant room (by Requirement 1's shared
      computation) is `process`
When  curate.py composes the cluster's issue title
Then  the title starts with `📝 Friction cluster: <cluster_key> (` and the
      `room:process` label (from cluster_labels()) names the same dominant
      room the emoji was chosen from
```

**Scenario:** Cluster with no room match falls back to the fixed fallback
Gitmoji

```text
Given a friction cluster whose dominant room is `unknown` (the
      cluster_key_for fallback — no friction in the cluster carries a
      recorded room)
When  curate.py composes the cluster's issue title
Then  the title starts with `🔧 Friction cluster: unknown (` rather than an
      unprefixed title, and composing the title raises no exception
```

**Scenario:** Dedup recognizes a Gitmoji-prefixed existing issue title

```text
Given --dedup is enabled and an open harness-feedback issue already exists
      whose title is "🐛 Friction cluster: yq (3 reports)"
When  the apply step runs _match_existing for cluster_key "yq"
Then  it strips the leading "🐛 " token, matches the trailing
      "Friction cluster: yq (" anchor, and returns a match so the cluster's
      issue is skipped
```

**Scenario:** Dedup does not false-positive across sibling cluster keys
through an emoji-prefixed title

```text
Given --dedup is enabled, an open issue exists titled
      "🎨 Friction cluster: yq-merge (2 reports)", and the current cluster's
      key is "yq"
When  the apply step runs _match_existing for cluster_key "yq"
Then  the stripped-prefix match against "Friction cluster: yq (" does NOT
      match "Friction cluster: yq-merge (", no skip occurs, and the
      cluster's own issue is still opened
```

**Scenario:** Dedup still recognizes a pre-existing issue title with no
Gitmoji prefix

```text
Given --dedup is enabled and an open issue exists whose title is exactly
      "Friction cluster: yq (3 reports)" (opened before this spec)
When  the apply step runs _match_existing for cluster_key "yq"
Then  the start-of-title match (position (a) of Requirement 5) fires first
      and the cluster is skipped, unaffected by the new stripped-prefix path
```

## Out of scope

- The `gh` / `glab` / `tea` search or list query strings built by
  `_dedup_list_cmd` — they remain unanchored substring/keyword searches
  against `Friction cluster: <key>` and are unaffected either way; they are
  not required to account for the Gitmoji prefix, since the skip decision
  itself is made by `_match_existing` on the returned titles, not by the
  query string.
- Retitling already-open `harness-feedback` issues to add the new Gitmoji
  prefix. The backward-compatible dedup matching (Requirements 5–6) is what
  lets pre-existing un-prefixed titles and newly-composed prefixed titles
  coexist without a bulk-retitle migration.
- `curate.py`'s clustering, routing, or target-repository selection logic,
  and `cluster_labels()`'s existing alphabetical tie-break for the dominant
  room when two rooms are equally frequent — both unchanged by this spec.
- `setup-labels.sh` and any GitHub label provisioning. Labels are untouched
  by this spec; only the title string and the dedup matcher reading it
  change.
- A Gitmoji mapping for a sixth friction room, should one ever be
  introduced. Out of scope until `config/TOOLS.md`'s fixed 5-room list
  changes, at which point a delta-spec extends the table in Requirement 2.
- Updating `SKILL.md`'s narrative documentation to describe the new
  mapping — a DEV-stage documentation change, not a normative requirement.

## Open questions

- [AUTO-PARKED] Only the `tool` → 🐛, `process` → 📝, and `behavior` → 🚸
  mappings have observed precedent (13 sibling manually-opened issues,
  issues #1259–#1272, confirmed by reading their actual titles and labels).
  The `format` → 🎨 and `prompt` → 💬 mappings, and the 🔧 fallback for an
  unmapped or unknown dominant room, are new extensions this spec proposes
  with no prior manual precedent to confirm against. Audit these three
  choices at spec-PR review; revise via a delta-spec if the maintainer
  prefers different emoji for `format`, `prompt`, or the fallback.
