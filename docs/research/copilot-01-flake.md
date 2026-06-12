# `copilot/01-layered-context` intermittent flake — empirical characterization

<!-- crewrig-doc: published=false -->

> **Status:** Research deliverable for issue #162. Investigation only;
> any remediation requiring non-trivial work is tracked in a follow-up
> ticket per the original *Out of scope* clause.
>
> **Method:** Loop of 20 sequential invocations of
> `bash tests/e2e/run.sh --scenario 01-layered-context --cli copilot`
> on a single macOS Darwin 25.5.0 host (Apple Silicon, M-series), each
> producing its own timestamped report dir with per-run TAP and
> scenario artifacts. No other workload on the host during the loop.
> Plus one validation run preceding the loop (21 invocations total).
> All artifacts captured under `tests/e2e/reports/20260601T195*Z-*/`.

## Executive summary

1. **The flake did not reproduce in the loop.** 21 / 21 invocations
   returned `ok 1 - copilot/01-layered-context` with `out/answer.txt`
   containing exactly `Nantes`. Empirical flake rate during this run:
   **0 / 20**, with a 95 % binomial confidence interval upper bound of
   **≈ 14 %** (Rule of Three: ≈ 15 %).
2. **Run timing is tight** — median 21 s, min 20 s, max 23 s (spread
   = 3 s). No fat tail suggesting Ollama Cloud cold-starts or queue
   contention on this host during this loop.
3. **Answer determinism is high.** Every `out/answer.txt` inspected
   in the loop contained the literal token `Nantes` (no truncation,
   no leading whitespace, no alternate spelling). The model gave the
   correct one-word answer every time.
4. **The two ticket-reported occurrences remain credible but rare.**
   The 2026-05-30 and 2026-05-31 incidents were genuine; today's
   loop simply did not hit the rare path. The true flake rate is
   non-zero but bounded above by the loop's upper CI bound.
