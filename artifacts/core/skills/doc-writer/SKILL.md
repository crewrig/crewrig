---
name: doc-writer
description: "Writes and updates project documentation for a named reader: ADRs (numbered by a bundled script and checked for shape), READMEs, in-code docstrings that state the contract, and reference docs, preferring text that lives next to the code. Use when asked to write or update a README, an ADR, docstrings or reference docs, when a public contract (CLI flags, API surface, config schema) changed and the docs no longer match, or when an architect recommendation must be recorded as an ADR. Not for PR descriptions, commit messages, inline code comments, implementation plans, specs with requirements and scenarios (spec-author), or design alternatives (architect)."
type: skill
license: Apache-2.0
compatibility: "Requires Node.js 24 (scripts run as node scripts/<name>.ts)."
metadata:
  provenance:
    canonical: "${CANONICAL_REPO}"
    feedback: "${CANONICAL_REPO}"
    version: "1.2.0"
claude:
  allowed-tools:
    - Read
    - Write
    - Edit
    - Grep
    - Glob
    - Bash
  user-invocable: true
---

# Documentation Writer

Writes documentation that survives the first refactor, for the reader who
will actually open it. A document with no named reader goes unread, and a
document that drifts from the code is worse than none.

## When to activate

- The user asks for a README, an ADR, an architecture document or reference
  material, or for docstrings that state a contract.
- A change shifts a public contract (CLI flags, API surface, config schema)
  and the existing docs no longer match.
- The architect skill produced a recommendation that warrants an ADR.
- A new module lacks a top-of-file docstring that its role needs.

When the user asks for one of these, do not write the file: say why, say where the
text belongs (for a recap, the pull request description) and offer to draft it
there instead. The cases:

- A recap of what you just did. It belongs in the pull request description,
  where reviewers look; a standalone recap is read once and then rots.
- A comment that says *what* the code does. The code already says it.
- Documentation nobody asked for, written to look thorough.

## Scripts

Run `node <skill-dir>/scripts/<name>.ts` from the repository; add `--json` for a
machine-readable result. Each exits `0` (ok), `1` (finding), `2` (usage error) or
`3` (precondition failed: unreadable directory, template or file).

| When | Command | Exit `1` means |
|---|---|---|
| Starting an ADR | `node scripts/new-adr.ts --title "<the decision>"` (`--dir <path>` when ADRs are not in `docs/adr`; `--status Accepted` for an already settled decision; `--dry-run` to preview) | Empty title, a title with no letter or digit, an unknown status, a target that already exists, or no free number. Fix the input and rerun. |
| After filling an ADR | `node scripts/lint-adr.ts <file>` | A rule is broken: heading, section order, status value, a leftover placeholder, a missing consequence bullet. Fix the ADR and rerun until clean. A Context over five sentences is a warning: tighten it or accept it knowingly. |

`new-adr.ts` takes the next number from the files in the local directory, so it
cannot see a number reserved on another branch or in an open pull request. Check
the open pull requests for the same number before keeping it, and renumber if it
is taken.

`lint-adr.ts` is a tool for the ADR you are writing, not a repository gate: older
ADRs of a project may use other layouts and would fail it, so run it on your own
file only.

Exit `2` or `3` means the call or the environment is wrong, not the document.

## Operating mode

### 1. Identify the reader

Name the reader before writing, and match length and tone to them:

- **Future maintainer**: knows the codebase, needs the *why* and the invariants.
  Short, dense.
- **Onboarding contributor**: new to the codebase, needs the *what* and how to
  run it. Longer, with examples.
- **External integrator**: has no repository access, needs only the contract.
  API-doc style.
- **Reviewer of an architecture decision**: needs context, the decision and its
  consequences. ADR style.

### 2. ADRs

Run `new-adr.ts`, then fill the four sections it laid out:

- **Context**: what forces this decision now (a constraint, a deadline, an
  incident, drift), in three to five sentences. If it needs more, the decision
  is not crisp enough to record.
- **Decision**: one paragraph, declarative voice.
- **Consequences**: a positive, a negative and a neutral bullet. Be honest about
  the negative one: it is what the next reader needs most.
- **Status**: Proposed, Accepted, Deprecated, or `Superseded by ADR-NNNN`.

Take every fact from what the user told you, the code or the repository. A reason
you cannot source is left out, not invented: a record with a made-up rationale
misleads the next reader more than a short one.

Number ADRs in sequence. Never rewrite an accepted ADR: its value is that it
records what was decided and why at the time. To reverse it, write a new ADR that
names the one it supersedes, then change only the Status line of the old one, to
`Superseded by ADR-NNNN`; its body and decision text stay word for word.
Then run `lint-adr.ts` on the new file.

### 3. READMEs

Order sections by the reader's priority, and skip those that do not apply:

1. A one-sentence pitch: what the project does, for whom.
2. Quick start: three commands that produce a visible result.
3. Install and prerequisites, with exact versions where they matter.
4. Usage: the two or three most common workflows.
5. Reference: links to deeper docs, not inline copies.
6. Contributing: a link to `AGENTS.md` or `CONTRIBUTING.md`.
7. License: one line.

A README that ends at section 3 because the project needs nothing more is
correct. Take every fact from the project; an invented command or option is
worse than a gap.

### 4. In-code docstrings

At the top of a module, one paragraph stating its role and the invariant it
enforces; skip it when the name already says so. For a function, state the
contract: pre-conditions, post-conditions, side effects, error modes. Do not
restate parameter types the language encodes, and do not paraphrase the name.

```python
def transfer(amount, from_acct, to_acct):
    """Move `amount` from `from_acct` to `to_acct` atomically.

    Raises InsufficientFunds if `from_acct` balance < amount.
    Side effect: emits a `transfer.completed` event on success.
    """
```

### 5. Aging well

Before finishing, ask what in the document will be wrong in six months. Anything
that can live next to the code, where it ages with the code, should: a
standalone document that drifts silently misleads its readers.

## Output expectations

- Markdown with a proper heading hierarchy, no skipped levels.
- Prose wrapped near 80 characters; code and tables are not wrapped.
- Internal links by relative path, external links with the full URL.
- No emoji in body text unless the project's convention uses them.

## Friction

See `references/shared-friction-reporting.md`.
