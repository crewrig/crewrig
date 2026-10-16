---
id: "0261"
slug: e2e-harness-probes-typescript
status: implemented
complexity: standard
interaction-mode: MINIMAL
related-issue: 1342
version: 1.2.0
---

# End-to-end harness and probes in TypeScript

*Delta 02 of `specs/0261-e2e-harness-probes-typescript.md`. Source: the recording, the
differentials and the seated reviews of ticket 1342 (pull requests #1622, #1631 to #1638 and
the switch pull request): the shell oracle and the TypeScript twins disagree on a finite list
of observable details that requirement 24 reserved the letters (h) onward for, and the
shim form (requirement 16) names the warning flag the repository already uses. It runs under
the release-branch regime of `specs/0215-shell-to-typescript-migration.delta-04.md`: its
spec-PR targets `release/1231-ts-migration`, and the base ref of every protocol is
`origin/release/1231-ts-migration` (requirement 34 of that delta). This delta modifies
requirements 2, 16 and 24 and adds scenarios. The version is a MINOR bump: no behaviour of
the shell changes, the closed list of deviations is completed with the letters (h) to (u),
each found by a test that names it, and the entry form states the flag. This delta opens no
question.*

## ADDED

**Scenario:** A shim runs the entry without a Node.js warning

Given the forwarding shim `scripts/e2e/auth-claude.sh` and no `docker` on the path
When `bash scripts/e2e/auth-claude.sh` runs
Then its standard error holds only the diagnostic of the entry, with no
`MODULE_TYPELESS_PACKAGE_JSON` warning, because the shim passes
`--disable-warning=MODULE_TYPELESS_PACKAGE_JSON`.

**Scenario:** A Gemini probe that exits 124 is not tolerated, as in the shell

Given scenario `01-layered-context` for Gemini CLI and a stand-in `docker` that exits 124
after writing the answer file
When the runner runs the case
Then the sub-test `docker run probe exited non-zero (exit 0)` is `not ok` and the case exits
1, the shell's recorded behaviour (its `if ! cmd; then rc=$?` reads the status of the
negation).

## MODIFIED

Requirement 2, the sentence "Standard output, standard error and exit statuses are the
contract; a warning on standard error SHALL NOT appear." Replacement: "Standard output,
standard error and exit statuses are the contract; a warning on standard error SHALL NOT
appear. An entry is run as `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON <path>.ts`
(the repository's convention for a TypeScript file in a typeless package, used by every
`Taskfile.yml` entry and CI step), so the loader notice the module syntax would cause never
reaches standard error; a forwarding shim, a `Taskfile.yml` entry, a workflow step and a
runbook SHALL name that flag."

Requirement 16, the sentence "A shim is a `bash` file of three lines that runs `node` on the
sibling `.ts` and forwards its arguments and status, stays on `ci/shell-allowlist.txt`, and is
deleted in the pull request that migrates the last J3 suite that spawns it when no file outside
this row names it, and is otherwise left to row J4." Replacement: "A shim is a `bash` file that
checks that `node` is on the path, runs the Node.js floor guard, then runs `exec node
--disable-warning=MODULE_TYPELESS_PACKAGE_JSON <stem>.ts \"$@\"` on the sibling `.ts`, so that
every argument, the standard input and the exit status reach the entry and the loader notice
that an entry written with `import` would cause never reaches standard error (a plain `exec
node` prints it); it stays on `ci/shell-allowlist.txt`, is deleted in the pull request that
migrates the last J3 suite that spawns it when no file outside this row names it, and is
otherwise left to row J4. The form follows the shims of the earlier rows, which load a
self-contained entry and so need no flag; this row's entries import their modules." A
differential test that compares the shell leg with the TypeScript leg SHALL skip the shell leg
when the shell file is such a shim: the recorded goldens are then the oracle.

Requirement 24, the list "(a) to (g)". Replacement: the list below is the whole closed list.
(a) to (g) are those of the original; (b) also covers the diagnostics of a TOML file that
`yq` rejected ("malformed" input), whose wording is the twin's, and the float text, which
follows the `yq` version of the recording (`0.0` prints as `0`), and `{}` for an empty
defaults file where `yq` printed `null`. The added letters:

(h) the hooks probe prints `R10 time-unit check: confirmed — seconds, default 30.` wherever
the Antigravity hooks document holds the sentence; the shell printed it only where `grep`
reads a backslash-backtick as a literal backtick (BSD `grep`, macOS), never with GNU `grep`;
(i) the publisher `publish-probe-verdict` words the diagnostics of an `--issue` with no
value, of a missing `gh` when `jq` is also missing, and of an unparsable `verdict.json` in
its own text (exit statuses unchanged); its jq-error texts follow `jq` 1.7, the version of
the recordings and of the runner image, and the text of a number literal (`1.10`) and the
order of integer-like object keys follow `JSON.parse`;
(j) the runner and the scenarios word the diagnostics that Bash prints with its own
`<script>: line N:` prefix (a flag with no value, an unset `E2E_*` variable, `docker` not
found) without that prefix, and treat a non-numeric `--keep` as 0;
(k) `invocation.txt` and the masked command lines quote every byte of a non-ASCII argument as
an octal escape in every locale, the form Bash `printf %q` prints in the C locale of the
recordings;
(l) the twins rebuild the text of `mktemp`, `chmod` and `cp` failures (GNU wording) from the
Node.js error, and the file mode of a copied file follows the source mode where `cp` applied
the umask;
(m) an extended regular expression is matched after a trailing carriage return is stripped
from each line, and character classes are mapped to their JavaScript equivalents; text is
measured in characters where the shell measured bytes under `LC_ALL=C` (the truncation of a
diagnostic at 200 bytes), except where a golden pins the byte form;
(n) the judge drivers reach their endpoint with `fetch`, honour no proxy variable, report the
exit status of a failed token refresh as 22 (an HTTP status of 400 or more) or 7 (a network
failure) in the `curl rc=` diagnostic, and drop the preflight check of `jq`, `curl` and
`openssl`;
(o) the Model Context Protocol token probe has no signal handler (the `finally` covers a
normal exit and a thrown error, the shell's `EXIT` trap also ran on `SIGINT` and `SIGTERM`),
bounds its calls (60 s for the Copilot sessions of Q1, 90 s for the Antigravity session, 120 s
for the two listing calls of Q4) and prints a single-hunk normal-format `diff`;
(p) the Antigravity discovery probe does not print the job notice (`Terminated: 15 ...` or a
bare `Terminated`) that Bash prints for its watchdog subshell, and `AGY_FORCE_NO_JOB_CONTROL`
is accepted and has no effect because every call runs in its own process group;
(q) the hooks probe bounds the Copilot call with a child-process timeout whether or not a
`timeout` binary exists, and reports an expiry as status 124;
(r) the library `assert` writes the `mempalace` diagnostics of a drawer assertion with
standard output before standard error where the shell interleaved them;
(s) a TOML construct outside the subset of requirement 6 exits 1 with one diagnostic naming
the file, the line and the construct (this restates (b) for `defaults.toml`);
(t) the `report` library writes the parity matrix with the clock injected by its caller and
measures column widths in bytes;
(u) the version-capture script never exits 2, as the shell never did: its header promised
exit 2 on an empty version, but the shell's empty-field list is lost in a subshell, so an
empty version prints `<unknown>` and the script exits 0; the twin preserves what callers saw.

## REMOVED

Nothing.
