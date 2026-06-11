# ADR 0004 — e2e assertion libraries (side-effect + structural + LLM-judge)

## Status

Proposed — 2026-05-23. Scoped to issue #79 (child of epic #75). Builds
on ADR 0001 (Docker images), ADR 0002 (auth flow), ADR 0003 (runner +
TOML).

## Context

ADR 0003 ships the runner that turns the effective config into
`docker run` invocations per `(scenario, cli)` pair and emits TAP 13
to `tests/e2e/reports/<ts>-<rand>/run.tap`. Scenarios themselves are
plain bash scripts (populated by issue #80) that run inside a CLI's
e2e container, exercise the CLI, and exit 0/non-zero/78. The runner
maps the exit code to TAP `ok`/`not ok`/`# SKIP` lines.

What is still missing — and what this ADR specifies — is the
**assertion vocabulary** scenarios reach for: three sourceable bash
libraries with consistent signatures, uniform failure semantics, and
empirically grounded backend choices.

All MemPalace, grep, and Docker behaviors below were verified on
`crewrig/e2e-base:latest` and `crewrig/e2e-mempalace:latest`
(MemPalace 3.3.5, GNU grep 3.8) on 2026-05-23. Reproductions are
inline.

## Decision 1 — Uniform contract across the three libs

Every assertion follows the same five rules:

1. **Naming.** `assert_<noun>_<predicate>` (snake-case). The
   `llm_judge` function is the lone exception — it is a verb because
   it is an oracle, not an assertion.
2. **Return semantics.** `0` on PASS, `1` on FAIL. No other codes.
   Scenarios run under `set -euo pipefail`, so a FAIL short-circuits
   the scenario and the runner's existing exit-code dispatcher maps
   it to `not ok` (see ADR 0003 Decision 4 main loop).
3. **Failure diagnostic.** On FAIL, emit exactly one TAP-compatible
   diagnostic line to **stderr**, prefixed with the TAP diagnostic
   marker (hash followed by space):

   ```text
   # FAIL <assertion_name> <arg1> [<arg2>…]
   #   expected: <one-line expected snapshot>
   #   actual:   <one-line actual snapshot>
   #   report:   $E2E_REPORT_DIR/<cli>/<scenario>/<artefact>
   ```

   The runner captures scenario stderr to `<case_dir>/stderr` (ADR
   0003 line 300), so the diagnostic survives the run and can be
   surfaced verbatim under the TAP `not ok` line by issue #80's
   scenarios if desired.
4. **No PASS chatter.** PASS is silent. A scenario with 20 passing
   assertions produces zero stderr noise, keeping the report dir
   small and the TAP stream readable.
5. **`set -euo pipefail` safe.** Each library opens with the same
   sourcing-guard idiom used by `scripts/e2e/lib/auth-common.sh`
   (line 26: `set -o nounset`) and references all positional args
   with `${1:?missing arg}` style guards so accidental sourcing
   without arguments fails loud, not silent.

The runner exposes `E2E_REPORT_DIR` and `E2E_LIB_DIR` to every
scenario — see Decision 5 below.

## Decision 2 — `tests/e2e/lib/assert.sh` (side-effect assertions)

```bash
assert_file_exists <path>
assert_file_contains <path> <regex>           # POSIX ERE via `grep -E`
assert_file_absent <path>
assert_exit_code <expected> <actual>
assert_drawer_present <wing> <room> <regex>
assert_drawer_field <wing> <room> <handoff_key> <field> <expected>
assert_git_branch_pushed <remote> <branch>
```

`assert_git_branch_pushed` is `git ls-remote --exit-code --heads
<remote> <branch> >/dev/null`. The trailing six need no commentary;
the two MemPalace probes do.

### MemPalace integration — chosen path

**Recommendation: Option (a-thin), `mempalace search` against a
shared palace via the `crewrig/e2e-mempalace:latest` sidecar mounted
read-only into the scenario container, parsed with `grep -E`.**

Empirical verification of the CLI surface (2026-05-23):

```text
$ docker run --rm crewrig/e2e-mempalace:latest mempalace search --help
usage: mempalace search [-h] [--wing WING] [--room ROOM]
                       [--results RESULTS] query
```

The CLI surface is intentionally narrow: only `search` is wing/room-
scoped and stable. There is **no** `get-drawer`, `list-drawers`, or
`--output json` flag. The richer surface (`mempalace_get_drawer`,
`mempalace_list_drawers`, etc., per `60-tools.md`) lives on the
**MCP server** (`mempalace-mcp`), not the CLI.

This drove the design: rather than wrap a JSON-RPC client in bash
(option (c), rejected), exploit a property of the handoff drawer
convention already mandated by `60-tools.md`. Drawer content is
**structured plain text** with one `field: value` per line:

```text
[TASK:ongoing] <task-id> | <description>

writer_agent: <agent-name>
handoff_key: <task-id>
visible_to: ["*"]
status: <phase>
next: <what to do next>
```

So both probes degrade to a grep against the search output:

```bash
assert_drawer_present() {
  local wing="$1" room="$2" regex="$3"
  mempalace search "$regex" --wing "$wing" --room "$room" --results 5 \
    | grep -E -q "$regex"
}

assert_drawer_field() {
  local wing="$1" room="$2" handoff_key="$3" field="$4" expected="$5"
  mempalace search "$handoff_key" --wing "$wing" --room "$room" --results 1 \
    | grep -E -q "^${field}:[[:space:]]+${expected}[[:space:]]*$"
}
```

The scenario container reaches the `mempalace` binary by sharing the
sidecar's palace volume. Two execution paths exist; both are
acceptable, the choice is deferred to issue #80's scenario harness:

- **Path P1 (simpler):** the scenario `docker exec`s into the
  long-running `crewrig-e2e-mempalace` sidecar. Requires the sidecar
  to be `docker run -d` started by the runner before the first
  MemPalace-touching scenario. Adds one process-lifecycle concern.
- **Path P2 (sidecar-less):** the scenario `docker run --rm -v
  <palace-vol>:/home/agent/.mempalace/palace
  crewrig/e2e-mempalace:latest mempalace search …`. No long-lived
  process; ~1–2 s container spin-up per probe (same cost profile as
  `e2e_chown_bootstrap` in ADR 0002).

P2 is the v1 default — fewer moving parts, no sidecar lifecycle in
the runner. P1 is documented as the optimization path if probe count
per scenario climbs above ~5.

### Rejected MemPalace options

- **Option (b), direct host-PATH `mempalace`.** The brief notes
  `pipx install mempalace` runs as part of `setup-mempalace`. True,
  but the host palace is the *user's real palace* — scenarios must
  never mutate or query it. The sidecar's isolated palace volume is
  the only safe target.
- **Option (c), MCP-server JSON-RPC from bash.** Implementing a
  stdio JSON-RPC client in bash is doable but adds ~80 lines of
  framing, a tool/method registry, and a new failure mode (server
  cold-start). Pay this cost only when an assertion genuinely needs
  fields that the plain-text grep cannot reach.

## Decision 3 — `tests/e2e/lib/structural.sh` (structural assertions)

```bash
assert_stdout_matches <regex>                 # reads from stdin
assert_json_shape <file> <jq_path> <expected>
assert_gitmoji_title <string>
```

`assert_stdout_matches` reads from **stdin only**. Rationale: the
universal call-site is `<command> | assert_stdout_matches '<re>'`,
which is one token shorter and one process lighter than the
file-argument variant. If a scenario needs to assert against a file
on disk, the existing `assert_file_contains <path> <regex>` covers
it. Two overloads for one shape is API noise.

`assert_json_shape` shells to `jq -e --arg e "$expected" \
"$jq_path == \$e" "$file"` and treats `jq`'s natural exit code as
the assertion's. `jq -e` returns 1 on a `false`/`null` result, 0 on
a truthy result — the desired contract for free.

`assert_gitmoji_title` enforces the AGENTS.md naming convention. The
issue body specifies `^\p{Emoji}` which is a PCRE class. Empirical
verification (2026-05-23, `crewrig/e2e-base:latest`):

```text
$ docker run --rm crewrig/e2e-base:latest \
    bash -c 'echo "🐳 test" | grep -P "^\p{Emoji}"; echo "exit=$?"'
🐳 test
exit=0
```

GNU grep 3.8 in Debian bookworm is PCRE-enabled — `\p{Emoji}` works
out of the box. Implementation:

```bash
assert_gitmoji_title() {
  local title="$1"
  printf '%s' "$title" | grep -P -q '^\p{Emoji}[\p{Emoji_Modifier}\p{Emoji_Component}]*\s+\S'
}
```

The class allows ZWJ sequences and the trailing space-then-text shape
the convention requires (e.g. `✨ Add foo`, `🤖 Generated …`). If PCRE
support is ever stripped from the base image (open risk #2 below),
the fallback is an explicit code-range character class — kept out of
the v1 implementation to avoid maintaining a moving target.

## Decision 4 — `tests/e2e/lib/llm_judge.sh` (LLM-as-judge wrapper)

```bash
llm_judge <prompt-file> <subject-file> <criterion>
# stdout (single line): "<verdict> <confidence>"
#   verdict    ∈ {PASS, FAIL, UNCERTAIN}
#   confidence ∈ [0.0, 1.0]   (mean over the calls that ran)
# exit code: 0 on PASS, 1 on FAIL, 2 on UNCERTAIN.
```

### Backend wiring + new `[judge]` TOML section

`tests/e2e/defaults.toml` gains:

```toml
[judge]
backend         = "anthropic"                     # only value supported in v1
model           = "claude-sonnet-4-5-20250929"    # versioned, not alias
api_key_env     = "ANTHROPIC_JUDGE_API_KEY"       # separate from runtime key
endpoint        = "https://api.anthropic.com/v1/messages"
max_tokens      = 256
strict          = false                           # UNCERTAIN does NOT fail
per_call_cap    = 30                              # max llm_judge calls per run
```

Rationale for a separate `ANTHROPIC_JUDGE_API_KEY`:

- The runtime key (`ANTHROPIC_API_KEY`) is mounted into the Claude
  CLI container and may be a long-lived OAuth-derived token (ADR
  0002 Decision 1). The judge runs on the host, not in the
  container; mixing the keys conflates two failure surfaces and two
  billing lines.
- Per-call cap defends against runaway scenarios. The runner
  maintains a single counter per `run.sh` invocation, persisted to
  `${E2E_REPORT_DIR}/judge.count`. Calls past the cap return
  `UNCERTAIN 0.0` with a `# FAIL llm_judge: per-run cap exceeded`
  diag. Cap is opt-out via `--no-judge-cap` on the runner.

### Quorum strategy — 3 sequential calls with early exit

**Recommendation: sequential, with PASS/FAIL early-exit.** Make call
1; if PASS, make call 2. If both PASS, return `PASS` without call 3.
Symmetric for FAIL. If call 1 and call 2 disagree, make call 3 and
take the majority.

Trade-off rationale:

| | Sequential (recommended) | Parallel |
|---|---|---|
| Latency | 1–3 × call (mean 2.0 ×) | 1 × call |
| Cost | 2–3 calls (mean 2.3) | 3 calls |
| Error handling | Sequential `set -e` | Wait+collect, partial failures |
| Bash complexity | ~30 lines | ~60 lines + `wait`/`jobs -p` |

A judge call is ~2–5 s wall-clock. Parallel saves ~5 s per judged
assertion but adds ~30 lines of error-handling that we get wrong
twice before getting it right. Sequential's early-exit recovers
~33 % of the cost when the model is confident — the common path —
and keeps the code reviewable in one screen.

### UNCERTAIN semantics

- All three calls disagree (one PASS, one FAIL, one of either —
  no 2-of-3 majority): `UNCERTAIN`, confidence = mean of all three
  parsed confidences.
- Any call returns malformed output (no extractable verdict): treat
  as `UNCERTAIN` for that slot. If two of three slots are malformed,
  the overall result is `UNCERTAIN`.
- HTTP error / network failure on a single call: retry once with a
  1 s backoff, then count as a malformed slot (UNCERTAIN slot, not
  hard fail). This keeps a flaky network from masquerading as a
  semantic FAIL.

### `strict` mode

`E2E_JUDGE_STRICT=1` (env override) or `[judge].strict = true` (TOML)
upgrades UNCERTAIN to FAIL. Default is `false` (UNCERTAIN warns via
the standard diag block but the assertion returns 0). Rationale: in
the default mode the judge is advisory; promoting it to a gate is
the scenario author's explicit choice, not the framework's default.

### Request shape (Anthropic Messages API)

```bash
curl -sS -X POST "$endpoint" \
  -H "x-api-key: $key" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d "$(jq -n --arg model "$model" \
              --arg prompt "$prompt" \
              --arg subject "$subject" \
              --arg criterion "$criterion" \
              --argjson maxtok "$max_tokens" '
    { model: $model,
      max_tokens: $maxtok,
      messages: [
        { role: "user",
          content: ($prompt + "\n\nSUBJECT:\n" + $subject
                    + "\n\nCRITERION:\n" + $criterion
                    + "\n\nRespond with exactly one line: " +
                    "VERDICT=<PASS|FAIL|UNCERTAIN> CONF=<0.0-1.0>") }
      ] }')"
```

Parsed by `jq -r '.content[0].text'` → `grep -oE
'VERDICT=\S+ CONF=\S+'` → split on `=` and ` `. The structured
response contract (`VERDICT=…  CONF=…`) is the prompt's
responsibility; malformed output downgrades the slot to UNCERTAIN
per the rules above.

Shape verified against the Anthropic public docs (Messages API,
endpoint, version header, request body fields) — see Sources. The
exact model identifier should be re-confirmed against
[platform.claude.com](https://platform.claude.com/docs/) at
implementation time; treat the version pin as a `# TODO: confirm`
on the developer's plate, not a hard fact of this ADR.

## Decision 5 — Runner integration (no `run.sh` change for #79)

Scenarios source the three libs through a fixed entry-point pattern:

```bash
# Inside a scenario script (issue #80):
set -euo pipefail
: "${E2E_LIB_DIR:?runner must export E2E_LIB_DIR}"
source "${E2E_LIB_DIR}/assert.sh"
source "${E2E_LIB_DIR}/structural.sh"
source "${E2E_LIB_DIR}/llm_judge.sh"
```

`E2E_LIB_DIR=/path/to/tests/e2e/lib` and `E2E_REPORT_DIR=/path/to/
tests/e2e/reports/<run-id>` are exported by `tests/e2e/run.sh`
**when #80 lands**. Both are unset in #79's runner, which is
expected: #79 ships the libraries, #80 wires the runner to expose
them and to mount them into the scenario container. The libraries
themselves degrade cleanly when sourced standalone (they reference
no env var at source time, only at call time, and only inside the
diagnostic block).

This deliberately keeps `run.sh` **untouched by #79** — the only
files this ticket lands are the three `lib/*.sh` files, the
`[judge]` section in `defaults.toml`, the assertion test harness
under `scripts/tests/`, and this ADR.

## Decision 6 — Failure diagnostic format

Every failing assertion emits exactly one block on stderr:

```text
# FAIL <assertion_name> <argv joined by space>
#   expected: <single-line snapshot, truncated to 200 chars + "…">
#   actual:   <single-line snapshot, truncated to 200 chars + "…">
#   report:   ${E2E_REPORT_DIR:-<unset>}/<cli>/<scenario>/<artefact>
```

The 200-char truncation prevents a multi-MB JSON file from poisoning
the TAP stream. The `report:` line is omitted when `E2E_REPORT_DIR`
is unset (standalone sourcing for tests). All three libs share one
private helper `_e2e_assert_diag <name> <expected> <actual>
[<artefact>]` to enforce the format.

## Open risks

1. **LLM-judge non-determinism even with quorum.** A 2-of-3 majority
   on a borderline qualitative check can flip run-to-run. Mitigated
   by `strict=false` default — borderline cases emit a warning, not
   a failure. Track quorum-disagreement rate over the first quarter
   of usage; if >5 % of judged assertions hit UNCERTAIN, revisit
   prompt design before tightening the gate.
2. **PCRE `\p{Emoji}` support drift.** Pinned to GNU grep 3.8 in
   `crewrig/e2e-base` (Debian bookworm). If a future base-image bump
   strips PCRE or moves to BusyBox grep, `assert_gitmoji_title`
   breaks silently (PCRE class becomes literal). Mitigation: the
   library test suite (#3 in the team plan) MUST include a positive
   smoke against `🐳 test`; CI red-on-bump catches it.
3. **MemPalace CLI surface is narrow and unversioned.** `mempalace
   search` is the only wing/room-scoped CLI verb in 3.3.5. A future
   MemPalace release could change flag names or output format
   silently. Mitigation: pin the sidecar image tag (already done in
   ADR 0001 — `crewrig/e2e-mempalace:latest` is a project-controlled
   build, not an upstream pull); a `mempalace --version` smoke in
   the library test suite catches version drift at PR time, not at
   run time.
4. **Cost runaway via `llm_judge`.** Per-run cap (30 by default)
   defends against a scenario in a loop. The cap is per-run, not
   per-scenario; a single scenario could in principle consume the
   whole budget. Acceptable for v1 — the cap exists to bound
   blast-radius, not to ration fairly. Revisit if scenarios start
   competing for budget.
5. **Sourcing-order coupling.** All three libs share the private
   `_e2e_assert_diag` helper. The first library sourced defines it;
   subsequent sources re-define it (bash allows function
   redefinition silently). Identical definitions across the three
   files keep this benign, but a future edit to one copy without the
   others would create a silent divergence. Mitigation: extract the
   helper into a tiny `tests/e2e/lib/_diag.sh` sourced by each lib
   if the rule is violated even once.

## Blast radius

New files only:

- `tests/e2e/lib/assert.sh`
- `tests/e2e/lib/structural.sh`
- `tests/e2e/lib/llm_judge.sh`
- `scripts/tests/test-e2e-assert-lib.sh` (and siblings — tester's
  call)
- This ADR.

Modified files:

- `tests/e2e/defaults.toml` — add the `[judge]` section per
  Decision 4. Additive; the runner ignores unknown top-level tables
  (verified by inspection of `run.sh` lines 137–149 — only
  `.scenarios` and `.cli` are read).

Explicitly NOT modified by #79:

- `tests/e2e/run.sh` — runner integration deferred to #80.
- `scripts/e2e/lib/auth-common.sh` — no new helpers needed; the
  assert libs do not need auth.
- `docs/cli-matrix.md` — assertion libs are CLI-agnostic
  infrastructure (no per-CLI behavior). No parity row required.
- `community-config/**` — assertion libs are runtime test code, not
  shipped skills/agents. The `check-components` job and the
  version-bump rule do not apply.

Reversibility: **trivial**. Every artifact is additive and gated
behind explicit `source` from a scenario that does not yet exist
(scenarios land in #80). Removing the three files would be a clean
revert with no downstream consumers.

## Sources

- Issue #79 acceptance criteria — <https://github.com/Sfeir/crewrig/issues/79>
- Anthropic Messages API reference — <https://platform.claude.com/docs/en/build-with-claude/working-with-messages>
- MemPalace 3.3.5 CLI — verified inline via `docker run --rm
  crewrig/e2e-mempalace:latest mempalace --help` (2026-05-23).
- GNU grep PCRE `\p{Emoji}` — verified inline against
  `crewrig/e2e-base:latest` (2026-05-23).
- ADR 0001 (e2e Docker images) — `docs/adr/0001-e2e-docker-images.md`
- ADR 0002 (e2e auth flow) — `docs/adr/0002-e2e-auth-flow.md`
- ADR 0003 (e2e runner + TOML) — `docs/adr/0003-e2e-runner-toml.md`
- `scripts/e2e/lib/auth-common.sh` — helper-naming convention + exit-78 SKIP.
- `tests/e2e/run.sh` — scenario exit-code dispatch (lines 298–322).
- Long-running task convention (drawer payload schema) —
  `60-tools.md` → *Long-Running Task Convention*.
