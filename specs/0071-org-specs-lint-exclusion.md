---
id: "0071"
slug: org-specs-lint-exclusion
status: implemented
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 421
version: 1.0.0
---

# Exclude the org-owned specs/org/ overlay from the upstream spec-linter's numbering convention

## Intent

An adopting organization that gives its org-owned `specs/org/` overlay a
numbering or naming convention distinct from the upstream
`specs/<NNNN>-<slug>.md` sequence sees `task spec:lint` succeed on a clean
checkout, rather than fail on content that the organization — not the
upstream project — owns and governs.

## Requirements

1. The spec linter (`scripts/lib/spec-linter.js`, invoked through `task
   spec:lint`) SHALL NOT validate any file located under `specs/org/`
   against the upstream `<NNNN>-<kebab-slug>.md` filename convention, the
   frontmatter `id`/`slug` identity checks, or the mandatory heading set
   for original or delta specs, and SHALL NOT report a diagnostic for any
   such file on that basis.
2. `task spec:lint` invoked with no target arguments — the invocation the
   `lint-specs` job in `.github/workflows/build.yml` runs — SHALL exit
   zero on a checkout whose `specs/org/` directory contains one or more
   files that do not conform to the upstream filename, frontmatter, or
   heading convention, provided every file under `specs/` outside
   `specs/org/` conforms to that convention.
3. The exclusion of `specs/org/` from upstream validation SHALL hold
   whether a non-conforming file under that path is reached through the
   linter's default recursive directory discovery or through an explicit
   path argument naming that file or its containing directory.
4. The spec linter SHALL continue to apply the full upstream filename,
   frontmatter, and heading validation, unmodified, to every file under
   `specs/` located outside `specs/org/`, on the same invocation that
   also processes `specs/org/` content.
5. The spec linter SHALL derive which paths under `specs/` are excluded
   from upstream validation from `.crewrig/core-paths.txt`'s `excluded`
   classification, rather than from a check hardcoded to the literal
   path `specs/org/`, so that a path nested under `specs/` that
   `.crewrig/core-paths.txt` classifies `excluded` in the future is
   excluded from upstream validation without a further change to the
   spec linter itself.

## Scenarios

**Scenario:** Default CI invocation ignores a non-conforming org spec.

Given `specs/org/` contains a file named `ORG-0001-example.md` whose
frontmatter `id` is `"ORG-0001"` and whose name does not follow the
upstream `<NNNN>-<kebab-slug>.md` pattern
And every file under `specs/` outside `specs/org/` conforms to the
upstream convention
When `task spec:lint` runs with no target arguments, as the `lint-specs`
CI job does
Then the linter reports no filename, frontmatter, or heading violation
for `specs/org/ORG-0001-example.md`
And the command exits zero

**Scenario:** A non-conforming upstream spec is still caught.

Given a file under `specs/` outside `specs/org/` has a filename that does
not match `<NNNN>-<kebab-slug>.md`
When `task spec:lint` runs with no target arguments
Then the linter reports the filename violation for that file
And the command exits non-zero

**Scenario:** Explicit path targeting does not re-introduce the failure.

Given `specs/org/ORG-0001-example.md` does not conform to the upstream
convention
When an agent runs the spec linter with an explicit target naming
`specs/org` or that file directly
Then the linter still reports no violation for that file
And the command exits zero, provided no other target fails validation

**Scenario:** A newly excluded path under `specs/` is honored without a
linter code change.

Given `.crewrig/core-paths.txt` classifies a path nested under `specs/`
other than `specs/org` as `excluded`
And a file under that path does not conform to the upstream filename,
frontmatter, or heading convention
When `task spec:lint` runs with no target arguments
Then the linter reports no violation for that file, on the strength of
the manifest classification alone

## Out of scope

- Adopting a relaxed or org-configurable ruleset (for example an
  `ORG-<NNNN>` id pattern) for files under `specs/org/` — this spec
  adopts full exclusion of that path from upstream validation, not a
  parallel, relaxed validation contract for org content.
- Documenting or mandating that org overlays conform to the upstream
  four-digit numbering convention — this spec explicitly rejects that
  path.
- The generic `markdownlint "**/*.md" ...` job in
  `.github/workflows/build.yml` (a distinct tool and a distinct job from
  `lint-specs`), including its current lack of a `docs/org` exclusion —
  a pre-existing, unrelated situation for a different linter.
- Any change to `.crewrig/core-paths.txt`'s existing classification of
  `specs/org` as `excluded` — that classification already exists and is
  not altered by this spec.
- Validating, constraining, or backfilling the content, structure, or
  numbering scheme an adopting organization chooses for its own files
  under `specs/org/` — org-owned content remains org-governed.
- Any change to `docs/spec-format.md`'s normative frontmatter or body
  schema for upstream `specs/<NNNN>-*.md` files.

## Open questions

None. The generic-vs-hardcoded exclusion mechanism was resolved at the
SPECS-stage validation gate: Requirement 5 mandates deriving the
exclusion from `.crewrig/core-paths.txt`'s `excluded` classification.
