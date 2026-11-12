# Output contract

The skill writes exactly one new file, `specs/<NNNN>-<slug>.md`, in the format of
`docs/spec-format.md`. That document is normative; on any conflict it wins. The
bundled script writes the frontmatter and the headings, so the work left to you
is the content.

## Frontmatter

| Field | Source |
|---|---|
| `id` | Secured by the script, a quoted string. Never computed by hand. |
| `slug` | Kebab-case, ASCII, 40 characters at most, generated from the intent. The filename slug and the frontmatter slug match exactly. |
| `status` | `draft` on first write. |
| `complexity` | From the user (INTERMEDIATE, FULL) or your own judgement (AUTO, MINIMAL). |
| `interaction-mode` | The mode you run in, written explicitly to lock the choice. |
| `related-issue` | The issue the skill is invoked against. |
| `version` | `1.0.0`. |
| `max-iterations`, `superseded-by` | Omitted. |
| `unsecured-id` | Present as `unsecured-id: true` only when the script reported an unsecured id. Do not remove it: a maintainer secures the id and removes it before merge. |

## Status and the spec-PR

`status` is `draft` on first write and flips to `approved` in the spec-PR's own
commit. The later `approved` to `implemented` transition belongs to the
implementation team's `pr-logbook`, folded into the implementation PR: do not
open a separate metadata-only PR for it.

Open the spec-PR as a Draft (`gh pr create --draft`, `glab mr create --draft`).
After the approval flip is committed and pushed, mark it ready (`gh pr ready`,
`glab mr update --ready`), wait for the CI run that the ready transition
creates, and only then merge. The per-forge procedure is in
`docs/spec-pr-workflow.md` under *Draft-PR procedure*.

## Body sections

All five sections are present, in this order, with the headings verbatim:

1. `## Intent`: one paragraph, no HOW words (`by`, `via`, `using`, technology names).
2. `## Requirements`: a numbered list, every line uses SHALL or MUST.
3. `## Scenarios`: at least one happy path and one failure path, in Given/When/Then form.
4. `## Out of scope`: bullets; empty only for the `trivial` tier.
5. `## Open questions`: bullets; may be empty.

An empty section is tolerated in a draft, but when content is derivable leave
none empty: the spec reviewer flags it.

## Delta-spec mode

When the ticket already has a parent spec, the file is
`specs/<NNNN>-<slug>.delta-<NN>.md` and its body is the three sections
`## ADDED`, `## MODIFIED` and `## REMOVED`, all present even when empty. The
script writes the skeleton from `--delta --parent <NNNN>`; quote the original
line under `MODIFIED` and `REMOVED`.

## Self-validation

Before handing over, run the spec linter on the drafted file and fix what it
reports (CrewRig repository: `task spec:lint -- specs/<NNNN>-<slug>.md`). It
replaces a manual re-read of the format, so open `docs/spec-format.md` only when
the linter output needs it. Elsewhere, re-read the draft against that
repository's spec format.
