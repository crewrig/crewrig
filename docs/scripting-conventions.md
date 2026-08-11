# Scripting Conventions

<!-- crewrig-doc: section=reference nav_order=40 published=true title="Scripting conventions" -->

Bash and Python glue scripts under `scripts/` and `hooks/` follow these rules.
The list is short on purpose: each rule comes from a real production incident
where a script silently misbehaved for weeks. If you have a real reason to
break a rule, mark the line with `# acknowledged-exception: <reason>` so the
exception is greppable.

---

## Rule 1 — No broad or bare `except` in Python glue

A `try` block must catch the narrowest exception that justifies the recovery
path. Bare `except:`, `except Exception:`, and `except BaseException:` are
banned because they silently swallow `ImportError`, `KeyboardInterrupt`,
`SystemExit`, and unrelated runtime bugs.

### Why

The session-transcript hook (`hooks/mempalace-transcript.sh`) silently
dropped every entry for **months** after the MemPalace v3.x upgrade. A broad
`except` was hiding an `ImportError` for a class that no longer existed
(`PalaceGraph`). The fix landed in `1429cdb`; this rule exists so the
failure mode does not return.

### Bad

```python
try:
    from mempalace.mcp_server import tool_add_drawer
    result = tool_add_drawer(...)
except:
    pass  # never know what failed
```

### Good

```python
try:
    from mempalace.mcp_server import tool_add_drawer
except ImportError as e:
    print(f"IMPORT_ERROR: {e}", file=sys.stderr)
    sys.exit(2)

result = tool_add_drawer(...)
if not result.get("success"):
    print(f"ADD_FAILED: {result.get('error', 'unknown')}", file=sys.stderr)
    sys.exit(3)
```

If continuing past a failure is genuinely correct, surface it:

```python
try:
    drawer_dt = datetime.strptime(date_str, "%Y-%m-%d")
except ValueError:
    stats["skipped_format"] += 1   # counted, not silent
    continue
```

If `stats["skipped_format"] == total_scanned`, escalate — that means the
recovery path is masking a structural assumption error.

---

## Rule 2 — No success-log-before-result

A log line that says "did X" must be guarded by the actual outcome of X.
Logs that fire regardless of the underlying call's exit status produce
months of "looks fine" with zero data flowing.

### Why

The transcript hook printed `mempalace-transcript: persisted ...` to stderr
on **every** invocation, including the ones where the underlying Python
heredoc had crashed during import. The success line lived outside the
return-code check that gated it. PR #31 / commit `1429cdb`.

### Bad

```bash
"$MEMPALACE_PYTHON" - <<PYEOF
... # may exit non-zero
PYEOF
echo "persisted entry"  # fires regardless
```

### Good

```bash
STATUS=$("$MEMPALACE_PYTHON" - 2>&1 <<'PYEOF'
... # may exit non-zero
PYEOF
)
STATUS_RC=$?
if [ "$STATUS_RC" -eq 0 ]; then
  echo "persisted entry"
else
  echo "FAILED to persist (rc=$STATUS_RC): $STATUS" >&2
fi
```

The principle generalizes: the log line must be on the success branch of an
`if` that read the actual result.

---

## Rule 3 — No `[ test ] && cmd && exit N` under `set -e`

Use an explicit `if … then … fi` block. The chained-test pattern looks like
a one-line guard, but under `set -e` it kills the script on the **success**
path: when the test is false, the compound returns non-zero, and `set -e`
aborts before the next intended statement. The script appears to fail
silently on every successful run.

### Why

Surfaced in commit `212318c`:

> The pattern `[ -z "$FOUND" ] && echo "..." && exit 1` would kill the
> script via `set -e` whenever FOUND was set (i.e., on every successful
> install), because the negated test returns non-zero.

The trap repeats itself across files because the one-liner is shorter than
the `if` block. It is shorter; it is also wrong.

### Bad

