### 1. Preflight — check CI status

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

#### Waiting on a pending check

A `run_in_background` task or the `Monitor` tool's completion signal is
a hint, never proof. Both watch a process from outside the check
itself, and either can report "done" while the check the forge actually
tracks is still pending, still queued, or has since been re-triggered.
Treat either signal as a cue to look, not as the look itself.

Whenever a required check was observed `pending` at any point during
the current review pass, the last thing done before composing the
verdict — no matter how that wait was carried out — is one direct,
synchronous query of the check's live state: `gh pr checks <number>` or
the equivalent `gh api repos/<owner>/<repo>/commits/<sha>/check-runs`
call. A verdict is never written off a background or monitor signal
alone; the direct query is what the CI status section actually reports.

The recommended way to wait in the first place is a foreground bounded
retry loop — fixed attempt count, fixed inter-attempt delay, run
synchronously in the reviewer's own turn — rather than a background
task or a live monitor, because the loop's own exit condition already
*is* the direct query:

```bash
for i in $(seq 1 10); do
  gh pr checks <number> --repo <owner/repo>
  rc=$?
  [ "$rc" -ne 8 ] && break   # anything but "still pending" ends the wait
  sleep 30
done
```

`gh pr checks` exits `8` specifically for "checks pending"; any other
exit code — `0` (all passing) or a non-zero, non-`8` failure — means the
checks have already resolved, one way or the other, and the wait is
over. Whether the loop ends by resolving or by exhausting its attempts,
what happens next is unchanged: the R2 direct, synchronous query above
is what actually determines the check's bucket (`pass`, `fail`, or
`pending`). Never assume a bucket from the loop's exit alone — a
required check that failed throughout the wait window must not be
reported as still pending.

A non-`8` exit is not automatically a resolved-failing check, though:
`gh help exit-codes` documents that any command failure — network
hiccup, timeout, rate-limit — also returns the same generic exit `1`
as a genuine check failure, so the loop alone cannot tell the two
apart. The R2 direct, synchronous query is what disambiguates them,
because it must cite an actual named check and its status; if that
final query itself comes back as a bare connection error rather than
a named check/status, treat it as a cue to retry the query, not as
grounds to report the check failed or pending.

### 2. Read the project conventions

