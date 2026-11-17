# Script contract

Status: provisional. This contract is pending ratification or amendment by the
project's skill authoring standard, so a script may change with it.

Every script under `scripts/` is a single TypeScript file that runs on
Node.js 24 as `node scripts/<name>.ts`, with no import and no file outside the
installed skill directory. It follows the rules below, so that a caller can
run any of them without reading its source.

## Output

- `--help` prints the usage on standard output and exits `0`.
- `--json` prints exactly one JSON object on standard output:
  `{"ok": <boolean>, "data": <object or null>, "findings": [<finding>, ...]}`.
  A finding is an object with at least `rule` (a stable identifier) and
  `message` (a sentence for a human). `ok` is `true` exactly when the exit code
  is `0`. `data` is the script's result, or `null` when the script could not
  produce one. Human-readable text goes to standard error only.
- Without `--json`, the script prints human-readable text: findings and
  summaries on standard output, usage and precondition errors on standard error.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | The script succeeded and reports no finding. |
| `1` | The script ran and reports at least one finding. |
| `2` | Usage error: an unknown option, a missing or an extra argument. |
| `3` | A precondition or the environment failed: an unreadable input, a missing tool, not inside a git repository. |

With `--json`, an exit `2` or `3` still prints the object, with `ok: false`,
`data: null` and one finding whose `rule` is `usage` or `precondition`.

## Writing

A script that can write anything accepts `--dry-run`: it reports what it would
write and writes nothing. A script never stages, commits or pushes, and never
makes a network call.

## Inputs

A script that reads a document takes a file path, or `-` for standard input
where its usage says so. Options accept both `--name value` and `--name=value`.

## The scripts of this skill

| Script | Purpose | Exit `1` means |
|---|---|---|
| `lint-pr-body.ts` | Checks a title and body against a body template. | A rule is broken. |
| `resolve-logbook-target.ts` | Says whether the logbook entry goes to a feature issue or to a standalone logbook issue. | Never used: both outcomes exit `0`. |
| `flip-spec-status.ts` | Changes a spec's `status` from `approved` to `implemented` in place. | The spec has a status other than `approved` or `implemented`. |

Each script's usage is available through its own `--help`.