```bash
set -e
[ ! -d "$REPO_DIR/extensions/$TIER/$EXT" ] && echo "Error: extension '$EXT' not found." && exit 1
do_install "$EXT"
```

### Good

```bash
set -e
if [ ! -d "$REPO_DIR/extensions/$TIER/$EXT" ]; then
  echo "Error: extension '$EXT' not found." >&2
  exit 1
fi
do_install "$EXT"
```

The explicit `if` block makes the failure path unambiguous and the success
path immune to the `set -e` trap. Send the error to `>&2` while you are
there.

A single-`&&` form (`[[ ! cond ]] && exit 1`) is the same family in lighter
form and gets the same treatment.

---

## Rule 4 — Defense-in-depth checks must verify their inputs

When a check fires only on a partial view of its input, the check passing
is not the same as the underlying invariant being true. Make checks
*independently verifiable* — surface the size of the input they actually
saw, so the next reader can spot a wedge upstream.

### Why

PR #39 (`scripts/prune-transcripts.sh`) shipped a pagination loop whose
termination condition (`count <= offset + len(drawers)`) misread the API
contract and exited after the first page. The script had a perfectly
correct format-mismatch escalation that fired on the 100 drawers it saw,
hiding the fact that 11 850 of 11 850 drawers in the wing had not been
scanned. Two review cycles missed the upstream wedge because the
downstream check kept producing an actionable error.

### Bad

```python
# Pagination loop: imagine it terminates after the first page (broken
# upstream — only 100 of 11 850 drawers scanned).
for drawer in drawers_seen_so_far:
    if not matches_format(drawer):
        skipped_format += 1

# This downstream check fires on the partial sample and looks correct.
# The user sees an actionable error message and concludes the script
# worked. The 11 750 unscanned drawers stay invisible — the wedge
# upstream is hidden because the downstream check refused to look past
# the slice it was handed.
if skipped_format == len(drawers_seen_so_far):
    sys.exit(3)  # silent on input size — silent on the wedge
```

### Good

```python
# Surface what was actually scanned, so a wedge upstream is visible.
# A reviewer comparing "Scanned: 100" against an expected wing size of
# ~10 000 catches the upstream pagination bug at a glance.
print(f"Scanned: {stats['total_scanned']} drawer(s)")
print(f"Format mismatch: {stats['skipped_format']}")
if stats["skipped_format"] == stats["total_scanned"] > 0:
    print("Error: 100% format mismatch on a sample of "
          f"{stats['total_scanned']} drawer(s).", file=sys.stderr)
    sys.exit(3)
```

A reviewer comparing "Scanned: 100" against an expected wing size of
~10 000 catches the upstream bug at a glance.

---

## Rule 5 — No Bash 4+ constructs in governed scripts

Scripts under `scripts/` and `hooks/` must run on the Bash that ships with
macOS — **3.2.57**, released in 2007 and still `/bin/bash` on a current
machine. The constructs declared in
[`ci/bash32-forbidden.txt`](../ci/bash32-forbidden.txt) are banned because that
shell does not have them:

| Construct | What Bash 3.2.57 does with it |
| --- | --- |
| `mapfile` | `mapfile: command not found` |
| `readarray` (synonym of `mapfile`) | `readarray: command not found` |
| `declare -A` (associative arrays) | `declare: -A: invalid option` |

That data file is the authority and this table mirrors it;
`scripts/tests/test-check-bash32-portability.sh` fails when the two drift apart.

A fourth trap is not grep-detectable, so it is deliberately absent from the
declared set — but it breaks a script just as thoroughly. Under `set -u`, Bash
3.2 treats an **empty array** as an unset variable, so `"${arr[@]}"` aborts when
`arr` is empty. Write `${arr[@]+"${arr[@]}"}` instead, or `${arr[*]:-}` where the
expansion is interpolated into a message string. This bites accumulator arrays
hardest, because an accumulator is empty on precisely the success path.

