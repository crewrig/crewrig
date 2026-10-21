# Step 3: fetch the diff and metadata

## 3. Fetch the PR diff and metadata

```bash
gh pr diff <number>
gh pr view <number> --json title,body,files,headRefName,baseRefName,labels
```

Identify linked issues by parsing the body (`Fixes #N`, `Closes #N`,
`Refs #N`) and fetch each: `gh issue view <N>`.

**From the seat's second pass onward, the mandatory reading is bounded**
(`docs/reviewer-seat.md` → *Bounded scope from the second pass*) to:

- the change since the revision the seat last examined — the brief's
  `examined` key names it; `gh pr diff <number> --name-only` and
  `git diff <last-examined-sha>..<head>` give you the increment;
- the seat's ledger comment (`docs/reviewer-seat.md` → *Seat ledger*),
  cross-checked against the seat's own non-void verdicts, which win on any
  disagreement; the verdict history is the fallback, not the default read;
- the disposition record of the seat's prior findings (the brief's
  `disposition` key);
- the continuous-integration state of the current head (step 1, never
  waived);
- every surface that change reaches — a surface it newly touches, a
  surface a prior finding's remedy touches, and a surface whose invariant
  it depends on even where that surface's own text is unchanged.

**The bound removes re-examination only. It removes no item from this
skill's checklist** for the surfaces in scope: a file inside the bound is
reviewed to the same standard as on a first pass. On a first pass, and on
a vacant seat, nothing is bounded — read the whole artifact.
