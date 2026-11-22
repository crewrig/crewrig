---
id: "0243"
slug: usage-capture-hooks-typescript
status: approved
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 2114
version: 3.3.0
---

# Usage-capture hook and Antigravity statusline in TypeScript

*Delta 05 of `specs/0243-usage-capture-hooks-typescript.md`, cumulative on
`specs/0243-usage-capture-hooks-typescript.delta-01.md` to
`specs/0243-usage-capture-hooks-typescript.delta-04.md`. Source: ticket #2114
(WP4 of epic #1822), gate question A of its plan
(<https://github.com/crewrig/crewrig/issues/2114#issuecomment-7076951986>),
raised by review finding v1-F5
(<https://github.com/crewrig/crewrig/issues/2114#issuecomment-7076902876>).
Spec 0315 R11 makes the framework archive carry a root `package.json` with
`"type": "module"`, and its open question on the CommonJS-form hook files names
`hooks/usage-capture.ts` and `hooks/antigravity-statusline-shim.ts`. Under that
root every `.js` file below it is parsed as an ECMAScript module, and every
`.ts` file is an ECMAScript module too. Two things break, both silently,
because the entries catch every failure: the `require()` of requirement 5(a),
where `require` is not defined; and the CommonJS libraries the entries load
through `import()`, which fail with `require is not defined in ES module
scope`. The owner chose to amend 0243 (decision A) and approved the plan-level
mechanism for the second point (plan v2 step 2: tracked nested
`{"type":"commonjs"}` scope files, and the lone ECMAScript file moved out of
each such directory). This delta states that mechanism as a requirement on the
files 0243 and its usage-capture closure own. It does not change spec 0315:
R11 of 0315 fixes the content of the archive-root `package.json` only, and
adds no rule on files in subdirectories. The version is a MINOR bump: one
clause of requirement 5 is narrowed, requirements 40 and 41 are added, and
behaviour under the repository's typeless root is unchanged. No question is
left open.*

## ADDED

**Requirement 40 — The hook scripts of the archive work under every module
type.** Each hook script the framework archive ships (`hooks/usage-capture.ts`,
`hooks/antigravity-statusline-shim.ts`, `hooks/mempalace-transcript.ts`,
`hooks/worktree-git-guard.ts`) SHALL do the same work, with the same exit
status and the same streams, with no module-type error and no module-type
warning, in two layouts: the repository checkout, whose root `package.json`
has no `"type"` field; and the extracted archive, whose root `package.json`
declares `"type": "module"` (spec 0315 requirement 11), under a hostile
`package.json` in any ancestor of the version directory (declaring
`"commonjs"`, declaring `"module"`, declaring no `type`, or absent). "The same
work" is observable, because a failed `import()` does not show: the entries
catch it and exit as if there were nothing to do (reproduced on Node.js
24.13.1 under a module root, current code: `usage-capture.ts` reaches no
capture step, the shim never runs its prior command, `mempalace-transcript.ts`
never reaches its daemon call). Exit status and silence alone therefore cannot
prove it. The observables are in the scenarios below. Where no ancestor
`package.json` exists, the script takes the typeless case.

**Requirement 41 — The layout that lets the libraries load under the archive
root.** The plan of #2114 probed, on Node.js 24.0.0 and 24.13.1, under a typeless
root and a module root, with a nested CommonJS `.js` helper and an ECMAScript
`.ts` module both loaded through `import()`: 8 of 8 runs exited 0 with empty
standard error. Reaching the real libraries needs the layout below, which
spec 0315 requirement 11 leaves to the plan. Enumeration, read at
`origin/release/1822-distribution` @ `74e305d0` by walking every `import`,
`import()` and `require` specifier from each script:

| Hook script | CommonJS files it reaches | ECMAScript files it reaches |
|---|---|---|
| `usage-capture.ts`, `antigravity-statusline-shim.ts` | all `.js` under `scripts/lib/usage-capture/` (including `adapters/`) and `scripts/lib/usage-store/` (including `validator/`, which holds the vendored `ajv-formats-formats.js`) | `scripts/lib/usage-capture/hook-run.ts`, `scripts/lib/tmp-file.ts` |
| `mempalace-transcript.ts` | `scripts/lib/usage-store/mcp.js`, through `daemon.ts` and `token.ts` | `scripts/lib/mempalace-transcript/*.ts`, `scripts/lib/worktree-claim/*.ts`, `scripts/lib/tls-env*.ts` |
| `worktree-git-guard.ts` | none | `scripts/lib/worktree-claim/*.ts`, `scripts/lib/paths.ts` |

The layout SHALL be the following, in the repository and in the archive (the
archive carries the same files at the same paths, as 0288 requires of the
manifest):

- (a) a tracked file `package.json` whose content is the single member
  `"type": "commonjs"` in `scripts/lib/usage-capture/` and in
  `scripts/lib/usage-store/`. Their subdirectories inherit it. No other scope
  file is added by this delta;
- (b) no file with ECMAScript syntax beneath either directory. The two that
  exist move out: `scripts/lib/usage-capture/hook-run.ts` to
  `scripts/lib/usage-hook/hook-run.ts`, and
  `scripts/lib/usage-store/inventory.ts` to
  `scripts/lib/usage-inventory/inventory.ts`, with every importer updated: the
  two entries, the moved files' own relative specifiers
  (`./index.js`, `./mcp.js`, `./layout.js` and the like), the inventory
  command, and the tests that name them. The two target directories hold no
  scope file and take the archive root's module type, as `tmp-file.ts` does;
- (c) a test, run in CI on Linux and `windows-latest`, walks the same
  specifier closure from each hook script the archive ships and fails unless
  every reached `.js` file that has CommonJS syntax resolves, in the archive
  layout, to a nearest `package.json` declaring `"commonjs"`, and every
  reached file with `import`/`export` syntax resolves to the archive root
  (`"module"`). Removing a scope file, or putting an ECMAScript file back in a
  scoped directory, SHALL make it fail;
- (d) the archive SHALL contain the two scope files and the moved files, since
  its manifest ships tracked files only and the closure test of spec 0315
  requirement 10 walks the same set.

The checkout is unaffected: its root stays typeless, the `.js` files under the
two directories are already CommonJS, and a `commonjs` scope changes nothing
for them. The existing hook suites SHALL pass unchanged apart from the moved
paths. The scope files are not a change to the mechanism of requirement 5
(a) to (c), which adds no file for the entries themselves.

## MODIFIED

Requirement 5(a) — the access to `node:` built-ins and to the CommonJS helper.
Original (the clause of `specs/0243-usage-capture-hooks-typescript.md`,
requirement 5, quoted as it reads there):

> (a) each entry file carries no module syntax — no top-level `import` or
> `export` — so Node.js loads it as CommonJS and prints no
> `MODULE_TYPELESS_PACKAGE_JSON` warning for it, reaching `node:` built-ins with
> `require()` and everything else with a dynamic `import()`, and declaring
> nothing at global scope;

Replacement:

> (a) each entry file carries no module syntax — no top-level `import` or
> `export` — so that under the typeless root Node.js loads it as CommonJS and
> prints no `MODULE_TYPELESS_PACKAGE_JSON` warning for it, reaching `node:`
> built-ins with `process.getBuiltinModule("node:<name>")` (cast, so the typed
> lint rules hold) and everything else, the CommonJS helper
> `scripts/lib/usage-capture/cursor.js` included, with a dynamic `import()`,
> never with `require()`, and declaring nothing at global scope; the entry file
> relies on no CommonJS-only binding (`require`, `module`, `exports`,
> `__filename`, `__dirname`), so that it also runs where its nearest
> `package.json` makes Node.js load it as an ECMAScript module (requirements
> 40 and 41);

Requirement 5 is otherwise unchanged: the mechanism parts (b) and (c) (the
first statement removes the `warning` listeners, before the first lazy
`import()`), the exit-zero and silence contract, the rejected alternatives and
the blast-radius statement stand as written. The rejected alternative of
`"type": "module"` in the repository's root `package.json`, or in `scripts/lib/`
or `hooks/`, still holds: the archive root of spec 0315 is a different tree, and
the scope files of requirement 41 declare `"commonjs"`, which re-scopes nothing.
The sentence "it changes no tracked file" justifies the entry-file mechanism of
requirement 5 only.

**Scenario:** The usage-capture entries do their work from the archive, under every hostile ancestor

Given the archive built by the release builder from its manifest and extracted
under a version directory, so that its root `package.json` is the module root
of spec 0315 requirement 11 and the files of requirement 41 are present, with
the real `hook-run.ts`, not a stub
And an ancestor of the version directory whose `package.json` declares
`"commonjs"`, then `"module"`, then no `type`, then is absent
And Node.js 24.0.0 and the current Node.js 24 release, started with no flag and
no environment variable, and `CREWRIG_USAGE_ROOT` naming an empty temporary
directory
When `usage-capture.ts claude-code Stop` runs with the payload of a Claude Code
transcript fixture that has no stamp, and then runs again with the same payload
And the shim runs with a marker file naming a prior status-line command that
prints a known line
Then every run exits zero and writes zero bytes to standard error
And the first `usage-capture.ts` run wrote the journal records of that
transcript and its stamp under the usage root, the second wrote no new record
(the stamp is current, the capture graph is not loaded), and the shim printed
the prior command's known line.

**Scenario:** The same entries on the checkout keep their behaviour

Given the repository checkout, whose root `package.json` has no `"type"` field
When the previous scenario's runs are repeated there, and the scenarios "A
healthy run is silent on an unmodified Node.js" and "A Windows-style escaped
path takes the fast path" of the original spec run
Then they pass unchanged, with the same records, and no
`MODULE_TYPELESS_PACKAGE_JSON` warning is printed for an entry file.

**Scenario:** The old form is detected, not only forbidden

Given an edit to `hooks/usage-capture.ts` or
`hooks/antigravity-statusline-shim.ts` that reaches a built-in or `cursor.js`
with `require(...)`, or reads `__filename`, or a missing scope file of
requirement 41(a), or an ECMAScript file put back under `scripts/lib/usage-capture/`
When the archive scenario above runs
Then the entry still exits zero with empty streams, but no journal record is
written (and the shim does not print the prior command's line), so the
scenario fails, and the closure test of requirement 41(c) fails too.

**Scenario:** The transcript hook reaches its daemon call from the archive

Given the extracted archive of the first scenario, an ancestor of each of its
four types, and `MEMPALACE_TRANSCRIPT_ENABLED=1` with a `HOME` that holds no
daemon token file
When `mempalace-transcript.ts claude-code` runs with the payload
`{"hook_event_name":"UserPromptSubmit","prompt":"hello"}`
Then it exits zero and writes to standard error the two lines it writes in the
checkout (`DAEMON_UNREACHABLE: token file not found at …` and
`mempalace-transcript: FAILED to persist user-prompt (rc=4):` followed by a space). Both lines
reach standard error only if `daemon.ts` and `token.ts` loaded
`scripts/lib/usage-store/mcp.js`. The silent exit of the module-root run
without the scope files is the failure this scenario detects.

**Scenario:** The worktree guard decides from the archive

Given the extracted archive of the first scenario, an ancestor of each of its
four types, and a git repository with a ticket worktree under `.worktrees/T-1`
When `worktree-git-guard.ts claude` receives a payload whose command is
`git reset --hard` and whose `cwd` is that worktree, first with no claim
directory for `T-1`, then with one
Then the first run exits 1 with the refusal line on standard error and the
second exits 0 with no output, the same as in the checkout. The second
result is the one a failed `import()` of `claim-state.ts` cannot give, since
the guard refuses once it has identified the ticket and the import fails.

**What the implementation changes.** The built-in and helper accesses in the
two entry files (`hooks/usage-capture.ts` lines 33 to 37 and
`hooks/antigravity-statusline-shim.ts` lines 31 to 35), and their header
comments. The two scope files and the two file moves of requirement 41, with the
importers. In `scripts/tests/hook-entry-form.test.ts`: a static assertion that
the two entry files contain no `require`, `module`, `exports`, `__filename` or
`__dirname` outside the comments (the static assertion alone is not the proof;
the behavioural observables above are); the specifier scan of the test *the
entries and the runner import only node: built-ins or repository files* extended
to `process.getBuiltinModule("node:…")` calls, so the no-third-party rule keeps
covering them. The archive scenarios and the closure test of requirement 41(c)
are new tests, wired into the CI registration that carries the tests of spec
0315.

**What stays unchanged.** Requirement 5 apart from its clause (a); requirements
1 to 4 and 6 to 39; the `hooks/*.json` fragments and the installed command
lines of requirement 16; the content of every `.js` file under
`scripts/lib/usage-capture/` and `scripts/lib/usage-store/`; the root
`package.json` of the repository and the content fixed by spec 0315
requirement 11 for the archive root; the behaviour of every hook on every
payload in the checkout. `hooks/mempalace-transcript.ts` and
`hooks/worktree-git-guard.ts` need no edit of their own: the first needs the
`usage-store` scope of requirement 41(a), the second reaches ECMAScript files
only.

## REMOVED

Nothing is removed.