The array-guard rule is **enforced**, not merely recommended: the same
`check-bash32-portability.sh` pass scans every governed `*.sh` file for array
value expansions and fails when any is unguarded. Every `"${arr[@]}"` /
`"${arr[*]}"` value expansion must be guarded — the canonical form
`${arr[@]+"${arr[@]}"}` (drop the outer quotes; the guard carries its own), or
`${arr[*]:-}` when interpolated inside a double-quoted string. A literal
mention of an expansion in a comment or a grep pattern is not a use, but a
script that deliberately requires a newer shell tags the line with
`# acknowledged-exception: <reason>` and the check honours it.

### Why

`mapfile` and `declare -A` had spread into six of the repository's own test
suites. On a stock macOS shell each aborted partway through — and because a
`set -u` abort can leave a zero exit status, three of them printed a passing
count and exited **0** while silently never running their later cases:
`test-e2e-report.sh` reported `10 passed / 0 failed` with cases 7 and 8 never
executed at all. Across the six suites that shell ran 67 of the 117 verdicts a
newer shell ran, and reported no error while doing it. A maintainer working on
macOS was reading a false green. Issue #697, corrected under spec 0111.

### Bad

```bash
set -uo pipefail

mapfile -t dirs < <(find "$root" -type d | sort)   # aborts: no such builtin

declare -A WANT=( [claude]=a [gemini]=b )          # aborts: -A invalid option
want="${WANT[$cli]}"

for d in "${dirs[@]}"; do :; done                  # aborts when dirs is empty
```

### Good

```bash
set -uo pipefail

dirs=()
while IFS= read -r line || [ -n "$line" ]; do dirs+=("$line"); done \
  < <(find "$root" -type d | sort)

case "$cli" in                                     # a case, not a lookup table
  claude) want=a ;;
  gemini) want=b ;;
esac

for d in ${dirs[@]+"${dirs[@]}"}; do :; done       # empty-safe expansion
```

Keep a `case` arm's value a verbatim literal rather than deriving it from the
loop variable. An assertion that re-derives the convention it exists to pin
asserts nothing.

### Prose is not use

The check separates a construct a script *uses* from one it merely *names*, so
documenting the prohibition is never itself a violation. A construct counts as
used only when it stands in command position — at line start, after a command
separator (`;` `&` `|` `(` `)` `{` `}`), or after a shell keyword — on a line
whose first non-blank character is not `#`. These are all fine:

```bash
# `while read` rather than `mapfile` for bash 3.2 compat (macOS default).
collect_lines            # avoid mapfile here: it is a bash 4 builtin
```

As with every rule here, a script that deliberately requires a newer shell
tags the line with `# acknowledged-exception: <reason>` and the check honours it.

---

## Acknowledged exceptions

If a real reason justifies breaking one of these rules (e.g. a third-party
library that requires a bare `except`), tag the line:

```bash
# acknowledged-exception: vendored library raises bare strings, not exceptions
[ -f "$marker" ] && load_legacy "$marker" && exit 0
```

```python
# acknowledged-exception: aiohttp 3.x raises CancelledError as bare except path
try:
    await client.fetch(url)
except:  # noqa: E722
    cleanup()
    raise
```

The tag is greppable, so the exception is auditable. New tags should be
discussed in the PR.

---

## CI grep check

`.github/workflows/scripting-conventions.yml` runs a small `grep` pass on
`scripts/` and `hooks/` to flag new occurrences of the chained-test pattern
(Rule 3) and bare `except` (Rule 1), and invokes
`scripts/check-bash32-portability.sh` for the forbidden Bash 4+ constructs
(Rule 5). The same three run on GitLab, from the shared capability declaration
in `ci/ci-capabilities.yml`. The Rule 5 check is a script rather than an inline
`grep` block so a maintainer can run it locally — `task check-bash32-portability`
— and so its declared set lives in one data file instead of being hand-copied
per engine.

All three are intentionally lightweight; they do not try to be a full linter.
False positives are handled with the `acknowledged-exception` tag.
