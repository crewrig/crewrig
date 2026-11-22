---
id: "0243"
slug: usage-capture-hooks-typescript
status: draft
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 2121
version: 3.3.1
---

# Usage-capture hook and Antigravity statusline in TypeScript

*Delta 06 of `specs/0243-usage-capture-hooks-typescript.md`, cumulative on
`specs/0243-usage-capture-hooks-typescript.delta-01.md` to
`specs/0243-usage-capture-hooks-typescript.delta-05.md`. Source: ticket #2121
(ledger of two non-blocking spec-class findings of the cold review of PR #2119,
WP4 of epic #1822, ticket #2114). Delta-05 requirement 41(b) says there is "no
file with ECMAScript syntax beneath either directory". Four type declaration
files lie beneath them, and the sentence read literally forbids them. Read at
`ecd13ba7`, each uses `export` syntax and none uses `import`:
`scripts/lib/usage-capture/cursor.d.ts` (three `export function`
declarations), `scripts/lib/usage-capture/index.d.ts` (an `export interface`
and two `export function` declarations), `scripts/lib/usage-store/layout.d.ts`
(one `export function`) and `scripts/lib/usage-store/mcp.d.ts` (an `export
type`, an `export interface` and six `export function` declarations). Node.js
never loads a `.d.ts` file at run time: only the TypeScript compiler reads
them (the `typecheck-ts` task runs `scripts/check-typescript.ts` over
`tsconfig.json`, which has `noEmit` and includes `**/*.ts`, and the
declarations type the sibling `.js` files for their `.ts` importers). They
therefore carry no module type, and they were left in place. This delta states
that, so that the approved text matches the tree. It changes no behaviour and no
file. The version is a PATCH bump: a clarification of one clause and one
scenario added, no requirement changed in a way that invalidates an in-flight
implementation. No question is left open.*

## ADDED

**Scenario:** The type declaration files do not trip the scope test

Given the repository at the state of this delta, with the four `.d.ts` files
above present beneath `scripts/lib/usage-capture/` and `scripts/lib/usage-store/`
(the release archive ships them too, under the two `commonjs` scope files)
When `scripts/tests/usage-archive-scopes.test.ts` runs, including the closure
test of requirement 41(c)
Then it passes, because no hook script reaches a `.d.ts` file through the
specifier closure
And putting a `.js` or `.ts` file with `import`/`export` syntax (such as the old
`hook-run.ts`) back beneath either directory, reached from a hook script, still
makes it fail with a finding that names the file and says its scope is not the
archive root.

## MODIFIED

Requirement 41(b) — the files with ECMAScript syntax beneath the two scoped
directories.
Original (the clause of
`specs/0243-usage-capture-hooks-typescript.delta-05.md`, requirement 41, quoted
as it reads there, first sentence only):

> (b) no file with ECMAScript syntax beneath either directory. The two that
> exist move out:

Replacement:

> (b) no file with ECMAScript syntax that Node.js can load beneath either
> directory: no `.js`, `.mjs` or `.ts` file with `import`/`export` syntax. A
> `.d.ts` type declaration file is outside this clause, whatever syntax it
> uses: Node.js never loads it, it is read only by the TypeScript compiler, and
> it carries no module type. The four that exist
> (`scripts/lib/usage-capture/cursor.d.ts`,
> `scripts/lib/usage-capture/index.d.ts`, `scripts/lib/usage-store/layout.d.ts`
> and `scripts/lib/usage-store/mcp.d.ts`) stay in place, and a `.d.ts` file
> added beneath either directory later needs no move. The two ECMAScript files
> that exist move out:

The rest of clause (b) (the two moves, `hook-run.ts` to
`scripts/lib/usage-hook/` and `inventory.ts` to `scripts/lib/usage-inventory/`,
with every importer updated, and the two target directories without a scope
file) stands as written.

Requirements 41(c) and 41(d) are not affected. The closure test of 41(c) walks
the specifiers that a hook script, and the files it reaches, load or name
(`scripts/tests/lib/closure-walk.ts`: `import`, `import()`, `require`, relative
module-path strings). A `.js` specifier resolves to the `.js` file, and an
extension-less one to `.js`, `.ts`, `.json` or `/index.js`, never to `.d.ts`,
and no source file in `scripts/` or `hooks/` names a `.d.ts` path. A `.d.ts`
file is therefore never in the reached set, so the test never inspects its
syntax. Requirement 41(d) is a statement about what the archive contains, and
it is unchanged: the archive does ship the four files (its manifest ships
tracked files), and they sit under the `commonjs` scope files without effect.

## REMOVED

Nothing is removed.

**Cumulative effect.** Delta-01 to delta-05 apply unchanged, with requirement
41(b) read as the Replacement above: the ban on ECMAScript syntax beneath
`scripts/lib/usage-capture/` and `scripts/lib/usage-store/` covers the files
Node.js can load, and excludes `.d.ts` type declaration files. The version after
this delta is 3.3.1.

**What the implementation changes.** Nothing: no source file, no test and no
manifest. The delta only aligns the text of requirement 41(b) with the tree, and
records the scenario that the existing test already satisfies.

**What stays unchanged.** Every requirement of the original spec and of
delta-01 to delta-05 other than the wording of 41(b); requirements 41(a), 41(c)
and 41(d); the four `.d.ts` files and the `.js` files beside them; the two scope
files; the archive manifest; the behaviour of every hook on every payload, in the
checkout and in the archive.
