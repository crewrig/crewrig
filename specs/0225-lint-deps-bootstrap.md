---
id: "0225"
slug: lint-deps-bootstrap
status: draft
complexity: small
interaction-mode: AUTO
related-issue: 1263
version: 1.0.0
---

# Lint dependency bootstrap — one-command install and actionable failures for spec-linter and markdownlint

## Intent

A person who checks out the repository fresh and runs the spec or Markdown
linter finds either a working lint pass or, when a dependency is missing, one
message telling them the exact command that installs it — never a raw
Node.js stack trace or npm's generic "could not determine executable to run"
error. A single documented command installs everything the spec and
Markdown linters need, and reports separately on `shellcheck`, which that
command cannot install itself.

## Requirements

1. The repository SHALL provide one documented, scriptable command
   (a `Taskfile.yml` target) that installs every dependency
   `scripts/lib/spec-linter.js` and the Markdown-lint `Taskfile.yml` targets
   need to run — at minimum `js-yaml`, `semver`, and `markdownlint-cli` —
   runnable unmodified from a fresh checkout with no prior local
   `node_modules`.
2. Running `scripts/lib/spec-linter.js` in a workspace where `js-yaml` or
   `semver` cannot be loaded SHALL fail with a message that names the
   missing dependency and the exact command from requirement 1, and SHALL
   NOT print a raw Node.js `MODULE_NOT_FOUND` stack trace.
3. Running `scripts/lib/spec-linter.js` in a workspace where `markdownlint-cli`
   is not resolvable, neither locally nor globally, SHALL fail with a message
   of the same shape as requirement 2 (naming the command from requirement 1)
   before any attempt to invoke `markdownlint` through `npx`, and SHALL NOT
   surface npm's "could not determine executable to run" error or attempt a
   network fetch.
4. The `lint-markdown` and `fix-markdown` targets in `Taskfile.yml` SHALL
   treat a project-local `markdownlint-cli` install (resolvable via `npx`) as
   satisfying their precondition, in addition to a global install, and their
   precondition failure message SHALL name the command from requirement 1.
5. The command from requirement 1 SHALL report whether `shellcheck` is present
   on `PATH` and, when it is absent, SHALL print an install hint, without
   itself failing or attempting to install `shellcheck` — `shellcheck` is a
   system package outside npm's reach.
6. In a workspace where every dependency above is already installed, none of
   these changes SHALL alter the pass/fail verdict or reported findings of
   `scripts/lib/spec-linter.js`, `task lint-markdown`, or `task fix-markdown`
   for any given input.

## Scenarios

**Scenario:** Fresh workspace, no dependencies installed

```text
Given a fresh checkout with no node_modules
When  a person runs `node scripts/lib/spec-linter.js specs/0001-example.md`
Then  the command fails with a message naming the missing dependency and the
      exact bootstrap command from requirement 1, and prints no raw
      Node.js stack trace
```

**Scenario:** Bootstrap then lint

```text
Given a fresh checkout with no node_modules
When  a person runs the bootstrap command from requirement 1, then runs
      `node scripts/lib/spec-linter.js specs/0001-example.md`
Then  the lint run proceeds normally (fails or passes on the file's own
      merits, not on a missing dependency)
```

**Scenario:** Node dependencies present, markdownlint-cli absent

```text
Given node_modules holds js-yaml and semver but not markdownlint-cli, and
      no global markdownlint install exists
When  a person runs `node scripts/lib/spec-linter.js specs/0001-example.md`
Then  the command fails with the same actionable message shape as
      requirement 2/3, naming the bootstrap command, and never shells out to
      `npx markdownlint`
```

**Scenario:** shellcheck absent when bootstrapping

```text
Given a machine with no shellcheck binary on PATH
When  a person runs the bootstrap command from requirement 1
Then  the command still succeeds (installing the npm-managed dependencies),
      and prints an install hint for shellcheck rather than failing
```

**Scenario:** Fully-provisioned workspace, no behavior change

```text
Given a workspace with js-yaml, semver, and markdownlint-cli already
      installed
When  a person runs `task lint-markdown`, `task fix-markdown`, and
      `node scripts/lib/spec-linter.js` against the existing spec corpus
Then  each command's pass/fail verdict and reported findings are unchanged
      from before this specification
```

## Out of scope

- Installing or vendoring a `shellcheck` binary — it stays a documented,
  reported-on system dependency (requirement 5).
- Any change to CI workflows that already provision these dependencies
  successfully (`.github/workflows/build.yml`, `ci/ci-capabilities.yml`) —
  this specification addresses the local/fresh-workspace gap only.
- Any change to markdownlint's rule configuration (`.markdownlintrc`) or to
  the spec linter's semantic validation rules.
- `artifacts/core/skills/pr-reviewer/scripts/lint-markdown.sh` and
  `lint-shell.sh` — both already degrade gracefully with an actionable,
  one-line message when their tool is absent, per the friction's own
  evidence; no code change is needed there.

## Open questions

None.

## Rationale (informative)

**Tier.** `small`: the fix is confined to one script's error handling
(`scripts/lib/spec-linter.js`), one new `Taskfile.yml` target plus two
precondition-message edits, and its regression tests in
`scripts/tests/test-spec-linter.sh`. No new abstraction, no schema, no
cross-seam design choice — the friction report's own suggested resolution is
the fix.

**Grounding observed on `main` at the branch point:**

- `package.json` already declares `js-yaml`, `semver`, and `markdownlint-cli`
  as `devDependencies` — the gap is diagnostic and a missing bootstrap entry
  point, not a missing dependency declaration.
- `scripts/lib/spec-linter.js` requires `js-yaml` and `semver` unconditionally
  at module load (lines 4-5) and shells out to `spawnSync('npx',
  ['markdownlint', ...])` (line 571) with no preflight check.
- `Taskfile.yml`'s `lint-markdown`/`fix-markdown` preconditions check
  `command -v markdownlint`, which only recognizes a global install, not the
  project-local copy `npx markdownlint` already resolves.
- `artifacts/core/skills/pr-reviewer/scripts/lint-shell.sh` and
  `lint-markdown.sh` already print `"<tool> not found — skipping"` and exit 0
  when their tool is missing — this is the actionable-degradation pattern the
  friction report asks spec-linter.js to match, not a defect in those two
  scripts themselves.
