---
id: "0023"
slug: en-us-orthography-sweep
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 273
version: 1.0.0
---

# en-GB to en-US orthographic sweep

## Intent

The repository's English prose reads in American spelling throughout. Every
British spelling in first-party human-readable prose — across documentation,
specifications, comments, and framework artifacts — is normalized to its
American form, while the meaning of every text is preserved exactly. A reader
notices consistent American orthography; nothing about behavior, code, or
content changes beyond spelling. This is a one-time normalization, made
legitimate for merged specs by the editorial carve-out (spec 0022).

## Requirements

1. First-party English prose across the repository SHALL use American spelling.
   British spelling families SHALL be normalized to American — including, but
   not limited to, `-ise` to `-ize`, `-our` to `-or`, `-re` to `-er`, `-ogue`
   to `-og`, `licence` to `license`, and doubled-consonant or compound forms
   such as `behaviour` to `behavior`, `organisation` to `organization`,
   `synchronisation` to `synchronization`, `catalogue` to `catalog`, and
   `colour` to `color`.
2. The sweep SHALL change spelling and surface form only; it SHALL NOT alter
   the meaning of any text, requirement, instruction, or scenario.
3. The sweep SHALL NOT modify code identifiers, variable, function, or command
   names, file paths, URLs, proper nouns, or any string where the spelling is
   load-bearing.
4. The sweep SHALL exclude the `LICENSE` legal text, the `tests/fixtures/`
   tree, vendored or third-party content, references to the legacy
   `import/gitlab` project, and the `communication/` materials.
5. The sweep MAY edit merged specifications under `/specs/`; such edits SHALL
   be meaning-preserving editorial edits only, as permitted by the editorial
   carve-out in `docs/spec-format.md` (spec 0022).
6. After the sweep, the targeted British spellings SHALL NOT remain in any
   first-party prose outside the excluded categories.

## Scenarios

**Scenario:** A British spelling in prose is normalized

```text
Given a documentation file contains "behaviour" in its prose
When  the sweep runs
Then  it reads "behavior", with no other change to the file's meaning
```

**Scenario:** Merged-spec prose is normalized as an editorial edit

```text
Given a merged spec under /specs/ contains "organisation" in its prose
When  the sweep runs
Then  it reads "organization" — a meaning-preserving editorial edit permitted
      by spec 0022
```

**Scenario:** A load-bearing or excluded occurrence is left unchanged

```text
Given a British spelling appears inside a code identifier, a URL, a file path,
      a proper noun, or an excluded location (LICENSE, tests/fixtures, vendored
      or third-party content, import/gitlab references, communication/)
When  the sweep runs
Then  that occurrence is left unchanged
```

## Out of scope

- A going-forward continuous-integration linter or guard to keep prose in
  American spelling — the maintainer chose a one-time sweep; no preventive
  guard ships with this spec.
- Any change to meaning, structure, behavior, or non-prose content (code,
  configuration values, identifiers) — spelling only.
- Re-spelling content the project does not own (the excluded categories in R4).

## Open questions

- None.
