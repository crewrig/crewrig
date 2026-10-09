---
id: "0254"
slug: extension-plugin-builders-typescript
status: approved
complexity: standard
interaction-mode: MINIMAL
related-issue: 1333
version: 2.0.0
---

# Extension and plugin builders in TypeScript

*Delta 01 of `specs/0254-extension-plugin-builders-typescript.md`. Source: ticket
1333, the differential, conformance and shell-comparison suites of PRs B and C
(logbook entries on <https://github.com/crewrig/crewrig/issues/1333>) and the Gate C
trial of plan finding `v1-F1` (the five shims applied over the PR C branch, the
sixteen Bash oracle suites run through them). It runs under the release-branch regime
of `specs/0215-shell-to-typescript-migration.delta-04.md`: its spec-PR targets
`release/1231-ts-migration`, and the base ref of every protocol is
`origin/release/1231-ts-migration` (requirement 34 of that delta). Parent requirement
14 of `specs/0215-shell-to-typescript-migration.md` makes the shell's observable
contract the contract of the TypeScript entries, except for a listed deviation, and
requirement 28 of the parent spec closes that list at nine letters with letters (j)
onward reserved for what the differential test discovers. This delta does three
things. It corrects the one sentence of requirement 8 that misdescribes what the shell
does with a `location` that has no trailing slash. It adds six deviations to the
closed list of requirement 28 (letters (j) to (o)), each found by a comparison suite
that runs the real shell, each decided in the code of PRs B and C, and it states three
behaviours the twins keep from the shell as clarifications, so a reader does not take
them for defects. And it records one named, bounded exception to the scope of the
ticket, found by the Gate C trial: `scripts/monorepo-release.sh` stages a symbolic link
to `node_modules` that the TypeScript entries refuse by design (requirement 30). The
version is a MAJOR bump: requirement 8 is modified in a way that invalidates an
implementation that followed the parent's wording. No question is left open. This delta
changes no other requirement of the parent, and it does not reopen the decisions the
parent's *Open questions* settled.*

## ADDED

**Requirement 30 — Release-driver staging (named, bounded exception).** After the
shims of requirement 24 are installed, `scripts/monorepo-release.sh` runs the
packaging of an extension inside a throwaway clone whose `node_modules` it staged as a
symbolic link to the checkout's (`release_make_mirror`, line 236 at `9e69941`). The
TypeScript entries load `js-yaml` only through the dependency loader of spec 0240
requirement 7, which accepts a package only when its real path lies under the root's
own `node_modules` and therefore refuses that link; the Bash suite
`scripts/tests/test-monorepo-release-engine.sh` then fails its rehearsal steps (14
assertions at the trial). The file belongs to row G2 (#1336), which has no owner yet
and migrates it later. This row SHALL therefore make one bounded edit to it, in the
pull request that installs the shims and in no other: `release_make_mirror` SHALL stage
the clone's `node_modules` as a real directory that holds a real copy of the production
closure of `js-yaml` (`js-yaml` and `argparse`) and, for every other entry of the
checkout's `node_modules` (dotfiles included), a symbolic link, exactly as PR A of this
ticket staged the fixture of that suite. The edit SHALL change no other line of the file
and no other behaviour of the driver, SHALL NOT relax any assertion of
`scripts/tests/test-monorepo-release-engine.sh` (the suite SHALL pass unchanged), and
SHALL be noted by a comment on the issue of row G2 that names this requirement, without
assigning anyone. The edit SHALL be verified two ways: the description of the pull request SHALL show that the
diff of `scripts/monorepo-release.sh` lies entirely inside `release_make_mirror`, and
`scripts/tests/test-monorepo-release-engine.sh` SHALL run in CI (the `Release Driver Tests`
workflow) on that pull request and pass with no assertion changed. The existence of this
exception SHALL NOT be cited as precedent for
any other script of row G2 or of a later row.

## MODIFIED

**Requirement 8 — `location` without a trailing slash.** Original, last sentences of
the accessor rule:

> A subject's `location` and options are read with the defaults of the shell accessors
> and used as written, concatenated to the extension directory with no separator
> inserted, exactly as the plugin builders do, so a `location` without a trailing slash
> matches nothing there (and `build-extension`, which strips one trailing slash, still
> finds it): that asymmetry is preserved.

Replacement:

> A subject's `location` and options are read with the defaults of the shell accessors.
> `build-extension` strips one trailing slash from a `location` and the plugin builders
> read it as written followed by a slash when it has none, so a `location` such as
> `commands` names the directory `commands/` in every script. The shell's plugin builders
> concatenated the `location` to a glob instead (`"$EXT_DIR/$LOC"*.md`), so a `location`
> without a trailing slash matched sibling files named `commands*.md` and, for skills,
> matched the skills directory itself and copied it into itself; the twins do not
> reproduce that (requirement 28(j)). A `location` with a trailing slash behaves as the
> shell's.

**Requirement 28 — listed deviations, letters (j) to (o).** The list of requirement 28
is extended with the following, each tagged in the differential, conformance and
shell-comparison suites like (a) to (i):

- (j) a `location` without a trailing slash is read as a directory by the plugin
  builders (requirement 8, as modified);
- (k) a `mcpServers` entry that is neither an object nor `null` is refused with
  `Error: mcpServers.<name> is not an object`, where the shell's whole translation
  failed silently with an empty output and status 0 (validation rejects such a manifest
  first, so only a caller that skips validation reaches it); a `null` entry is an empty
  stdio server in both;
- (l) a `&` in a replacement text stays literal, where bash 5.2 and later and `awk`
  `gsub` read it as the matched text: the extension name substituted for `${EXTENSION}`
  and the `{ext}` and `{name}` of a descriptor template; no extension on `main` has such
  a name;
- (m) a manifest whose `claude` section is not an object reads as having no `claude`
  key, where the shell's `jq` read aborted the script silently under `set -e`;
- (n) a command body that is exactly one of the options of `echo` (`-n`, `-e`, `-E`) is
  written verbatim, where the shell's `echo "$cmd_prompt"` consumed it;
- (o) a legacy-shape enumeration file that is present but malformed fails with
  `Error: legacy-shape enumeration at <path> is malformed (spec 0183 R12).` and exit 1,
  where the shell died through `jq` with its own message and status 5; and a retired
  `components` value that is not an object makes the migration tool treat every subject
  as not enabled, where the shell aborted on the `enabled` lookup;

**Clarifications that are not deviations.** Three behaviours the twins keep from the
shell, stated so that a reader does not take them for defects: (1) the retired-`components`
message of requirement 8 has an empty subjects clause, so its text keeps a double space
before the dash, because the shell's `jq` program that was meant to list the subjects
always failed with its standard error discarded; (2) a Copilot context render that fails
exits 1 after the diagnostics with no `Error:` line of its own (the shell assigns the
render through a command substitution under `set -e`), where the Claude and Antigravity
renderers add `Error: rendering context for target '<t>' failed`; (3) a Copilot agent
directory without an `AGENT.md` stops the renderer with status 1 after the output already
written and prints nothing about it on standard output.

**Out of scope, packaging and release bullet.** Original: "Packaging and release
(`scripts/package-extension*.sh`, `scripts/release-package-extension.sh`,
`scripts/monorepo-release.sh`): row G2." Replacement: "Packaging and release
(`scripts/package-extension*.sh`, `scripts/release-package-extension.sh`,
`scripts/monorepo-release.sh`): row G2, except the one bounded edit of
`scripts/monorepo-release.sh` that requirement 30 of delta-01 allows."

## REMOVED

Nothing is removed.
