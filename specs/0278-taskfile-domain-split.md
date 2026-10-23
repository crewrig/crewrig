---
id: "0278"
slug: taskfile-domain-split
status: approved
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 1764
version: 1.0.0
---

# Taskfile domain split

## Intent

Today the root `Taskfile.yml` is an 802-line file holding all 129 tasks of every domain, and it is a merge-conflict hot spot (54 of the 706 commits since 2026-08-01 touch it). After this spec, the root file is a thin entry point that names the domain files under `taskfiles/`, each domain owns its tasks, and every task keeps its exact name, description and behaviour: a developer, a CI job or an adopter running `task <name>` sees no difference. The change also removes a hidden hazard: about twenty scripts and tests read the root file directly and would silently pass on an empty root, so every one of them must see the whole task tree through a single shared reader, and a guard must keep it that way. This is work package WP-T (#1764) of epic #1761; it must land before WP-B (#1763), which adds `ci:*` tasks, and is independent of #1762.

## Requirements

1. **R1 (thin root).** The root `Taskfile.yml` SHALL contain only `version`, the global `vars`, `includes` and the single task `default`. The global `vars` (`GEMINI_HOME`, `REPO_DIR`, `E2E_IMG_PREFIX`, `E2E_DOCKER_DIR`, `E2E_VERSIONS_LOCK`) SHALL stay in the root with unchanged values. `default` SHALL stay `task --list`. Acceptance: the guard of R13 finds no task in the root other than `default`.
2. **R2 (domain files).** The tasks SHALL live in these files under `taskfiles/`, split by domain and never by CLI, so that all four CLIs sit side by side in the same file and an asymmetry between them stays visible: `setup.yml`, `mempalace.yml`, `usage.yml`, `extensions.yml`, `components.yml`, `lint.yml`, `spec.yml`, `governance.yml`, `harness.yml`, `e2e.yml`, `cli-matrix.yml`, and `ci.yml`. The mapping table of R3 is normative for which task goes where; the PLAN MAY split a file further but SHALL NOT merge a domain back into the root.
3. **R3 (mapping, exactly one file per task).** Each of the 129 baseline tasks SHALL be defined in exactly one file, as follows. The file column also states the include form (R5). Acceptance: the loader of R9 reports, for each task, the defining file named here, and the sum of the counts is 129.

   | File | Include form | Tasks (count) |
   |---|---|---|
   | `Taskfile.yml` | root | `default` (1) |
   | `taskfiles/setup.yml` | flatten | `setup-gemini-interactive`, `setup-antigravity-interactive`, `setup-claude-interactive`, `setup-copilot-interactive`, `install-mempalace`, `install-deps`, `import-claude-history`, `import-gemini-history`, `import-antigravity-history`, `import-copilot-history`, `setup:playwright-mcp`, `test-playwright-mcp` (12) |
   | `taskfiles/mempalace.yml` | namespace `mempalace` | `mempalace:doctor`, `:switch-http`, `:rotate-token`, `:status`, `:repair`, `:stop`, `:uninstall-daemon` (7) |
   | `taskfiles/usage.yml` | namespace `usage` | `usage:query`, `:price`, `:task`, `:attribute`, `:prune`, `:inventory`, `:mirror`, `:drain`, `:backfill`, `:dashboard`, `:dashboard:serve`, `:dashboard:report` (12) |
   | `taskfiles/extensions.yml` | flatten | every `install-*`, `link-*`, `unlink-*` task of the workspace, component, extension, Gemini, Claude, Copilot and Antigravity families except `install-mempalace` and `install-deps`; `install-extension-all`; `package`, `package-extension`, `create-extension`, `migrate-extension`; `build-claude-plugin`, `build-copilot-plugin`, `build-antigravity-extension` (33) |
   | `taskfiles/components.yml` | flatten | `build-components`, `build-components-claude`, `build-components-gemini`, `build-components-copilot`, `build-components-antigravity`, `check-components`, `test-components` (7) |
   | `taskfiles/lint.yml` | flatten | `lint-bootstrap`, `lint-markdown`, `fix-markdown`, `ratchet`, `host-safety`, `lint-ts`, `typecheck-ts`, `erasable-ts`, `oxlint-ts`, `format-ts`, `format-ts:fix` (11) |
   | `taskfiles/spec.yml` | namespace `spec` | `spec:lint`, `spec:derive-status`, `spec:view` (3) |
   | `taskfiles/governance.yml` | flatten | the 14 `check-*` tasks (`check-skill-versions`, `check-description-length`, `check-comment-size`, `check-seat-brief`, `check-plan-review`, `check-feedback-routing`, `check-extension-provenance`, `check-extension-version-bump`, `check-extension-manifest-version`, `check-model-mappings`, `check-agent-profiles`, `check-taskfile-commands`, `check-metadata-keys`, `check-claude-agent-layout`); `skill:check`; `ticket-pickup`, `test-ticket-pickup`; `timing-budget`; `test-runtime-foundations`, `test-windows-hook-probe`; `test-derive-spec-status`, `test-spec-view` (22) |
   | `taskfiles/harness.yml` | flatten | `harness-curate`, `test-harness-curate`, `prune-transcripts` (3) |
   | `taskfiles/e2e.yml` | namespace `e2e` | `e2e:build`, `:build:base`, `:build:claude`, `:build:gemini`, `:build:copilot`, `:build:mempalace`, `:lock`, `:auth:claude`, `:auth:gemini`, `:auth:copilot`, `:auth:ollama`, `:test`, `:test:scenario`, `:test:cli`, `:report` (15) |
   | `taskfiles/cli-matrix.yml` | namespace `cli-matrix` | `cli-matrix:build`, `:check`, `:row` (3) |
   | `taskfiles/ci.yml` | namespace `ci` | none (0), see R4 |

   Refinements of the issue's proposed layout, each forced by the real task list: the unprefixed `test-*` suites of a namespaced domain (`test-spec-view`, `test-derive-spec-status`) cannot sit in that domain's file, because a namespaced include would rename them (R5), so they go to `governance.yml` beside the other CI-mirror suites; `ticket-pickup`, `test-ticket-pickup`, `timing-budget`, `test-runtime-foundations`, `test-windows-hook-probe` and `skill:check` are repository controls, not setup or lint, and go to `governance.yml`; `install-mempalace` is unprefixed and an installer, so it goes to `setup.yml`, not `mempalace.yml`; `usage:backfill` is `usage`-prefixed and goes to `usage.yml` although it sits among the history imports today; `package*` and the `build-*-plugin` / `build-antigravity-extension` tasks go to `extensions.yml` because they produce the installable extension of one CLI each; `test-playwright-mcp` follows `setup:playwright-mcp`; `prune-transcripts` follows `harness-curate`.
4. **R4 (reserved CI file).** `taskfiles/ci.yml` SHALL exist as a valid, empty skeleton (`tasks: {}`), included under the namespace `ci`, reserved for WP-B (#1763). It SHALL load without error and add no task to `task --list-all`. Acceptance: verified on Task 3.39.0 and 3.54.0, and the guard of R13 accepts it as reachable.

5. **R5 (no rename).** Every task name, description, alias and summary SHALL be unchanged. Groups already carrying a prefix (`mempalace:`, `usage:`, `e2e:`, `spec:`, `cli-matrix:`) SHALL be included as namespaces of the same name; unprefixed tasks SHALL be included with `flatten: true`. Literal-colon names inside unprefixed groups (`setup:playwright-mcp`, `skill:check`, `format-ts:fix`) SHALL remain literal names in a flattened file, and nested names inside a namespace (`e2e:auth:claude`, `usage:dashboard:report`) SHALL be preserved. No task SHALL gain or lose an alias.
6. **R6 (name-set invariant).** The set of `(name, desc)` pairs reported by `task --list-all --json` after the split SHALL equal the baseline set (129 names), compared as sorted sets, because Task's display order depends on how a task is included and raw ordering is not part of the contract. Acceptance: a committed test compares the sorted pairs with a committed baseline fixture generated from the pre-split tree.
7. **R7 (uniqueness).** Two included files declaring the same task name MUST remain a hard Task error; the split SHALL NOT work around it with `excludes:` or `aliases:`. Acceptance: the PLAN records the "Found multiple tasks" error as the enforcement and the guard of R13 does not duplicate it.

8. **R8 (floor in the files).** Every Taskfile, root and included, SHALL declare the same `version: '3.39'`. Task 3.39.0 (2024-09-07) is the first release that ships `flatten:` (and fixes a panic on a flattened file declaring `default`); Task 3.38.0 silently ignores `flatten:` and silently renames every flattened task to `<include-key>:<name>` with exit 0, so a floor stated only in prose is not enough. With this declaration, a Task older than 3.39 fails loudly (`Schema version (3.39.0) is greater than the current version of Task`), and an included file whose version string differs from the root fails with `Taskfiles versions should match`. CI keeps installing Task unpinned and needs no change. The floor SHALL be documented in the README prerequisites table row for Task and in `DEVELOPMENT.md`. Acceptance: the guard of R13 asserts the uniform string; a manual check on Task 3.38.0 fails loudly and on 3.39.0 and 3.54.0 lists the 129 names.

9. **R9 (working directory and variables).** An included task SHALL run with the repository root as its working directory, including when `task` is invoked from a subdirectory (Task changes to the root Taskfile's directory), so no `dir:` is added on any include. Root `vars` SHALL be visible in every included file. `REPO_DIR` SHALL keep its current definition (`{{.PWD}}`) and therefore its current value. `{{.TASKFILE_DIR}}` becomes the `taskfiles/` directory inside an included file while `{{.ROOT_DIR}}` stays the repository root, so an included file SHALL NOT use `TASKFILE_DIR` to build a repository path; it SHALL keep using `REPO_DIR` or relative paths. Acceptance: one task from every domain file, including one from a flattened file and one from a namespaced file, runs from the repository root and from a subdirectory with the same effective `REPO_DIR` as before the split.

10. **R10 (include-aware loader).** A shared module (suggested path `scripts/lib/taskfile-tree.ts`, the PLAN decides) SHALL read the root Taskfile and follow `includes:` recursively, supporting namespace and `flatten` includes, nested includes, the string and the object form of an include, and relative `taskfile:` paths. It SHALL return every task with its effective name, its defining file and its raw definition, and SHALL expose the list of every Taskfile path of the tree, so that a fixture builder can copy them all. It SHALL fail with a named error on an unreadable or unparsable file, never return a partial tree. It SHALL NOT shell out to `task`. Acceptance: unit tests on committed fixtures cover each include form, a nested include, a flatten inside a namespace, a missing file and a cycle.

11. **R11 (every direct reader migrates).** Every script that reads `Taskfile.yml` directly SHALL be migrated to the loader or, where it only needs a path, to the loader's file list. Inventory (from `git grep -l 'Taskfile.yml' -- scripts`, 22 files) with classification by what the consumer does with the file; the PLAN re-verifies each entry before editing and the classification below is by the access pattern at the cited line:

    | Class | Consumers | What changes |
    |---|---|---|
    | Parses YAML | `scripts/lib/taskfile-commands.ts` (via `scripts/check-taskfile-commands.ts`, which reads the root text at line 32), `scripts/tests/tls-delegation-contract.test.ts` | Read through the loader and scan every task of the tree; the reported task name is the effective name, so entries of `scripts/lib/taskfile-command-exemptions.json` keep matching |
    | Regex or line scan on the text | `scripts/tests/e2e-report.test.ts`, `e2e-taskfile-surface.test.ts`, `install-extension-all-real.test.ts`, `setup-hint-strings.test.ts`, `spec-view.test.ts`, `check-comment-size-ci-wiring.test.ts`, `check-plan-review-ci-wiring.test.ts`, `check-seat-brief-ci-wiring.test.ts`, `scripts/tests/lib/tier-taskfile.ts` (and its user `tier-resolution-taskfile.test.ts`) | Move to the loader's per-task view (effective name, defining file, raw definition); the line scanner of `tier-taskfile.ts`, which finds a task by a two-space-indented key, SHALL be replaced, not extended |
    | Copies the file into a fixture tree | `scripts/tests/lib/tier-fixtures.ts`, `scripts/tests/lib/oracle-ts-runner.ts` (`stageTemplate`), `scripts/tests/install-oracle-mutation.test.ts` (rewrites an entry in the staged copy), `scripts/tests/check-taskfile-commands.test.ts` (writes its own root into a `mkdtemp` tree) | Copy the root and the whole `taskfiles/` tree, using the loader's file list; a rewrite targets the file that defines the task, found through the loader |
    | Lists the file as a path in a sweep or a staging step | `scripts/tests/callers-sweep.test.ts`, `install-references.test.ts`, `setup-references.test.ts`, `scripts/tests/lib/harness-curator-callers.ts` (a required substring in `Taskfile.yml`), `scripts/tests/tier-resolution-landing.test.ts` (`git add`) | Replace the single path by the root plus `taskfiles/*.yml` (from the loader's list); a required substring is checked in the file that now defines the task |
    | Spawns `task` | none observed in the inventory | The PLAN re-checks; any such consumer needs no change except the test fixtures it builds |

    Acceptance: after the migration, `git grep -n '"Taskfile.yml"' -- scripts` returns only the allow-list of R13.

12. **R12 (non-script references).** The following SHALL be checked and updated in the same PR: `.crewrig/core-paths.txt` and `docs/layers.md` (`taskfiles/**` is a core-layer path with the `strict` class of the root file, following the core-paths manifest co-maintenance rule of `AGENTS.md`, so that `scripts/sync-from-upstream.ts` ships it to adopters); `docker/e2e/mempalace.Dockerfile` (a comment citing `install-mempalace` in `Taskfile.yml`, to cite `taskfiles/setup.yml`); `.github/workflows/build.yml`, `ci/ci-capabilities.yml` and `.gitlab-ci.yml` (R17). `.gitlab-ci.yml` is generated by `scripts/build-ci.ts` and SHALL be regenerated, never hand-edited. No setup or installer script copies the root Taskfile to an adopter outside the core-paths sync (a `git grep` of `scripts/` finds none); the PLAN re-confirms this.

13. **R13 (guard).** A guard script (suggested path `scripts/check-taskfile-tree.ts`, name is the PLAN's call) SHALL exit non-zero and name the offender when: (a) a `taskfiles/*.yml` file is not reachable from the root `includes`; (b) a file under `scripts/` other than the allow-list reads the root `Taskfile.yml` directly (the allow-list names the loader, the guard, and the fixtures that legitimately need the root, each with a one-line reason); (c) the root holds any task other than `default`; (d) any Taskfile of the tree has a `version` other than the uniform floor of R8; (e) an included file uses `TASKFILE_DIR` for a repository path; (f) a `deps:` entry or a `- task:` call does not resolve to a task of the tree from the namespace of the file that contains it (R20). It SHALL exit 0 on the post-split tree.
14. **R14 (non-vacuity).** The guard SHALL also compare the set of effective task names of the loader with the set of names reported by `task --list-all --json` and fail on any difference. When the `task` binary is absent it SHALL print an explicit notice that this comparison was skipped and exit on the other checks; it SHALL never skip silently. CI installs Task, so the comparison runs there.
15. **R15 (mutation proof).** Tests SHALL prove, on a staged copy: a forbidden utility (for example `jq`) planted in a flattened included file and in a namespaced included file each makes `check-taskfile-commands` fail (spec 0266 R13); an unincluded `taskfiles/foo.yml` fails the guard; a test source that reads the root file directly fails the guard; a version string differing from the floor fails the guard. Every mutation SHALL operate only on paths the test created with `mkdtemp`, and SHALL NOT remove or restore a path it did not create (host-safety rule, `scripts/check-host-safety.ts`).

16. **R16 (CI wiring).** The guard and every new or changed test SHALL be wired into CI in `.github/workflows/build.yml` and `ci/ci-capabilities.yml`, with `.gitlab-ci.yml` regenerated by `scripts/build-ci.ts`, and `check-ci-parity` SHALL pass. A task or CI job that calls `task ...` SHALL pass unchanged.
17. **R17 (path filters).** Every `paths:` filter that lists `Taskfile.yml` SHALL also list `taskfiles/**`. These are: in `ci/ci-capabilities.yml`, the pull-request and push triggers of `skill-scripts-ts`, `extension-render` and `check-taskfile-commands` (six filters); in `.github/workflows/build.yml`, the same three jobs (three filters at the lines the generator emits); in `.gitlab-ci.yml`, the six regenerated occurrences. The PLAN SHALL re-grep for `Taskfile.yml` in the three files and treat any other hit as in scope. The CI job description of `check-taskfile-commands` ("Check Taskfile.yml names ...") SHALL name the tree, not the single file.
18. **R18 (docs).** Documentation that describes `Taskfile.yml` SHALL be updated where it states a present-tense fact, and left alone where it is historical. Must change: `AGENTS.md` (CLI Matrix Maintenance summary: "CLI-prefixed `Taskfile.yml`/`.gitignore` entry" becomes "CLI-prefixed `taskfiles/**`/`.gitignore` entry"), `docs/cli-matrix-maintenance.md` (lines naming the CLI-prefixed `Taskfile.yml` entry), `docs/layers.md`, `README.md` (the Task prerequisites row and the repository tree line), `DEVELOPMENT.md` (the Task floor, and a short section describing the layout and the add-a-task rule), `CONTRIBUTING.md` if it names the file, `docs/cli-matrix/adding-a-cli.md` (checklist item 15, which tells an adopter adding a CLI to register tasks in `Taskfile.yml`: it becomes the matching `taskfiles/*.yml` domain files), and the cli-matrix row sources that cite the file as a source of truth (`docs/cli-matrix/rows/16.md`, `7g-2.md`, `21.md`), with `docs/cli-matrix.md` rebuilt in the same diff. Historical, left alone: `specs/`, `docs/audit/`, accepted ADRs, and rows that name only a task, not the file (`docs/cli-matrix/rows/36.md`).
19. **R19 (observable behaviour unchanged).** `task` with no argument SHALL still list the tasks; `task --list` and `task --list-all` SHALL show the same names and descriptions as before; every `task <name>` invocation in `.github/workflows/build.yml`, `ci/ci-capabilities.yml`, the docs and the scripts SHALL resolve to the same task as before.

20. **R20 (cross-references).** Task resolves the name in a `deps:` entry or a `- task:` call relative to the namespace of the file that contains it (verified on Task 3.54.0: inside the `e2e` namespace, `deps: [e2e:base]` fails with `Task "e2e:e2e:base" does not exist`, `deps: [base]` works, and `:hello` reaches an unprefixed task of the root namespace; from a flattened file, a full namespaced name such as `e2e:base` works; a shell `task <name>` inside a `cmd:` text always uses the full global name). Moving a task verbatim would therefore break every such reference at run time, and only when that task is run. The split SHALL rewrite exactly these references, and nothing else in a task body: inside a namespaced file, a reference to a task of the same namespace is written namespace-relative (`e2e:build:base` becomes `build:base` in `taskfiles/e2e.yml`, which today affects the six `- task:` calls of `e2e:build` (five `e2e:build:*` tasks and `e2e:lock`) and the four `e2e:build:*` `deps:` entries), a reference to a task outside the namespace is root-anchored with a leading `:`; in a flattened file a reference keeps its full global name; a shell `task <name>` text is left untouched. Acceptance: the guard check (f) of R13 resolves every reference of the tree from its file's namespace and fails on a dangling one, and a test runs one task of each reference kind (relative, root-anchored, flattened-to-namespaced) successfully.

## Scenarios

**Scenario:** the task surface is unchanged

Given the baseline `task --list-all --json` captured before the split (129 names)
When the same command runs on the split tree
Then the sorted `(name, desc)` pairs are identical and the root file defines only `default`

**Scenario:** an included task runs from a subdirectory

Given a task of a flattened file (for example `check-seat-brief`) and a task of a namespaced file (for example `spec:lint`)
When each is run from the repository root and from `scripts/`
Then each runs with the repository root as its working directory and the same `REPO_DIR` as before the split

**Scenario:** a forbidden utility in an included file is caught

Given a staged copy of the tree where `jq` is planted in a task of `taskfiles/lint.yml` (flattened) and in a task of `taskfiles/usage.yml` (namespaced)
When `check-taskfile-commands` runs on the copy
Then it fails naming the effective task and the command, once for each plant

**Scenario:** an unincluded domain file is rejected

Given a staged copy where `taskfiles/foo.yml` exists but is not in the root `includes`
When the guard runs
Then it fails naming `taskfiles/foo.yml` as unreachable

**Scenario:** a consumer reading the root directly is rejected

Given a staged copy where a test under `scripts/tests/` reads `Taskfile.yml` and is not in the allow-list
When the guard runs
Then it fails naming that file

**Scenario:** a namespaced file keeps a working cross-reference

Given `taskfiles/e2e.yml` where `e2e:build:claude` depends on `e2e:build:base`
When the guard resolves the references of the tree
Then the dependency is written `build:base` inside the file and resolves, and a dependency written `e2e:build:base` there fails the guard as unresolved

**Scenario:** an old Task fails loudly

Given Task 3.38.0 and the split tree
When any `task` command runs
Then it exits non-zero with `Schema version (3.39.0) is greater than the current version of Task`, and no task is silently renamed

**Scenario:** two flattened files define the same name

Given two flattened files that both define `check-x`
When Task loads the tree
Then it fails with `Found multiple tasks (check-x)` and no task runs

## Out of scope

- Renaming any task, or moving an unprefixed group to a namespace; if ever done, it goes through `aliases:` and a deprecation cycle.
- Any `ci:*` task, `check:pre-push`, or content for `taskfiles/ci.yml` (#1763, WP-B); one task per CI job (WP-C).
- Any change to a CI job's engine logic beyond the path filters and the new guard wiring.
- The spec linter and the `build.yml` pull-request types (#1762, a parallel work package).
- Changing the semantics of `REPO_DIR` (`{{.PWD}}` is the invoking directory, so a `task` run from a subdirectory yields a subdirectory `REPO_DIR`; this quirk is pre-existing and unchanged).
- Pinning a Task version in CI, or changing `install.sh`.
- Rewriting the body of any task other than the task references of R20; the split moves definitions verbatim, comments included.

### Risks

| Risk | Mitigation |
|---|---|
| A consumer still reads the root and passes vacuously | R11 migrates all 22 files; R13(b) fails on any new direct reader; R14 proves the loader sees every task Task sees |
| An old Task silently renames flattened tasks | R8: uniform `version: '3.39'` makes it fail loudly; R13(d) guards the string |
| A name collision between two flattened files | Task's own hard error (R7); R6 catches any lost or duplicated name |
| Display order of `--list-all` changes and a test compares raw order | R6 compares sorted sets; no test may rely on raw order |
| The Windows rule (spec 0266 R13) stops covering moved tasks | R11 reads every included task; R15 plants `jq` in a flattened and a namespaced file |
| A fixture tree misses `taskfiles/` and a copied suite runs on an empty root | R11 copies the loader's whole file list; R15 proves the staged copy still fails on a planted utility |
| Merge-conflict churn with #1762 and #1763 | #1762 does not touch the Taskfile; #1763 starts from `taskfiles/ci.yml` (R4); the split lands first as one PR |
| A `deps:` or `task:` reference inside a namespaced file stops resolving (Task resolves it relative to the namespace; it fails only when that task runs) | R20 rewrites the references and R13(f) resolves every reference of the tree statically |

### Alternatives considered

- **Split by CLI.** Rejected: it hides asymmetry between the four CLIs, which `AGENTS.md` prohibits, and spreads one domain (for example `install-*`) over four files.
- **Rename to namespaces with `aliases:` (for example `extensions:install-claude-component`).** Rejected for this ticket: a rename touches every doc, CI job, script and muscle memory at once; the owner decision is stable names, and a rename belongs to a later ticket with a deprecation cycle.
- **`includes` with `dir:` on each include.** Rejected: included tasks already run from the root, so `dir:` adds a field per include that can drift and changes nothing observable.
- **Keep the monolith and add a linter.** Rejected: it leaves the 802-line conflict hot spot and gives WP-B and WP-C a growing file to extend.
- **A generated Taskfile (built from fragments).** Rejected: a build step and a committed artefact for what Task's `includes` does natively, and a drift check to maintain.
- **A docs-only version floor.** Rejected: Task 3.38.0 exits 0 while renaming every flattened task, so only a floor enforced by the files themselves (R8) turns a silent break into a loud one.

## Open questions

- None blocking. The PLAN confirms one point of mechanism: that the `.crewrig/core-paths.txt` manifest accepts a directory or glob entry for `taskfiles/**` in the form `scripts/sync-from-upstream.ts` reads.
