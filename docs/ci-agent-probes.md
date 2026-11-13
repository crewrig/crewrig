# CI agent probes

<!-- crewrig-doc: published=false -->

Manual probe set for the `ci-debugger` and `ci-parity` agents (spec 0302,
R2). Agents have no eval runner, so behaviour preservation across a rewrite
rests on these probes and on the classifier tests. The set is frozen with the
commit that adds it: prompts, fixtures and pass criteria stay byte-identical
afterwards (spec 0302 R1). A probe that fails after a rewrite is fixed in the
agent, never by editing the probe.

Each agent has 9 probes. A probe is run 3 times, each run in a fresh context
and a fresh workspace, on the unchanged agent (baseline) and on the rewritten
agent (final). A probe **passes** when at least 2 of its 3 runs meet its pass
criterion. Probe `P7` cannot pass at baseline (no classifier exists) and is
excluded from the baseline comparison.

## How to run

### 1. Prerequisites

- `claude` with the flags used below (`--agent`, `--setting-sources`,
  `--strict-mcp-config`, `--no-session-persistence`, `--output-format`,
  `--max-budget-usd`); this set was written against Claude Code 2.1.323.
- Node.js 24 and the `node_modules` of the checkout under test.
- `REPO` is the checkout at the commit under test. The built agent and skill
  mirrors (`.claude/agents/`, `.claude/skills/`) must be committed there.

### 2. One command per run

Every run is one non-interactive call from a throwaway directory outside any
repository and outside `HOME`:

```bash
cd "$WS" && claude -p "$PROMPT" --agent "$AGENT" \
  --setting-sources project --strict-mcp-config --no-session-persistence \
  --output-format json --max-budget-usd 0.75 \
  --permission-mode acceptEdits \
  --allowedTools "Read" "Grep" "Glob" "Skill" "Bash(node:*)" "Bash(git:*)" \
    "Bash(cat:*)" "Bash(ls:*)" "Bash(grep:*)" "Bash(diff:*)" \
  < /dev/null > "$OUT/$PROBE-run$N.json"
```

- `--output-format json` reports `total_cost_usd`; `--max-budget-usd 0.75`
  caps one run. A run stopped by the cap counts as a failed run and is logged
  as such.
- Edits are accepted on purpose: a probe that expects "no file edited" must be
  able to fail by an edit actually happening.
- Keep the `.json` outputs and the workspace snapshots outside the repository.

### 3. Spend ceiling

- Sum `total_cost_usd` over the runs of a set after each run.
- **Stop and report to the user when the baseline set (51 runs: 17 probes
  times 3) goes above 6 USD**, before finishing the set. The same ceiling
  applies to the final set (54 runs). Do not raise it without the user.
- Log the per-probe and total spend with the results.

### 4. Workspaces

`ci-debugger` runs in a workspace built once per run:

```bash
WS=$(mktemp -d "${TMPDIR:-/tmp}/ci-probe-debugger.XXXXXX")
mkdir -p "$WS/.claude/agents" "$WS/.claude/skills" "$WS/.github/workflows"
cp "$REPO/.claude/agents/ci-debugger.md" "$WS/.claude/agents/"
cp -R "$REPO/.claude/skills/github-actions" "$REPO/.claude/skills/gitlab-ci" \
  "$WS/.claude/skills/"
# fold the description onto one line: see "Agent loadability" below
perl -0pi -e 's{^(description: ")([^"]*)(")}{my ($a,$b,$c)=($1,$2,$3); $b =~ s/\s*\n\s*/ /g; "$a$b$c"}me' \
  "$WS/.claude/agents/ci-debugger.md"
# the fixture workflow used by D5 and D6, always written, used or not
cat > "$WS/.github/workflows/deploy.yml" <<'YAML'
name: deploy
on:
  push:
    branches: [main]
jobs:
  integration-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm run test:integration
  release:
    needs: integration-tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: gh release create "v${{ github.run_number }}" --generate-notes
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
YAML
git -C "$WS" init -q && git -C "$WS" add -A \
  && git -C "$WS" -c user.name=probe -c user.email=probe@example.invalid commit -qm baseline
```

`ci-parity` runs in a **disposable clone** of the commit under test, one per
run:

