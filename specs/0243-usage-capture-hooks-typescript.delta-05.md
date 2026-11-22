---
id: "0243"
slug: usage-capture-hooks-typescript
status: draft
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
root the files load as ECMAScript modules, where `require` is not defined, so
the `require()` of requirement 5(a) fails, silently, because the entries catch
it. The owner chose to amend 0243 R5(a)
(decision A), rather than keep the departure out of the spec. The version is a
MINOR bump: the entry-form rule is narrowed in one clause, behaviour under the
repository's typeless root is unchanged, and no requirement the shipped
implementation satisfies is invalidated. No question is left open.*

## ADDED

**Requirement 40 — The entry files run under any ancestor module type.** The
plan of #2114 probed the form below on Node.js 24.0.0 and 24.13.1, under a
typeless root and under a `"type": "module"` root, with a nested CommonJS `.js`
helper and an ECMAScript `.ts` module both loaded through `import()`. All 8
runs exited 0 with 0 bytes on standard error. The current `require()` form,
under the `module` root, fails, but silently: in both entry files the
`require()` calls sit in a `try` whose `catch` swallows the `ReferenceError`
(`require is not defined`), so the hook exits 0 with empty streams and does
nothing (reproduced on Node.js 24.13.1: `usage-capture.ts` never reaches its
capture step, and the shim never runs its prior command). Exit status and
silence therefore cannot tell the fixed form from the broken one, and the
observables below decide. Each hook entry file that requirement 5(a) governs
SHALL exit zero and write zero bytes to standard output and standard error, on
every Node.js 24 release, and SHALL do its work, whichever `"type"` the nearest ancestor `package.json` of the entry file
declares: no `"type"` field (the repository root), `"commonjs"`, or `"module"`
(the archive root of spec 0315 requirement 11), the CommonJS helpers under
`scripts/lib/` sitting in their own `"type": "commonjs"` scope as in the archive
layout. Where no ancestor
`package.json` exists, the entry file takes the typeless case. The entry files
are `hooks/usage-capture.ts` and `hooks/antigravity-statusline-shim.ts`, which
the framework archive ships. Doing its work means, under each ancestor case:
`usage-capture.ts` consults `cursor.js` (a payload whose stamp is current ends
without loading the capture module graph; one whose stamp is absent loads it and
reaches the capture step), and the shim runs the prior status-line command
recorded in its marker file and then reaches the capture step.
`hooks/mempalace-transcript.ts` and
`hooks/worktree-git-guard.ts` also ship in the archive; they call no
`require()` and reach their repository modules through `import()`, so this
requirement is already met by them and changes nothing in them. It binds, by reuse, the entry of every later hook row, as
requirement 5 already does.

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
> `__filename`, `__dirname`), so that it also runs where an ancestor
> `package.json` makes Node.js load it as an ECMAScript module (requirement
> 40);

Requirement 5 is otherwise unchanged: the mechanism parts (b) and (c) (the
first statement removes the `warning` listeners, before the first lazy
`import()`), the exit-zero and silence contract, the rejected alternatives and
the blast-radius statement stand as written. One consequence is noted, not
re-decided: the rejected alternative of `"type": "module"` in the root
`package.json` still holds for the repository root. The archive root of spec
0315 requirement 11 is a different tree and does not re-scope the tracked
files of this repository.

**Scenario:** The usage-capture entries do their work under a typeless, a commonjs and a module ancestor

Given a copy of `hooks/usage-capture.ts` and `hooks/antigravity-statusline-shim.ts`
with the files they load, with a capture step that records its call (a stub
`hook-run.ts` that writes a marker file, or the real one writing into a
temporary usage root), placed beneath an ancestor `package.json` that has no
`"type"` field, then one that declares `"type": "commonjs"`, then one that
declares `"type": "module"`
And Node.js 24.0.0 and the current Node.js 24 release, started with no flag and
no environment variable
When `usage-capture.ts claude-code Stop` runs with a payload whose transcript
has no stamp, then with a payload whose stamp is current, and the shim runs
with a marker file naming a prior status-line command that prints a known line
Then every run exits zero and writes zero bytes to standard error, in all three
ancestor cases and on both releases
And for the absent stamp the capture step is reached (the marker file exists),
for the current stamp it is not (the capture graph is never loaded), and the
shim prints the prior command's line and reaches the capture step.

**Scenario:** An entry that cannot reach its helper under a module ancestor is detected

Given an edit to `hooks/usage-capture.ts` or
`hooks/antigravity-statusline-shim.ts` that reaches a built-in or `cursor.js`
with `require(...)`, or reads `__filename`
When the hook tests run under the `"type": "module"` ancestor
Then the entry still exits zero with empty streams, but the capture step is not
reached for the absent stamp (and the shim does not print the prior command's
line), so the observable of the scenario above fails, and the static test of
the entry form fails too.

**Scenario:** The other two shipped hooks load and answer under a module ancestor

Given copies of `hooks/worktree-git-guard.ts` and `hooks/mempalace-transcript.ts`
with the files they load, beneath an ancestor `package.json` of each of the
three types above, on Node.js 24.0.0 and the current release
When the guard receives an allowed non-Antigravity command, and the transcript
hook receives a non-Antigravity payload with its kill-switch set
Then each exits zero with the stream content it produces beneath the typeless
ancestor (no output for these inputs). Their other contracts (the
`{"decision": "ask"}` and `{}` answers for Antigravity, the exit status 1 of a
`MissingDependencyError`) are not restated here.

**Scenario:** The typeless root keeps its behaviour

Given the repository's root `package.json` with no `"type"` field
When the scenarios "A healthy run is silent on an unmodified Node.js" and "A
Windows-style escaped path takes the fast path" of the original spec run
Then they pass unchanged, and no `MODULE_TYPELESS_PACKAGE_JSON` warning is
printed for an entry file.

**What the implementation changes.** The built-in accesses in the two entry
files (`hooks/usage-capture.ts` lines 33 to 37 and
`hooks/antigravity-statusline-shim.ts` lines 31 to 35), including the helper
`cursor.js`, whose `require()` becomes an `import()`. In
`scripts/tests/hook-entry-form.test.ts`: a static assertion that the two entry
files contain no `require`, `module`, `exports`, `__filename` or `__dirname`
outside the comments (the static assertion alone is not the proof: the
behavioural observable above is); the specifier scan of the test *the entries and the
runner import only node: built-ins or repository files* extended to
`process.getBuiltinModule("node:…")` calls, so the no-third-party rule keeps
covering them; and the ancestor-module-type runs of the three scenarios above, with their
observables, on Node.js 24.0.0 and the current release. The header comment of each entry file, which
describes the form, is updated to match.

**What stays unchanged.** Requirement 5 apart from its clause (a); requirements
1 to 4 and 6 to 39; the `hooks/*.json` fragments, the installed command lines
of requirement 16, the tracked CommonJS files under `scripts/lib/usage-capture/`
and `scripts/lib/`, the root `package.json` of the repository, the two hooks
that already conform, and the behaviour of every hook on every payload. This
delta adds no `package.json`; the archive-root file belongs to spec 0315.

## REMOVED

Nothing is removed.