Open `AGENTS.md` at the repo root (or the project's equivalent) and
note:

- The commit-message convention (Gitmoji, Conventional Commits, …).
- The required PR body sections.
- The logbook label and where logbook issues live.
- The version-bump rule for skills and agents (if any).
- Branch-naming and merge-method rules.

Different projects have different rules. Do not assume.

### 3. Fetch the PR diff and metadata

```bash
gh pr diff <number>
gh pr view <number> --json title,body,files,headRefName,baseRefName,labels
```

Identify linked issues by parsing the body (`Fixes #N`, `Closes #N`,
`Refs #N`) and fetch each: `gh issue view <N>`.

**From the seat's second pass onward, the mandatory reading is bounded**
(`docs/reviewer-seat.md` → *Bounded scope from the second pass*) to:

- the change since the revision the seat last examined — the brief names
  it; `gh pr diff <number> --name-only` and
  `git diff <last-examined-sha>..<head>` give you the increment;
- the disposition record of the seat's prior findings;
- the continuous-integration state of the current head (step 1, never
  waived);
- every surface that change reaches — a surface it newly touches, a
  surface a prior finding's remedy touches, and a surface whose invariant
  it depends on even where that surface's own text is unchanged.

**The bound removes re-examination only. It removes no item from this
skill's checklist** for the surfaces in scope: a file inside the bound is
reviewed to the same standard as on a first pass. On a first pass, and on
a vacant seat, nothing is bounded — read the whole artifact.

### 4. Run the bundled linter scripts

Select scripts based on file extensions in the changed-files list, then
invoke each with the matching subset of paths. Capture stdout and exit
code; treat exit 0 as no findings, exit 1 as findings present.

`lint-typescript.ts` is invoked through Node, from the repository root
so it finds the repository's `.oxlintrc.json`, `.oxfmtrc.json` and
`node_modules/.bin`: `node lint-typescript.ts <changed *.ts files>`. It
needs Node >= 24 (unflagged type stripping). On an older Node the
interpreter fails before the script's own degrade path can run, so
treat a non-zero exit that printed no `lint-typescript:` line — or a
Node version below 24 — as "tool unavailable, skipped", never as a
finding. The real Node floor guard is owned by sub-spec A2 (#1324).

See *Scripts* below for the full table.

### 5. Compose the structured review

The verdict opens with the seat line:
`seat: <surface>/<ticket>[#<generation>]`. Its exact placement depends on
which transport step 6 selects, so take it from
`docs/reviewer-seat.md` → *The seat line, and where it goes* rather than
deriving it here.

**From the seat's second pass onward, a prior-finding audit is the
verdict's first section**, before any new finding. It states, per finding
identifier in the seat's dossier, whether this pass accepts the recorded
disposition. A prior finding this pass judges unaddressed **prevents an
approving verdict**. When the seat is vacant, that section instead records
the vacancy and its cause.

Then five sections, in this order:

- **CI status** — pass / fail / pending for each required check
  (from step 1). When any required check is failing or pending, this
  section drives the verdict; do not bury it.
- **Correctness** — does the code do what the PR claims? Cite the file
  path and line range for each claim.
- **Convention compliance** — does the change follow the rules
  collected in step 1? Cite the rule and the offending location.
- **Test coverage** — are the changes covered? If tests were added,
  do they actually exercise the new behavior? Cite test file paths.
- **Linter findings** — one subsection per script that produced
  output. Quote the script's stdout verbatim; do not paraphrase.

Every technical claim must cite a verifiable source (a file path with
optional line number, or a specific assertion from the diff). If you
cannot cite, write "see diff" or omit the claim. See *Grounding
discipline* below.

### 6. Post the review

Forge access is CLI-only (`AGENTS.md` → *Forge Access*): the framework
ships no forge MCP server. Post the verdict through `gh`, following the
ordered fallback ladder below. **Resolve the posting identity first**, so
you know which rung applies *before* attempting to post rather than
discovering a rejection reactively:

```bash
gh api user --jq .login                                # authenticated identity
gh pr view <number> --json author --jq .author.login   # PR author
```

1. **Distinct identities** — the authenticated login differs from the PR
   author. Post a formal review with the matching event:

   ```bash
   gh pr review <number> --approve            # or --request-changes / --comment
   ```

2. **Shared identity** — the authenticated login equals the PR author (the
   common solo-maintainer case). GitHub rejects `--approve` and
   `--request-changes` on your own PR (`Can not approve/request changes on
   your own pull request`), and even the `--comment` *review event* can trip
   a self-approval permission guard. Do **not** attempt any review-type
   event. Post a **plain** comment instead, whose body opens with a
   `## Verdict: …` header:

   ```bash
   gh pr comment <number> --body "## Verdict: APPROVE

   <the five review sections from step 5>"
   ```

   Use `## Verdict: APPROVE`, `## Verdict: REQUEST CHANGES`, or
   `## Verdict: COMMENT`. This plain comment is the canonical, binding
   verdict artifact for the shared-identity case. (Use `gh issue comment`
   instead if the verdict is being recorded on the anchoring issue rather
   than the PR.)

3. **Posting denied** — if even the plain comment is refused (e.g. a
   stricter permission classifier), do **NOT** ask the orchestrator to post
   the review on your behalf: that launders a permission you were denied.
   Return the full verdict and findings to the orchestrator, which records
   them in the logbook issue.

The three events map as follows:

- `APPROVE` — no blocking issues; minor nits welcome but not required.
- `REQUEST_CHANGES` — at least one finding that must be fixed before
  merge.
- `COMMENT` — observations without a verdict (e.g. when the diff is
  outside the reviewer's domain).