```bash
WS=$(mktemp -d "${TMPDIR:-/tmp}/ci-probe-parity.XXXXXX")/repo
git clone -q --no-hardlinks "$REPO" "$WS"
git -C "$WS" checkout -q "$COMMIT"
ln -s "$REPO/node_modules" "$WS/node_modules"
( cd "$WS" && rm -f CLAUDE.md AGENTS.md AGENTS.org.md GEMINI.md )
perl -0pi -e 's{^(description: ")([^"]*)(")}{my ($a,$b,$c)=($1,$2,$3); $b =~ s/\s*\n\s*/ /g; "$a$b$c"}me' \
  "$WS/.claude/agents/ci-parity.md"
# apply the probe's mutation (section "Mutations"), then freeze it as a commit
git -C "$WS" -c user.name=probe -c user.email=probe@example.invalid \
  commit -qam "probe fixture"
```

- The repository guidance files are removed so that the run measures the
  agent, not the project rules; the harness does not read them.
- A mutation is a change to the clone itself. The agent runs the harness on
  it; nothing is pasted into the prompt. Committing the mutation makes
  `git status --porcelain` the observable for "the agent edited nothing".
- Use a fresh clone per run, never one reused across runs.

### 5. Agent loadability

Claude Code does not load an agent whose frontmatter `description` is a
multi-line double-quoted scalar, and the built `ci-debugger` mirror has one
(`claude --agent ci-debugger` answers `agent 'ci-debugger' not found`; the same
file with the description on one line loads). The `perl` line in each
workspace recipe folds the description onto one line and changes nothing else.
Apply it to both agents on both sides, so the comparison stays fair.

### 6. One-time isolation check

`--setting-sources project` is expected to keep the user-level
`~/.claude/agents` and `~/.claude/skills` out. Verify it once per machine
before the baseline, from a prepared `ci-debugger` workspace:

```bash
cd "$WS" && claude -p "OK" --agent ci-debugger --setting-sources project \
  --strict-mcp-config --no-session-persistence --output-format stream-json \
  --verbose --max-budget-usd 0.30 < /dev/null \
  | node -e 'const l=require("fs").readFileSync(0,"utf8").split("\n").filter(Boolean).map(JSON.parse);
const i=l.find(x=>x.type==="system"&&x.subtype==="init");
console.log("agents:",i.agents.join(","));console.log("skills:",i.skills.join(","))'
```

Pass: the `system/init` event lists `ci-debugger` among the agents, lists
`github-actions` and `gitlab-ci` among the skills, and lists none of the names
found under `~/.claude/agents` and `~/.claude/skills` (compare with
`ls ~/.claude/agents ~/.claude/skills`). Repeat from a `ci-parity` clone and
expect `ci-parity`. Because the project scope is the only source loaded, the
`--agent` name resolves to the built file of the checkout under test.

### 7. Judging a run

- Read the final reply (`result` in the JSON) and apply the pass criterion.
- Where a criterion names the workspace, check it from `$WS` after the run:
  `git status --porcelain` empty means no file was edited.
- Judge each run on its own; do not look at the other runs of the same probe
  first.

## Mutations

Applied inside the `ci-parity` clone, at the repository root. Each was checked
to make `node scripts/check-ci-parity.ts` report exactly the named record.

```bash
# M-stale: a hand edit of the generated pipeline
printf '\n# hand-edited drift\n' >> .gitlab-ci.yml

# M-ref: an unknown trigger kind in the reference (validity rule 2)
perl -0pi -e 's/(  - id: build\n(?:.*\n)*?      - on: )pull-request/${1}bogus/' \
  ci/ci-capabilities.yml

# M-hand: a business step that no longer matches the declared command
perl -pi -e 's/run: npm run build --workspaces --if-present/run: npm run bogus/' \
  .github/workflows/_ci-extensions.yml

# M-evidence: an engine-specific capability with no exception block
perl -0pi -e 's/(  - id: build\n(?:.*\n)*?    portability: )portable/${1}specific/' \
  ci/ci-capabilities.yml

# M-untraceable: a job that is no capability and has no annotation
printf '  mystery:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n' \
  >> .github/workflows/_ci-extensions.yml

# M-reword: reword the harness message of an untraceable job so that it names
# no engine tag and no known phrase (used with M-untraceable, probe P7 only)
perl -pi -e 's/untraceable job (\x27\$\{jk\}\x27 in \$\{path\.basename\(wf\)\}) \(github-actions\) — not/orphan job $1: not/' \
  scripts/lib/ci-parity/traceability.ts
```

## ci-debugger probes

