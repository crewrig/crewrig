# Step 1: preflight

## 1. Preflight — check CI status

Before reading the diff, query the CI state for the PR:

```bash
gh pr checks <number> --repo <owner/repo>
```

Classify each required check as **pass**, **fail**, or **pending**.

- A **failing** required check is a hard blocker. Do not post `APPROVE`
  or any "LGTM" framing while any required check is failing — the
  editorial diff review is moot until CI is green. The verdict in this
  case is `REQUEST_CHANGES` (or `COMMENT` if the failure is clearly
  unrelated infrastructure flake, in which case say so explicitly and
  cite the failing job).
- A **pending** required check means the review is premature. Either
  wait for completion, or post `COMMENT` and state plainly that the
  verdict is deferred until CI resolves.
- All required checks **passing** clears the preflight; proceed to
  step 2.

The CI status MUST be surfaced explicitly in the final verdict body
(pass / fail / pending, with the failing job name when applicable).
A silent skip of this section is a protocol violation: a failing
required job overrides any editorial LGTM, and the reader of the
review needs to see that signal in writing.

**Never waived by the bound.** On a seat's second and later passes the
mandatory reading narrows (step 3), but the CI state of the artifact's
current head stays inside it on every pass. There is no pass on which
this preflight is skippable.

**Iteration-label self-heal.** Before minting any finding identifier (the
`i<N>-F<M>` / `s<N>-F<M>` scheme defined in *Finding class taxonomy*
below), check whether the pull request carries any label matching
`iter:N`:

```bash
gh pr view <number> --repo <owner/repo> --json labels --jq '.labels[].name' | grep -E '^iter:[0-9]+$'
```

- If no `iter:N` label is present, apply `iter:1` yourself before
  proceeding: `gh pr edit <number> --repo <owner/repo> --add-label
  "iter:1"`. This backstops the orchestrator's own labeling step in
  `docs/retroactive-loop.md` → *REVIEW launch trigger* — this skill's
  own identifier-minting scheme depends on the label, so it must never
  be missing when this skill runs.
- If an `iter:N` label is already present, leave it untouched and
  derive every finding identifier this pass mints from its `<N>` value.
- If the `gh pr edit --add-label` call itself fails (missing label
  definition, permission denial, connectivity error), state the
  failure explicitly in the verdict's CI status section rather than
  silently proceeding as if `iter:1` had been applied — do not mint
  finding identifiers under an assumed `N` in that case.
- This check runs on **every** pass against a given PR, not only a
  seat's first pass — the bound in step 3 narrows re-examination of
  file content, never this label check.
