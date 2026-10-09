---
id: "0250"
slug: component-build-core-typescript
status: draft
complexity: standard
interaction-mode: MINIMAL
related-issue: 1332
version: 2.0.0
---

# Component build core in TypeScript

*Delta 01 of `specs/0250-component-build-core-typescript.md`. Source: ticket 1332,
logbook entry 13
(<https://github.com/crewrig/crewrig/issues/1332#issuecomment-6079480882>) and
the `security` review of the PR C development branch
(`test/1332-build-core-entry`). It runs under the release-branch regime of
`specs/0215-shell-to-typescript-migration.delta-04.md`: its spec-PR targets
`release/1231-ts-migration`, and the base ref of every protocol is
`origin/release/1231-ts-migration` (requirement 34 of that delta). Parent
requirement 14 of `specs/0215-shell-to-typescript-migration.md` makes the shell's
observable contract the contract of the TypeScript build, except for a listed
deviation. This delta does two things. It aligns the prose of the parent with
what `scripts/build-components.sh` actually does, where DEV, review and the corpus
test found the prose wrong or silent: the TypeScript follows the shell in every
one of these items, so each is a correction of words, and each gap the twin keeps
is added to the closed deviation list of requirement 33. It also records three
security hardenings the owner approved after the `security` review: a ceiling on
the expanded size of a YAML document (requirement 34), a refusal of a component
name that could leave the output root or act on a CI log (requirement 35), a
dependency range raised past four advisory ranges (modified requirement 24), and
the effective user of the merge-root ownership test, which corrects requirement 20
to what the shell's `-O` does. Requirements 34 and 35 and letters (u) and (v) of
requirement 37 are deliberate deviations from the shell. The shell shares the
weakness of requirement 35 and not that of requirement 34, where `yq` finished
quickly. They bind the new build only: the shell is replaced by a forwarding shim
in PR D and is not changed. Three known limitations are recorded
once, without a behaviour change, in requirement 38. The version is a MAJOR bump:
requirements 7, 17, 20 and 24 are modified, and the new range of requirement 24 and
the effective-user test of requirement 20 invalidate an implementation that
followed the parent's wording. No question is left open. This delta changes no
other requirement of the parent, and it does not reopen the decisions the parent's
*Open questions* settled.*

## ADDED

**Requirement 34 — YAML expansion budget.** A YAML document the build reads
(a component frontmatter, a model mapping, an organisation mapping) whose
**expanded size** exceeds 100,000 nodes SHALL be refused: the reader of
requirement 11 returns the same result as for an unparseable document. The
expanded size is the size of the tree obtained by following every alias: the
document root, every value of a mapping and every element of a sequence, one node
for each, a node reached through an alias counted once for every reference to it.
It SHALL be computed by a traversal that memoises the size of a shared node, never
by building the expansion, so that the time and the memory it takes are bounded by
the number of distinct nodes of the document as loaded and not by its expanded
size. A document whose alias refers back to a node that contains it, which has no
finite expanded size, SHALL be refused the same way. Both trees the reader loads
(the structure tree and the written-text tree of requirement 11) are measured, and
a document is refused when either one exceeds the budget. A refusal SHALL have
these effects, and no other:

- a component frontmatter reads as having no field, so the source is skipped by
  the missing-name warning of requirement 9 and the build goes on with the next
  component, exit status unchanged;
- a model mapping or an organisation mapping reads as an empty document
  (requirement 19: never an error), so a refused organisation mapping declares
  nothing and the core mapping alone is in force, and a refused core mapping
  reads as an empty core when a merge is asked;
- nothing is thrown, and no diagnostic other than the missing-name warning is
  written for the refusal.

A document at or below the budget SHALL read exactly as before, and a source that
needs more than the budget is written without aliases. Real sources are far below
it: at authoring, the largest frontmatter or mapping of `artifacts/`,
`model-mappings/` and the agent-profile fixtures has 191 nodes. The refusal is a
new deliberate deviation (requirement 37(u)). Reason: expanding the aliases of an
override merge exhausted the heap of the process on a 384-byte
`model-mappings/<target>.org.yml` that nests 8 levels of aliases, with a fatal
out-of-memory after about 7 seconds, where the shell and `yq` finished in under 1
second; CI runs the build on pull requests, so a pull request could take a runner
down.

**Requirement 35 — Component name safety and the output root.** The `name` of a
skill, a command or an agent, read as in requirement 11 and after the skip of an
absent or null name (requirement 33(f)), SHALL be refused when it holds a control
character (U+0000 to U+001F, U+007F), or when, split on `/` and on `\`, it has a
segment equal to `..`. The refusal SHALL happen in every mode, in a build and in
`--check`, for every tier, before the component's `Building ...:` line and before
anything is written, compared or created for it. The build SHALL then stop with
exit status 1 and an `Error:` line on standard error that names the source and the
name, each with every control character written as `\xNN` (two lower-case hex
digits), so that the line itself carries no control character. Files already
written for earlier components stay, as for the provenance error of requirement
33(g); the staging root and the merge root are removed as requirement 8 says. No
other constraint SHALL be placed on a name: the kebab-case convention of
`artifacts/FORMAT.md` is not enforced here, a `/` that is not part of a `..`
segment and a `.` are accepted, and a build or a check of the real corpus, whose
names are all kebab-case, behaves exactly as before. The way out of a refusal is to
rename the component.

As defence in depth, `checkOrWrite` and the resource copy of requirement 15 SHALL
refuse any resolved target that does not lie strictly under the output root of its
tier: exit status 1 and `Error: refusing to write outside the output root:
<path>` on standard error (control characters written as `\xNN`), before the
target is read, written or created, the output root itself included among the
refused targets. `--resolve` writes no compiled output and is not concerned.

The refusal is a new deliberate deviation (requirement 37(v)), and the one
hardening where the TypeScript refuses what the shell did. Reason, shared with the
shell: with `name: ../../../../x` a tier other than `core` writes outside its
staging root even under `--check`, which is documented as read-only; and a newline
in a name lets a pull request forge GitHub Actions workflow commands (`::error`,
`::add-mask::`) through the echoed progress lines. It applies to the new build only.

**Requirement 36 — Merge ordering rules the shell has, stated.** Parent
requirements 19 and 20 inherit the rules of spec 0198 and spec 0199 "as the shell
library realises them" and leave three of those rules unwritten. They SHALL hold
in the twin, as they do in the shell: (a) the merged offerings are ordered by
`rank` numerically, then, for equal ranks, by `id` in UTF-8 byte order, which is
code-point order (an upper-case letter before a lower-case one, a shorter `id`
before a longer one it prefixes), as `yq` compares; (b) one `duplicate-rank` note
is written for each rank held by more than one offering, in the order in which the
ranks first appear in the composed offerings before they are sorted (a substituting
organisation mapping that lists rank 5 twice and then rank 2 twice notes rank 5
first), each note naming its ids in the order of (a); (c) a document written by
either implementation is read by the other (requirement 20, unchanged).

**Requirement 37 — Deviations added to requirement 33.** The closed list of
requirement 33 is extended by the letters below, which continue its lettering, so
that the list reads "exactly these, (a) to (v)". Letters (a), (f), (g) and (l) are
reworded under *MODIFIED*. Each added letter, like each of the others, SHALL be
pinned by a test that compares the twin with the shell where the shell can run, and
that fails when the difference vanishes, the way the conformance test of
requirement 21 treats a documented difference.

(m) a mapping or a sequence read where the build wants a scalar (`description`,
`license`, `compatibility`, a `claude.*` or `antigravity.*` key) renders as the
empty text, where `yq -r` printed the node as YAML in the style it was written, in
block form (`k: v` lines, `- a` lines) or in flow form (`[alpha, beta]`). A line
that is written only when its text is non-empty (`license:`, `compatibility:`, a
`claude.*` line) is therefore absent, and `description` is written as `""`. The
corpus has no such source;

(n) an unquoted YAML timestamp (`2026-01-02`) as a provenance value is rendered by
its written text, where `yq` failed on the string concatenation, so the shell
emitted an empty `provenance:` block and lost every entry;

(o) a merge key (`<<`) is an ordinary key, because the pinned schemas of
requirement 11 do not resolve it, where `yq` merged the aliased mapping into its
parent: a field supplied only through a merge key reads as absent;

(p) a configuration key written as an array subscript (`k[0]`) is refused with
status 1 as any key outside letters, digits and underscores is, where the shell
accepted it, assigned the element, and let its placeholder match the text `${K0}`;

(q) `MAPPING_MERGE_DIR` naming an existing regular file owned by the user: the
shell prints a cascade of `mkdir`, `mktemp` and `yq` errors on standard error and
resolves with an empty offering, where the twin degrades to the core mapping with
the `merge-unavailable` note of requirement 20 and resolves against it, since
requirement 19 forbids `resolveAgent` to throw;

(r) bash's own `integer expression expected` lines, written when a `rank` is not a
shell integer, and `yq`'s own `Error:` text for an unparseable or sequence-valued
mapping are not reproduced: the twin selects the same offering and writes the same
merge lines;

(s) an offering with no `rank` sorts first in the merged document, where `yq` sorted
it last: the input is outside what the mapping checker accepts and spec 0199 leaves
it unspecified;

(t) a `rank` written as an integer in any form but plain decimal (`0x10`, `0o17`,
`+5`, `007`) is kept as written in the merged document, where the merge of the
shell rewrote it as a decimal integer (`16`, `15`, `5`, `7`). It sorts by its
value, but it no longer ties with a core rank written in plain decimal, so the
`duplicate-rank` note that the shell wrote for `0x2` beside core's rank 2 is not
written. A float (`1.50`, `1e3`) is kept as written by both implementations;

(u) a YAML document whose expanded size exceeds the budget of requirement 34 is
refused, where the shell and `yq` read it;

(v) a component name with a control character or a `..` segment, and a target
outside its output root, are refused as requirement 35 says, where the shell built
the component and wrote the files.

**Requirement 38 — Known limitations, recorded and left open.** The `security`
review also found three weaknesses that this delta does not change. They are
recorded here once, as limitations to know and not as defects to fix in this
ticket; a later ticket decides whether to close them.

- (a) The collision pre-pass of requirement 17 reads the first raw line that
  begins with `name:` in the leading frontmatter, as the shell does, and SHALL keep
  doing so. A multi-line double-quoted `description` can carry a decoy line
  beginning with `name:`, so two components that carry one YAML `name` can evade
  the pre-pass, in the shell too.
- (b) The merge root `crewrig-mapping-<pid>` of requirement 20 is predictable (a
  risk accepted by spec 0199) and SHALL stay so. A symbolic link planted at that
  path and pointing to a directory the user owns is followed, and a directory owned
  by someone else, created there beforehand, makes the build degrade to the core
  mapping with the `merge-unavailable` note on standard error, in the shell too.
- (c) The values of `crewrig.config.toml` land verbatim in the generated skill
  bodies and provenance, and `canonical_repo` is the only value requirement 7
  validates, in the shell too. A change to that file SHALL be reviewed like a
  source change, and the repository SHOULD protect it with a `CODEOWNERS` entry.

**Scenario:** A component named with a parent segment is refused before it writes
outside the root

Given an overlay tier `community` holding a skill whose `name` is `../../../../esc`
And a build with `--target claude` and no `--check`
When the build reaches that skill
Then it prints `Error:` naming the source and `../../../../esc`, exits 1, writes no
file outside `dist/community`, creates no `esc` directory next to `REPO_DIR`, and
has printed no `Building skill:` line for that skill.

**Scenario:** A name holding a newline cannot forge a workflow command

Given a skill whose `name` is the double-quoted scalar `"x\n::error::forged"`
When a build runs in a CI job
Then standard output carries no line that begins with `::`, standard error carries
one `Error:` line that shows the name as `x\x0a::error::forged`, and the exit status
is 1.

**Scenario:** `--check` stays read-only for a hostile name

Given the skill of the first scenario and a `--check` run
When it runs
Then it exits 1 with the same refusal, nothing was created outside the staging root
(not even under the platform temporary directory), and the staging root is removed.

**Scenario:** The writer refuses a target that is not under its root

Given a call of `checkOrWrite` whose target resolves to the output root itself, and
another to a sibling directory of it
When each is made
Then each exits 1 with `Error: refusing to write outside the output root:` and the
path, and neither file is read, written or created.

**Scenario:** An ordinary name is not touched

Given skills named `probe`, `my.skill`, `a..b` and `v2..3`
When a build runs
Then each is built as before, because `..` is refused only as a whole segment, and
the real corpus builds byte for byte as it did.

**Scenario:** A nested-alias document is refused fast and the build continues without it

Given `model-mappings/claude.org.yml` of 604 bytes that declares one offering and
nests 8 levels of 10 entries each, every level an alias of the one below, and a core
mapping
When `--resolve` runs for a core agent on `claude`
Then it finishes in well under a second with no heap exhaustion, writes no
`mapping-merge` line, resolves against the core mapping alone, and exits 0.

**Scenario:** An oversized frontmatter skips one source only

Given two skills, one whose frontmatter nests aliases past the budget and one that
is ordinary
When a build runs
Then the first prints `Warning: <source> missing 'name' field, skipping`, the second
is built, and the exit status is 0.

**Scenario:** The budget is a count of expanded nodes

Given a document of exactly 100,000 expanded nodes, one of 100,001, and one whose
alias refers back to the sequence that holds it
When each is read
Then the first is read normally and the other two are refused.

**Scenario:** A configuration key may start with a digit and may not be a subscript

Given `crewrig.config.toml` holding `1a = "x"` and `_b = "y"`, then holding `k[0] =
"z"`, then holding `k-b = "z"`
When a build runs on each
Then the first builds with `${1A}` and `${_B}` replaced, the second exits 1 with an
`Error:` naming the line (the shell accepted it), and the third exits 1 with an
`Error:` naming the line (the shell exited 2).

**Scenario:** The body does not depend on line 1

Given a file whose first line is empty, followed by `---`, `name: x`, `---`, `one`,
`---`, `two`
When the extraction helpers of requirement 18 read it
Then the frontmatter is empty and the body is `one`, `---`, `two`; and for a file
that holds `intro`, `---`, `one` the body is empty.

**Scenario:** The shown name of a collision loses a prefix only when it starts the
name

Given two overlay tiers that each hold a skill named `mcpServers.foo`, an
`mcp-servers/foo.json` and a `themes/bar.json`
When a build runs
Then the report refuses `foo` for the skill, `claude:mcpServers.foo` (and the three
other `<cli>:` forms) for the server, and `gemini:settings.themes.bar` for the
theme, and exits 1.

**Scenario:** The pre-pass and the build read a CRLF name differently

Given a skill in directory `dirA` whose source has CRLF line endings and
`name: shared`, and a skill in directory `dirB` whose source starts with a UTF-8
byte-order mark and `name: shared`
When the collision pre-pass runs and the build runs
Then the pre-pass keys them on `dirA` and `dirB`, and the build writes both
under `shared`.

**Scenario:** A timestamp provenance value is kept, a flow sequence is not

Given a skill whose provenance holds `version: 2026-01-02`, and a skill whose
`description` is `[alpha, beta]`
When the build writes them
Then the first carries `version: "2026-01-02"` in its provenance block, and the
second carries `description: ""` (requirement 37(m), (n)).

**Scenario:** Explicit tags, aliases and merge keys follow the library

Given frontmatters with `description: !!int 5`, with `description: *x` after
`base: &x "hello"`, with a repeated key, and with `<<: *b` supplying `description`
When a build runs
Then the first and the third are skipped by the missing-name warning, the second is
written with `description: "hello"`, and the fourth reads `description` as absent
(requirement 33(g), 37(o)).

**Scenario:** A merge directory that is a regular file degrades

Given `MAPPING_MERGE_DIR` naming a regular file owned by the user and an
organisation mapping that declares an offering
When `--resolve` runs
Then standard error carries the `merge-unavailable` note, standard output carries
the offering resolved from the core mapping, and no `mkdir` or `yq` error is
written.

**Scenario:** The ownership of a merge root is tested against the effective user

Given a merge context whose effective user is 1000 (a process whose real user is
0), and an existing merge root owned by 1000
When the root is examined
Then it is reused; and a root owned by 0 is refused with the `merge-unavailable`
note.

**Scenario:** Offerings with no rank and with a hex rank

Given an organisation mapping with an offering without a `rank` and one with
`rank: 0x10`, beside the four core offerings
When the merge is made
Then the offering without a rank is first, `0x10` is kept as written and sorted
after rank 9, and the shell's merged document differs in exactly these two ways.

**Scenario:** The drift hint names the TypeScript entry

Given a `--check` run that finds drift in `core`
When it ends
Then its last standard-output line is `FAILED: Drift detected. Run 'node
scripts/build-components.ts' to regenerate.` and the exit status is 1.

**Scenario:** A locale does not reorder the build

Given three skills `Zed`, `alpha` and `probe`, the last with references `B.md`,
`a.md`, `_c.md` and `Z.md`, and `LC_ALL` set to a non-C locale
When a build runs
Then the `Building` and `Generated:` lines come in code-unit order (`Zed`, `alpha`,
`probe`; `B.md`, `Z.md`, `_c.md`, `a.md`), as under the C locale, and the same files
are written.

**Scenario:** The dependency range excludes the advisory ranges

Given the root `package.json` and `package-lock.json` after the implementation
When their `js-yaml` entries are read
Then `dependencies` declares `^4.3.2`, `devDependencies` no longer lists it, and the
lockfile resolves a version that range admits, 4.3.2 or later, with no package added.

## MODIFIED

Requirement 7 — the key rule, corrected to what the shell does: the shell builds a
variable `CFG_<KEY>`, so a key that begins with a digit is accepted, and the
subscript key the shell accepts is a listed deviation (requirement 37(p)). Original:

<!-- markdownlint-disable-next-line MD029 -->
> A key whose upper-cased form is not a valid identifier
> (`[A-Za-z_][A-Za-z0-9_]*`, which a TOML table header and a hyphenated key are
> not) SHALL exit 1 with an `Error:` naming the line, as the shell aborted on it,
> with status 1 or 2 according to the character (requirement 33(i)).

Replacement:

<!-- markdownlint-disable-next-line MD029 -->
> A key whose upper-cased form is not made of letters, digits and underscores
> alone (`[A-Za-z0-9_]+`: the first character is not constrained, so `1a` and `_b`
> are accepted, as the variable `CFG_<KEY>` the shell builds accepts them; a TOML
> table header, a hyphenated key and an array-subscript key such as `k[0]` are not)
> SHALL exit 1 with an `Error:` naming the line, as the shell aborted on it,
> with status 1 or 2 according to the character (requirement 33(i)). The
> array-subscript key is the one the shell accepted and the build refuses
> (requirement 37(p)).

Requirement 10 — the body is independent of line 1, which the sentence about
"no frontmatter" left to be read as an empty body. Original:

<!-- markdownlint-disable-next-line MD029 -->
> when line 1 is not `---` there is no frontmatter and every field reads as absent.
> The body SHALL be every line after the second line, counted from the start of the
> file, that is exactly `---`, so a bare `---` inside a fenced block of the body
> belongs to the body and never to the frontmatter.

Replacement:

<!-- markdownlint-disable-next-line MD029 -->
> when line 1 is not `---` there is no frontmatter and every field reads as absent.
> The body SHALL be every line after the second line, counted from the start of the
> file, that is exactly `---`, whatever line 1 is, so a bare `---` inside a fenced
> block of the body belongs to the body and never to the frontmatter. A file whose
> line 1 is not `---` therefore has an empty frontmatter and still has a body: the
> lines after its second `---` line, and nothing when it has fewer than two. The
> build never writes such a body, because a source with no frontmatter has no
> `name` and is skipped (requirement 9); the extraction helpers of requirement 18
> return it.

Requirement 14 — the order of the finalisation, which two normalisations leave
ambiguous. Original:

<!-- markdownlint-disable-next-line MD029 -->
> Line-ending normalisation SHALL reuse `toLf` of `scripts/lib/line-endings.ts`.

Replacement:

<!-- markdownlint-disable-next-line MD029 -->
> Line-ending normalisation SHALL reuse `toLf` of `scripts/lib/line-endings.ts`, and
> SHALL be applied first: the trailing line feeds are stripped and the single line
> feed is appended afterwards, so that assembled text that ends in CRLF ends in
> exactly one LF.

Requirement 17 — the shown name, and the raw reading of the pre-pass, corrected to
what the shell does. Original, first sentence:

<!-- markdownlint-disable-next-line MD029 -->
> the name shown being the target's base name without a `mcpServers.` or
> `settings.themes.` prefix and without a `.md`, `.toml` or `.json` suffix

Replacement:

<!-- markdownlint-disable-next-line MD029 -->
> the name shown being the target's base name (the text after its last `/`),
> without a `.md`, `.toml` or `.json` suffix, and without a `mcpServers.` or
> `settings.themes.` prefix only when that base name itself begins with it, as the
> shell's `basename` and `case` do: a skill named `mcpServers.foo` is shown as `foo`,
> while the targets `claude:mcpServers.foo` and `gemini:settings.themes.foo` are
> shown whole, because the `<cli>:` that precedes them is part of their base name

Original, the end of the sentence that reads a name:

<!-- markdownlint-disable-next-line MD029 -->
> carriage returns and trailing whitespace removed, the directory or file name when
> empty.

Replacement:

<!-- markdownlint-disable-next-line MD029 -->
> carriage returns and trailing whitespace removed, the directory or file name when
> empty. The file SHALL be read as raw bytes, as the shell's `awk` reads it, with no
> line-ending and no byte-order-mark normalisation: in a source with CRLF line
> endings or a leading byte-order mark, line 1 is not `---` followed by blanks, so
> the pre-pass finds no `name:` and keys the component on its directory name, while
> the build, which reads the same source as LF without the mark (requirement 33(e)),
> keys its outputs on its `name`. The real tree has no such source.

Requirement 20 — the user of the ownership test, corrected to the shell's `-O`,
which tests the effective user id. The parent's "current user" is read by the code
as the real user id, which differs from the effective one in a process that runs
with a changed effective user. Original:

<!-- markdownlint-disable-next-line MD029 -->
> reused only when owned by the current user on macOS and Linux (skipped on
> Windows, where ownership is not modelled)

Replacement:

<!-- markdownlint-disable-next-line MD029 -->
> reused only when owned by the effective user on macOS and Linux, the owner being
> compared with `process.geteuid()`, as the shell's `-O` tests the effective user id,
> and not with the real user id `process.getuid()` (skipped on Windows, where
> ownership is not modelled)

Requirement 24 — the version of the dependency, raised past four advisory ranges.
The lockfile pinned 4.3.0, which lies inside four advisory ranges of `js-yaml`;
none is reachable through the pinned core and failsafe schemas of requirement 11,
and the production dependency of a build that runs on pull requests is moved out of
them. Original:

<!-- markdownlint-disable-next-line MD029 -->
> at the version the lockfile already pins, adding no package.

Replacement:

<!-- markdownlint-disable-next-line MD029 -->
> at the range `^4.3.2`, with `package-lock.json` updated to resolve a version that
> range admits, 4.3.2 or later, adding no package to the dependency tree (a package
> already there only changes from a development to a production dependency).

Requirement 33(a) — the exact text of the drift hint. Original:

<!-- markdownlint-disable-next-line MD029 -->
> (a) the drift hint, `FAILED: Drift detected. Run 'bash scripts/build-components.sh'
> to regenerate.`, names the TypeScript invocation, as the shell form is not
> available on Windows;

Replacement:

<!-- markdownlint-disable-next-line MD029 -->
> (a) the drift hint is `FAILED: Drift detected. Run 'node scripts/build-components.ts'
> to regenerate.` where the shell wrote `FAILED: Drift detected. Run 'bash
> scripts/build-components.sh' to regenerate.`, as the shell form is not available
> on Windows; the hint names the TypeScript entry file alone, with no floor-guard
> step;

Requirement 33(f) — what the shell did with a name that reads as null, and which
spellings the twin skips. Original:

<!-- markdownlint-disable-next-line MD029 -->
> (f) a `name` that is absent or null is skipped with the existing warning where the
> shell built a component named `null`, while the collision pre-pass still falls
> back to the directory name;

Replacement:

<!-- markdownlint-disable-next-line MD029 -->
> (f) a `name` that is absent, empty, or a YAML null in any spelling (`null`, `~`,
> `Null`, `NULL`) is skipped with the existing warning, where the shell skipped only
> an empty text and built a component named by the text `yq` printed: `null` for an
> absent name and for `null`, and `~`, `Null` or `NULL` for those spellings; a quoted
> `"~"` is a string and is built under that name by both; the collision pre-pass
> still falls back to the directory name;

Requirement 33(g) — the frontmatter features outside the supported subset, stated
with what each does, since the parent named them without saying. Original:

<!-- markdownlint-disable-next-line MD029 -->
> (g) a provenance entry that is a mapping or a sequence is a build error where the
> shell emitted an empty `provenance:` block, and duplicate keys, aliases and
> explicit non-core tags in a frontmatter are outside the supported subset (the
> corpus has none) and follow the library, where `yq` tolerated them;

Replacement:

<!-- markdownlint-disable-next-line MD029 -->
> (g) a provenance entry that is a mapping or a sequence is a build error where the
> shell emitted an empty `provenance:` block; and the frontmatter features outside
> the supported subset (the corpus has none) follow the library where `yq`
> tolerated them: an alias is expanded by the loader, where `yq -r` printed the
> alias text (`*x`); a duplicate key, and any explicit tag other than `!!str`,
> `!!map` and `!!seq` (`!!int`, `!!bool`, `!!float`, `!!null`, `!!timestamp`,
> `!!binary` and a local tag among them), make the document unparseable, so the
> source is skipped by the missing-name warning, where `yq` read the last value of
> a duplicate and the written text of a tagged scalar; a merge key is an ordinary
> key (requirement 37(o));

Requirement 33(l) — every enumeration the shell took from its locale, not the
listing of output directories alone. Original:

<!-- markdownlint-disable-next-line MD029 -->
> (l) `--list-output-dirs` order under a non-C locale where the shell's `sort`
> collated differently (the set never differs).

Replacement:

<!-- markdownlint-disable-next-line MD029 -->
> (l) the order of every enumeration the shell took from its locale, under a non-C
> locale: the lines of `--list-output-dirs`, and the tiers, the components of a tier
> and the resource files of a skill, hence the order of the `--- Tier:`,
> `Building ...:`, `Generated:` and `DRIFT:` lines, where the shell's glob and
> `sort` collated differently. The build uses code-unit order throughout, the shell's
> order under the C locale. The set of lines and of files, and every byte written,
> never differ.

## REMOVED

Nothing is removed.