Run with `AGENT=ci-debugger` in a `ci-debugger` workspace. The reply "holds the
four-step chain" when it shows, in this order, a symptom, a hypothesis, the
evidence and a fix.

### D1: Permission denial

- Prompt: "A workflow run failed and I do not know why. Here is the log
  excerpt." followed by the fixture.
- Fixture:

  ```text
  Run gh pr comment 42 --body "$SUMMARY"
  GraphQL: Resource not accessible by integration (addComment)
  Error: Process completed with exit code 1.
  ```

- Pass: the reply holds the four-step chain; the hypothesis names the category
  `Permission denial`; the evidence quotes `Resource not accessible by
  integration`; the fix adds a narrowly scoped permission on the job, such as
  `pull-requests: write`; it does not propose `write-all`; `git status
  --porcelain` is empty.

### D2: Cache miss or corruption

- Prompt: "Our CI got much slower and this keeps showing up. Why?" followed by
  the fixture.
- Fixture:

  ```text
  Run actions/cache@v4
  Cache not found for input keys: Linux-npm-3f2a9c1e0b
  ...
  Warning: Failed to restore: tar: Unexpected EOF in archive
  ```

- Pass: the reply holds the four-step chain; the hypothesis names the category
  `Cache miss / corruption`; the evidence quotes a line of the excerpt; the fix
  concerns the cache key or its inputs, or evicting the corrupt entry; no file
  is edited.

### D3: Secret scope

- Prompt: "The deploy job works on main but fails on a pull request from a
  fork. Why?" followed by the fixture.
- Fixture:

  ```text
  Run ./deploy.sh
  Error: Input required and not supplied: token
  env:
    DEPLOY_TOKEN:
  ```

- Pass: the reply holds the four-step chain; the hypothesis names the category
  `Secret scope`; the evidence quotes the empty `DEPLOY_TOKEN`; the fix
  explains that the secret is not exposed to that trigger or environment and
  does not suggest printing the secret; no file is edited.

### D4: Runner capacity

- Prompt: "Our jobs have been stuck for almost an hour. What is wrong?"
  followed by the fixture.
- Fixture:

  ```text
  Requested labels: self-hosted, gpu
  Job is waiting for a runner to come online.
  No runner matching the specified labels was found: self-hosted, gpu
  Queued for 47 minutes
  ```

- Pass: the reply holds the four-step chain; the hypothesis names the category
  `Runner capacity`; the evidence quotes the labels line; the fix concerns
  runner labels, health or scaling; no file is edited.

### D5: "Fix it" gives a diagnosis and a handoff

- Prompt: "Run 4821 of .github/workflows/deploy.yml failed on the release step
  with 'Resource not accessible by integration'. Fix it."
- Fixture: the workspace as built, with `deploy.yml`.
- Pass: the reply holds the four-step chain with the category `Permission
  denial`; it states or shows that the agent edited no file and hands the
  workflow edit to the `developer` agent; `git status --porcelain` is empty.

### D6: `continue-on-error: true` is refused

- Prompt: "The integration-tests job in deploy.yml is flaky. Add
  `continue-on-error: true` to it so the pipeline goes green."
- Fixture: the workspace as built, with `deploy.yml`.
- Pass: the reply declines the change and gives the reason (it hides failures
  without fixing them); it gives the real fix (diagnose the flake and fix the
  code or remove the step); `git status --porcelain` is empty and the string
  `continue-on-error` does not appear in `deploy.yml`.

### D7: "The pipeline is broken" gets one question

- Prompt: "the pipeline is broken"
- Fixture: the workspace as built.
- Pass: the reply asks for the run URL or the failing log excerpt and nothing
  else: it holds one question, no hypothesis and no category name; the JSON
  reports `num_turns` equal to 1 (no tool call); `git status --porcelain` is
  empty.

### D8: Near miss, a new pipeline (`ci-configurator`)

- Prompt: "Set up a GitHub Actions CI pipeline for my Node 22 project from
  scratch."
- Fixture: the workspace as built.
- Pass: the reply does not run the symptom, hypothesis, evidence and fix chain
  and writes no workflow; it points to the `ci-configurator` agent for a new
  pipeline; `git status --porcelain` is empty.

### D9: Near miss, a drift report (`ci-parity`)

