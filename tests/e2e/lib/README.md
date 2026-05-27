# Assertion libraries

Three sourceable bash libraries that scenarios reach for to make claims
about a CLI's behaviour. Governed by
[ADR 0004](../../../docs/adr/0004-e2e-assertion-libs.md).

| Lib | When to use |
|---|---|
| `assert.sh` | **First choice.** Side-effect probes: file presence/content, exit codes, drawers in MemPalace, git refs pushed to a remote. Cheap, deterministic, easy to reason about. |
| `structural.sh` | **Second choice.** Structural shape probes: regex over stdout, JSON paths via `jq`, gitmoji-formatted titles. Use when the assertion is about the shape of an artefact, not its existence. |
| `llm_judge.sh` | **Last resort.** LLM-as-judge oracle for qualitative criteria a regex cannot express. Each call burns budget and adds non-determinism — reach for it only when the first two cannot answer the question. |

Every assertion returns `0` on PASS, `1` on FAIL, and PASS is silent.
FAIL emits a single TAP-compatible diagnostic block to stderr — a
`# FAIL` header line plus `expected`, `actual`, and `report` lines,
each truncated to 200 chars. The runner captures scenario stderr under
`${E2E_REPORT_DIR}/<cli>/<scenario>/stderr`.

## Sourcing pattern

```bash
# Inside a scenario script (issue #80 lands the scenarios):
set -euo pipefail
: "${E2E_LIB_DIR:?runner must export E2E_LIB_DIR}"
source "${E2E_LIB_DIR}/assert.sh"
source "${E2E_LIB_DIR}/structural.sh"
source "${E2E_LIB_DIR}/llm_judge.sh"
```

`E2E_LIB_DIR` and `E2E_REPORT_DIR` are exported by `tests/e2e/run.sh`
once issue #80 wires the runner-to-scenario plumbing.

## Reference

### `assert.sh` — side-effect assertions

```text
assert_file_exists <path>
assert_file_contains <path> <regex>            # POSIX ERE via `grep -E`
assert_file_absent <path>
assert_exit_code <expected> <actual>
assert_drawer_present <wing> <room> <regex>
assert_drawer_field <wing> <room> <handoff_key> <field> <expected>
assert_git_branch_pushed <remote> <branch>
```

The two MemPalace probes shell out to the `mempalace` binary on PATH.
They are designed for the `crewrig/e2e-mempalace:latest` image (where
MemPalace is pipx-installed); the scenario harness decides whether to
pre-spin a sidecar (P1) or run `docker run --rm` per probe (P2 — the
v1 default).

### `structural.sh` — structural assertions

```text
assert_stdout_matches <regex> [<file>]         # POSIX ERE; stdin or file
assert_json_shape <file> <jq_path> <expected>
assert_gitmoji_title <string>                  # PCRE: ^\p{Emoji}…
```

`assert_gitmoji_title` requires GNU grep with PCRE support — present in
the e2e Docker images (Debian bookworm, GNU grep 3.8) but NOT on macOS
hosts (BSD grep). Run the smoke for this assertion inside the image,
not on the host.

### `llm_judge.sh` — LLM-as-judge oracle

```text
llm_judge <prompt-file> <subject-file> <criterion>
# stdout: VERDICT=<PASS|FAIL|UNCERTAIN> confidence=<0.00-1.00>
# exit: 0 on PASS, 1 on FAIL, 0 on UNCERTAIN (default), 1 on UNCERTAIN (strict)
```

Configured via the `[judge]` table in `defaults.toml`:

```toml
[judge]
backend     = "anthropic"                     # Selects llm_judge_drivers/<backend>.sh
model       = "claude-sonnet-4-6"             # Overridable via local.toml
api_key_env = "ANTHROPIC_JUDGE_API_KEY"
strict      = false                           # UNCERTAIN warns; does NOT fail
temperature = 0.0                             # Forwarded to backend; deterministic default
max_calls   = 30                              # Per-run hard cap
```

#### Driver protocol

A backend is a sourceable file at
`tests/e2e/lib/llm_judge_drivers/<backend>.sh` that defines exactly two
functions, both prefixed `_llm_judge_driver_<backend>_`:

```text
_llm_judge_driver_<backend>_preflight
  stdin:  (none)
  stdout: single line "AUTH_TOKEN=<value>" on success, empty on failure
  return: 0 = ready
          2 = auth missing / unresolvable (core maps to UNCERTAIN; warn
              under strict=false, FAIL under strict=true)
          1 = hard failure (missing binary, unreachable mock, …) — core
              always exits 1, regardless of strict
```

```text
_llm_judge_driver_<backend>_call \
    <model> <endpoint> <auth> <max_tokens> <temperature> \
    <prompt> <subject> <criterion> [mock]
  stdout: single line "VERDICT=<PASS|FAIL|UNCERTAIN> CONF=<0.00-1.00>"
  return: 0 on parseable verdict; 1 on malformed output or persistent
          HTTP error (caller records the slot as UNCERTAIN).
```

The `<auth>` positional is opaque to the core — drivers that need no
secret (e.g. local Ollama) accept and ignore it. Drivers MUST emit a
`# WARN` line on stderr when `temperature != 0.0` is passed but the
backend does not honor it. Adding a new backend means dropping a new
driver file under `llm_judge_drivers/` and pointing `[judge].backend` at
it — no changes to `llm_judge.sh` core. See ADR 0007 for the rationale.

#### Prompt template

The judge composes a single user message per quorum slot:

```text
You are an LLM judge for an end-to-end test framework. Read the
PROMPT, SUBJECT, and CRITERION below, then respond with EXACTLY one
line in the form:

  VERDICT=<PASS|FAIL|UNCERTAIN> CONF=<0.00-1.00>

No prose, no markdown, no trailing text. CONF reflects your
confidence in the verdict, not in the subject.

PROMPT:
<contents of <prompt-file>>

SUBJECT:
<contents of <subject-file>>

CRITERION:
<criterion>
```

Three sequential calls with PASS/PASS and FAIL/FAIL early-exit. The
verdict is the 2-of-3 majority, or `UNCERTAIN` when no majority is
reached or ≥2 slots return malformed output after one HTTP retry.

#### `ANTHROPIC_JUDGE_API_KEY` is separate from `ANTHROPIC_API_KEY`

Both may point at the same upstream key value — the split is about
**accounting**, not secrecy. `ANTHROPIC_API_KEY` is mounted into the
Claude CLI container at scenario time; the judge runs on the host on
the framework's budget line. Keeping them separated lets ops bill,
throttle, or revoke them independently. Export both even if they hold
the same value:

```sh
export ANTHROPIC_API_KEY="sk-ant-…"
export ANTHROPIC_JUDGE_API_KEY="sk-ant-…"
```

#### Raising the `max_calls` cap

The default 30-call-per-run cap defends against a runaway scenario.
Counter lives at `${E2E_REPORT_DIR}/judge.count`; the wrapper refuses
new calls once the cap is reached and returns FAIL with a diag
pointing at the counter file. Raise it for a long-running suite via
`tests/e2e/local.toml`:

```toml
[judge]
max_calls = 100
```

Set `E2E_JUDGE_STRICT=1` (or `[judge].strict = true`) to upgrade
UNCERTAIN verdicts to hard failures — useful for the gating leg of CI.
