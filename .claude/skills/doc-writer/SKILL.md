---
name: doc-writer
description: "Documentation skill for ADRs, READMEs, in-code docstrings, and reference material. Activate when the user asks for documentation, when a public contract changes without docs, or when an ADR is needed per the architect skill's output. Optimized for documents that age well."
license: Apache-2.0
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
user-invocable: true
metadata:
  provenance:
    canonical: "https://github.com/crewrig/crewrig"
    feedback: "https://github.com/crewrig/crewrig"
    version: "1.1.2"
---


# Documentation Writer

A skill for writing documentation that survives the first refactor.
Bias toward documents the next reader will actually read.

## When to activate

- The user asks for a README, ADR, architecture doc, or in-code
  reference.
- A change shifts a public contract (CLI flags, API surface, config
  schema) and the existing docs no longer match.
- The architect skill produced a recommendation that warrants an ADR.
- A new module or component lacks a top-of-file docstring.

Do not activate for:

- Trailing summaries of "what I just did" — those belong in the PR
  body, not in standalone docs.
- Inline comments about *what* the code does — code already does that.
- Documentation that nobody asked for, just to look thorough.

## Operating mode

### 1. Identify the reader

Documents written for an unspecified reader become unread. Before
writing, name the reader concretely:

- **Future maintainer** — knows the codebase, needs the *why* and the
  invariants. Short, dense.
- **Onboarding contributor** — new to the codebase, needs the *what*
  and the *how to run it*. Longer, with examples.
- **External integrator** — does not have repo access, needs only the
  contract. API-doc style.
- **Reviewer of an architecture decision** — needs context, the
  decision, and the consequences. ADR style.

Match the doc's length and tone to the reader. A README for an
external integrator and a README for a maintainer are not the same doc.

### 2. ADRs

Standard sections:

```markdown
# ADR-NNNN: <decision>

## Status
<Proposed | Accepted | Deprecated | Superseded by ADR-MMMM>

## Context
<What forces this decision now? Constraint, deadline, incident, drift.
Three to five sentences. If you cannot fit the context in five
sentences, the decision is not crisp enough to record.>

## Decision
<One paragraph: what was decided, in declarative voice.>

## Consequences
- Positive: <what improves>
- Negative: <what worsens or constrains future moves>
- Neutral: <changes that are neither good nor bad but matter>
```

Number ADRs sequentially. Never edit an accepted ADR — supersede it
with a new one and update the Status line of the old one.

### 3. READMEs

Section order, in priority:

1. **One-sentence pitch** — what the project does, for whom.
2. **Quick start** — three commands that produce a visible result.
3. **Install / prerequisites** — exact versions where it matters.
4. **Usage** — the two or three most common workflows.
5. **Reference** — links to deeper docs, not inline.
6. **Contributing** — link to `AGENTS.md` or `CONTRIBUTING.md`.
7. **License** — one line.

Skip sections that do not apply. A README that ends on section 3
because the project genuinely needs nothing more is correct.

### 4. In-code docstrings

Module / file top-of-file: one paragraph stating the module's role
and the invariant it enforces, if any. Skip if obvious from the name.

Function / method docstrings: state the contract — pre-conditions,
post-conditions, side effects, error modes. Do not restate the
parameter types if the language already encodes them. Do not
paraphrase the function name.

```python
def transfer(amount, from_acct, to_acct):
    """Move `amount` from `from_acct` to `to_acct` atomically.

    Raises InsufficientFunds if `from_acct` balance < amount.
    Side effect: emits a `transfer.completed` event on success.
    """
```

### 5. Aging well

Before committing the doc, ask:

- What in this doc will be wrong in six months?
- Could that part live closer to the code (where it ages with the
  code) instead of in this doc?

If the answer is yes, prefer in-code docs over a standalone document.
Standalone docs that drift silently are worse than no docs.

## Output expectations

- Markdown, with proper heading hierarchy (no skipped levels).
- Line wrap to ~80 characters for prose; do not wrap code or tables.
- Internal links by relative path; external links with full URL.
- No emoji in body text unless the project's convention uses them.

## Friction reporting

When a recognition signal fires (see `config/TOOLS.md` →
*Friction Reporting → Recognition signals*), invoke the
`harness-report` skill rather than reimplementing the protocol
inline. The reporter walks you through identifying the offender,
picking the room, and filling the payload.