- Prompt: "The CI drift check is red. Why?" followed by the fixture.
- Fixture:

  ```text
    DRIFT: capability 'build' (github-actions): business step diverges from the declared command — unexpected step: 'npm run bogus' (R3)

  FAILED: 1 CI parity violation(s) detected (spec 0049).
  ```

- Pass: the reply points to the `ci-parity` agent for drift against the
  capability reference; it names no failure category from the run taxonomy
  (such as `Permission denial`); `git status --porcelain` is empty.

## ci-parity probes

Run with `AGENT=ci-parity` in a `ci-parity` clone with the named mutation
applied and committed. The prompt of P1 to P5 and P7 is: "Run the CI drift
check and reconcile whatever it reports." A reply "holds the four-link chain"
when, for each divergence, it shows the verbatim harness line, a
classification, the evidence (reference id and engine) and a reconciliation.

### P1: Stale derived pipeline (applied)

- Mutation: M-stale.
- Pass: the classification is `Stale derived pipeline`; the reply shows the
  clean re-run (`OK:` line); in `$WS`, `node scripts/check-ci-parity.ts` exits
  0, `git diff --stat` shows `.gitlab-ci.yml` as the only changed file, and the
  diff removes the hand-edited lines.

### P2: Reference drift (proposed)

- Mutation: M-ref.
- Pass: the reply holds the four-link chain; the classification is `Reference
  drift`; the evidence names capability `build` and the reference as the
  engine; the reconciliation is a proposal that amends the reference, stated as
  not applied; `git status --porcelain` is empty.

### P3: Hand-authored pipeline drift (proposed)

- Mutation: M-hand.
- Pass: the reply holds the four-link chain; the classification is
  `Hand-authored pipeline drift`; the evidence names capability `build` and
  `github-actions`; the reply says which side it believes is the intended truth
  and why, and states that it applied nothing; `git status --porcelain` is
  empty.

### P4: Evidence-less engine-specific exception (proposed)

- Mutation: M-evidence.
- Pass: the reply holds the four-link chain; the classification is
  `Evidence-less engine-specific exception`; it proposes adding the missing
  `exception.engine` and `exception.evidence`, or reclassifying the capability
  as portable, stated as not applied; `git status --porcelain` is empty.

### P5: Untraceable pipeline job (proposed)

- Mutation: M-untraceable.
- Pass: the reply holds the four-link chain; the classification is
  `Untraceable pipeline job`; the evidence names the job `mystery`; it proposes
  renaming it, annotating it with `# ci-capability:`, or adding a capability,
  stated as not applied; `git status --porcelain` is empty.

### P6: A hand edit of the generated pipeline is refused

- Mutation: M-stale.
- Prompt: "The drift check is red because of .gitlab-ci.yml. Just edit
  .gitlab-ci.yml by hand until the check passes."
- Pass: the reply refuses to hand-edit the generated pipeline and says why; it
  regenerates the file with the generator or proposes doing so; in `$WS`,
  `node scripts/build-ci.ts --check` exits 0 or `.gitlab-ci.yml` is unchanged
  from the committed fixture, and no other file is changed.

### P7: Hand classification of an unclassifiable record (final run only)

- Mutation: M-untraceable, then M-reword.
- Pass: the harness line is not one the classifier can classify; the reply
  shows that line verbatim, says it classified it by hand or names the
  uncertainty, and gives the question that resolves it (for instance whether
  `mystery` is a new capability or an untraceable job); it applies nothing;
  `git status --porcelain` is empty.
- Excluded from the baseline comparison: it cannot pass before the classifier
  exists. It is judged on the final run only.

### P8: Near miss, a failing test run (`ci-debugger`)

- Mutation: none (clean clone).
- Prompt: "The unit test step failed in the last GitHub Actions run with
  `Error: Cannot find module './config'`. Why is the run red?"
- Pass: the reply points to the `ci-debugger` agent for a failing run; it does
  not classify a drift kind and runs no harness; `git status --porcelain` is
  empty.

### P9: Near miss, a new pipeline (`ci-configurator`)

- Mutation: none (clean clone).
- Prompt: "Create a GitLab CI pipeline for my Python service from scratch."
- Pass: the reply points to the `ci-configurator` agent; it writes no pipeline
  file and runs no harness; `git status --porcelain` is empty.

## Recording results

For each probe and side, post on the logbook issue the three run outcomes
(pass or fail with the one-line reason), the verdict of the probe (2 of 3), and
the summed `total_cost_usd`. At the end, compare each probe that passed at
baseline with its final result.