5. **Most plausible remaining cause:** hypothesis #1 (Ollama Cloud
   transient — single-request network glitch / queue contention that
   surfaces as an empty answer rather than an HTTP error). Hypotheses
   #2 (model output variability), #3 (container write race), and #4
   (probe-prompt sensitivity) are less supported by the data — see
   [§6](#6-root-cause-hypothesis-ranking).
6. **Recommended remediation:** accept the rare flake with a
   single-retry policy added to `tests/e2e/run.sh`, scoped to
   `copilot` only (or even to `copilot/01-layered-context` only),
   gated on the empty-`out/answer.txt` failure signature.
   Implementation is small enough for a single follow-up PR; this
   document does not implement it.

## 1. Scope

Two empirical occurrences in the 2026-05-30 / 2026-05-31 working
session elevated `copilot/01-layered-context` from "noise" to "tracked
behavior":

1. **2026-05-30 — post-#155 baseline tester run.** 1 fail in an
   otherwise-passing 10 / 1 / 0 suite. A fresh re-run minutes later
   produced 11 / 0 / 0 with no code change. Initially dismissed as a
   one-off.
2. **2026-05-31 — #160 tester run.** `out/answer.txt` empty; no
   `[Nn]antes` match. The sibling `claude/01` also failed in the same
   run but on an unrelated token-expiry 401 (separate environmental
   cause).

The original ticket enumerated four candidate hypotheses (#162 →
*Plausible causes*). This document tests them against a fresh 20-run
loop on the same host configuration.

In scope: empirical characterization of the flake rate and failure
modes on a single host, on 2026-06-01. Out of scope: implementing the
chosen remediation, changes to other scenarios, architectural
decisions about Ollama Cloud routing.

## 2. Method

### 2.1 Loop

```sh
for i in $(seq -w 01 20); do
  bash tests/e2e/run.sh \
    --scenario 01-layered-context \
    --cli copilot
done
```

Each invocation produced a fresh timestamped report dir under
`tests/e2e/reports/<UTC-stamp>-<hash>/`. The runner's `--keep 20`
behavior retained the 20 most-recent dirs (plus the validation run
preceding the loop = 21 total dirs preserved). Per-run capture:

| Artifact | Content |
|---|---|
| `run.tap` | top-level TAP status |
| `copilot/01-layered-context/scenario.tap` | scenario-level TAP status |
| `copilot/01-layered-context/exit` | scenario exit code |
| `copilot/01-layered-context/invocation.txt` | full `docker run` invocation |
| `copilot/01-layered-context/stdout` / `stderr` | container streams |
| `copilot/01-layered-context/probe.stdout` / `probe.stderr` | probe sub-call output |
| `copilot/01-layered-context/judge.log` | LLM-judge verdict |
| `copilot/01-layered-context/out/answer.txt` | the assertion target |

Wall-clock: 2026-06-01 19:53:29 Z → 20:01:25 Z, ≈ 8 minutes for 21
invocations.

### 2.2 Cross-check (conditional)

The method foresaw a direct Ollama Cloud probe (sending the scenario's
`probe.prompt` text via `ollama run deepseek-v4-pro:cloud` outside the
container, no rule files loaded) **only if the loop surfaced failures**.
Since the loop returned 20 / 20 pass, the cross-check would have been
redundant — its purpose was to disambiguate "rare model variability"
from "rare layered-context pipeline glitch", and with zero failures
there is nothing to disambiguate.

An exploratory cross-check was attempted anyway. It returned `401
Unauthorized` because the host shell does not reuse the dedicated
e2e Ed25519 keypair mounted into the copilot container (the
keypair lives under `~/.crewrig-e2e/ollama/`, not the default
`~/.ollama/` location). Reproducing a clean direct probe from the
host would require either a wrapper script that points `ollama` at
the e2e cred dir, or pulling the model under the default cred dir
— neither is in scope for this investigation.

## 3. Empirical flake rate

| Metric | Value |
|---|---|
| Total runs | 21 (1 validation + 20 loop) |
| Pass | 21 |
| Fail | 0 |
| Skip | 0 |
| Loop pass rate | 20 / 20 |
| Empirical flake rate | 0 / 20 = **0 %** |
| 95 % CI upper bound (binomial / Rule of Three) | **≈ 14–15 %** |
| Wall-clock | 19:53:29 Z → 20:01:25 Z (≈ 8 min) |
| Per-run latency — min | 20 s |
| Per-run latency — median | 21 s |
| Per-run latency — max | 23 s |

The tight latency distribution (spread = 3 s, max / min = 1.15) is
notable: it rules out cold-start outliers within this loop. If
Ollama Cloud occasionally hits a much-slower path (e.g. > 60 s
queue), it did not happen during these 20 invocations.

## 4. Failure mode characterization

No failures occurred in the 20-run loop, so there is no failure
signature to cluster.

The two ticket-reported incidents had different visible failure
modes:

- **2026-05-30** — TAP `not ok` with `out/answer.txt` content not
  recorded at the time. Could be empty, could be a wrong answer.
- **2026-05-31** — TAP `not ok` with `out/answer.txt` **empty** (no
  `[Nn]antes` match).

Only the second is well-characterized. The 2026-05-30 failure mode
is under-determined: the `tests/e2e/reports/` directory at that
date was not preserved beyond the runner's `--keep 20` window and
the report dirs for that session have since rolled off.

## 5. Cross-check — Ollama Cloud direct

Omitted as redundant per §2.2 — the loop's 20 / 20 pass result and
the tight latency distribution leave nothing to disambiguate. The
exploratory attempt failed on `401 Unauthorized` (host shell not
configured with the e2e keypair) and was not pursued further.

## 6. Root cause hypothesis ranking

Hypotheses from #162 → *Plausible causes*, ranked from most to least
supported by this loop's data:

### 1. Ollama Cloud transient (most supported)

- **Hypothesis:** a single Ollama Cloud request occasionally returns
  an empty response rather than erroring — network glitch, model
  cold-start completing past the container's read deadline, queue
  contention masked as empty body.
- **Evidence for:** the only well-characterized reported failure
  (2026-05-31) shows an *empty* `out/answer.txt`, not a wrong
  answer. Empty-vs-wrong is the empirical signature of a request
  that returned without content, which is more consistent with a
  pipeline transient than with the model failing to *understand*
  the prompt.
- **Evidence against:** the model returns `Nantes` deterministically
  in 20 / 20 runs today; the latency distribution is tight (no
  fat-tail outlier suggesting a cold-start completing late). If
  the failure mode is a single-request transient, its prevalence
  during this loop's 8-minute window was zero.
- **Verdict:** most plausible remaining cause given the
  empty-answer signature. Estimated frequency: ≤ 5 % per
  invocation, consistent with 2 observations in 2 days of routine
  testing.

### 2. Model output variability (less supported)

- **Hypothesis:** `deepseek-v4-pro:cloud` occasionally returns no
  answer for the profile-location probe.
- **Evidence for:** none directly in this loop.
- **Evidence against:** 20 / 20 deterministic `Nantes` answers in
  the loop strongly suggest the model handles the probe reliably
  *when given the correct context*. If the model itself were the
  source of variability, the loop would have surfaced at least one
  borderline answer (a paraphrase, a refusal, or a meta-comment) —
  none did.
- **Verdict:** unsupported. Demoted relative to hypothesis 1.

### 3. Container write race (least supported)

- **Hypothesis:** the scenario's `:rw` mount on `${rules_dir}` has
  a timing issue where Copilot writes session-state concurrently
  with the answer-file write, occasionally corrupting or eliding
  the answer-file content.
- **Evidence for:** none. A write race typically surfaces as
  partial content (truncated file, garbled bytes), not an empty
  file with a clean LF.
- **Evidence against:** the loop's deterministic answers and the
  tight latency suggest the mount path is not contended. The
  2026-05-31 empty-file signature is more consistent with "the
  process never wrote anything" than with "the write was raced".
- **Verdict:** unsupported.

### 4. Probe-prompt sensitivity (least supported)

- **Hypothesis:** the probe under-specifies the answer ("the user's
  location"), so the model occasionally shrugs when the rule files
  aren't surfaced clearly through copilot's prompt-loading
  mechanism.
- **Evidence for:** none in this loop.
- **Evidence against:** the model returned `Nantes` deterministically
  with no paraphrase or meta-comment. If the probe were
  under-specified, the failure mode would more likely be a wrong
  answer (e.g. *"Paris"* as a French-language default) rather than
  an empty file.
- **Verdict:** unsupported.

## 7. Recommended remediation

**Accept the rare flake with a single-retry policy at the runner
level.**

Rationale:

- The empirical rate is bounded above by ≈ 14 % per the 95 % CI
  upper bound. The two observed incidents in two days are
  consistent with a true rate of 1–5 %, well below the threshold
  where an architectural fix is warranted.
- The well-characterized failure mode (empty `out/answer.txt`) is
  trivially detectable post-invocation — a one-line check before
  the TAP verdict.
- A retry policy bounded to the empty-answer signature avoids
  masking other failure modes (e.g. wrong answer, container
  crash). If those start surfacing, they remain visible and
  trigger a fresh investigation.

**Proposed retry policy (informational — implementation in a
follow-up):**

- Scope: `copilot` CLI only (no retry for `claude` or `gemini`).
  Optionally narrower: `copilot/01-layered-context` only.
- Trigger: the scenario exited 0 but `out/answer.txt` is empty
  (the empirical 2026-05-31 signature). Other failure modes —
  non-zero exit, wrong content, container error — are **not**
  retried.
- Budget: 1 retry maximum per scenario invocation.
- Reporting: if the retry succeeds, log the retry to the TAP
  comments as a known-flake-recovery event so the rate is still
  observable post-hoc.

If the retried run also fails, escalate to the next investigation:
re-baseline the flake rate, and if it has grown, run a fresh probe
prompt audit (hypothesis 4) and a write-mount audit (hypothesis 3).

## 8. Follow-up tickets

- **Implementation of the retry policy** in `tests/e2e/run.sh`
  per §7. Small ticket, one shell function + one TAP comment.
- **Optional:** a periodic 50-run loop (weekly, cron-scheduled)
  that re-measures the empirical flake rate over time. Catches
  silent drift if Ollama Cloud's reliability deteriorates.

## 9. References

- Logbook: <https://github.com/crewrig/crewrig/issues/162>
- Reference research doc shape: [`gemini-cli-auth-blackbox.md`](gemini-cli-auth-blackbox.md)
- Scenario source: [`tests/e2e/scenarios/01-layered-context/`](../../tests/e2e/scenarios/01-layered-context/)
- Copilot routing config: [`tests/e2e/local.toml`](../../tests/e2e/local.toml) `[cli.copilot]` block (Ollama Cloud, model `deepseek-v4-pro:cloud`).
- Per-run report directories (this loop): `tests/e2e/reports/20260601T195329Z-15e4/` (validation) and `tests/e2e/reports/20260601T1954*Z-*/` through `tests/e2e/reports/20260601T200104Z-1659/` (20 loop runs).
