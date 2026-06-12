# Design note — #148 Gemini auth capture redesign

<!-- crewrig-doc: published=false -->

> **Scope:** Redesign `scripts/e2e/auth-gemini.sh` and `tests/e2e/defaults.toml [cli.gemini]` so that the e2e harness captures every load-bearing artifact of a healthy `~/.gemini/` and ships it into the container through a writable copy. Runner cleanup (`run.sh`, `e2e_gemini_refresh_access_token`, `timeout` wrapper) is **out of scope** — owned by #149.

Grounded entirely on `docs/research/gemini-cli-auth-blackbox.md` (#147). Section references below point into that document.

---

## Decision 1 — Capture scope: whatever the sandboxed login writes, minus a denylist

> **Revision (post-developer-feedback).** The original wording of this decision implied a `cp -R "$HOME/.gemini/."` from the developer's host Gemini directory into `$DIR`. That reading is incorrect and was retracted. The interactive login MUST stay sandboxed — the docker mount remains `-v "${DIR}:/home/agent/.${CLI}"` (as in the pre-#148 script), so the test-account login writes into `$DIR` and never touches the developer's host `~/.gemini`. The "capture" is therefore not a copy at all; it is **what the sandboxed login produced**, with a small denylist applied as cleanup of leftover files from previous runs.

**Choice.**

1. Keep the original sandboxed login mount: `docker run -v "${DIR}:/home/agent/.${CLI}" "$IMAGE" gemini`. Login writes directly into `$DIR`.
2. After the login container exits, apply the **denylist as cleanup** to `$DIR`:
   - `antigravity-browser-profile/` (~18k Chromium cache files if browser is seeded — §2)
   - `antigravity/` (sibling browser profile)
   - `tmp/` (transient session scratch — §2)
   - `*.bak`, `*.ori`, `*.orig` (Bucket D leftovers — §2.4)
3. Take **no action** on `history/`, MCP configs, or `.env` — these will not appear in a sandboxed login because the sandbox has no prior history, no installed MCP servers, and no user `.env`. If a future sandbox seeds any of them, re-evaluate then.

**Why.** Three points settle the question:

- **Privacy is non-negotiable.** The pre-#148 design isolated the test account from the developer's personal Google session. Breaking that isolation is a behavior regression, not a refactor.
- **The sandboxed bundle is empirically sufficient.** #147 §4.2 Test C and Test D both passed using a bundle produced by the sandboxed login (mounted `:ro`, copied container-side, `oauth-personal` headless). The four files I originally worried about (`gemini-credentials.json`, `extension_integrity.json`, `acknowledgments/agents.json`, `google_account_id`) are absent from the sandboxed `$DIR` because they reflect **host-side** state (extension installs, machine-bound encrypted blobs, prior consent) — state that is equally absent from the e2e scenario container. If they are not in `$DIR`, they cannot be load-bearing for the scenario. Decision 7 #1 (tester re-runs Test E on the stable mount) closes the loop empirically.
- **Future-proofing still works.** The denylist captures whatever the sandboxed login writes *by default* — if a future Gemini CLI version writes new artifacts during login, they land in `$DIR` automatically. This is the original future-proofing intent; only the source location was wrong.

**Blast radius for developer.**

- Revert the mount in `auth-gemini.sh` back to `-v "${DIR}:/home/agent/.${CLI}"`.
- Remove the `cp -Rp "${HOST_GEMINI}/." "${DIR}/"` line and the `HOST_GEMINI` variable.
- Keep the denylist `rm -rf` + `find ... -delete` block; it applies to `$DIR` as cleanup (the directory may carry leftovers from a previous `task e2e:auth:gemini` run).
- Keep the `chmod 700 "$DIR"` and the broadened API-key grep — both remain correct under the sandboxed model.
- Keep the post-flight `oauth_creds.json` + `settings.json` existence check; anything else missing is still a host weirdness, not a login-flow failure.

---

## Decision 2 — Container-side mount-and-copy: inline `bash -c` in TOML (Option A)

**Choice.** Embed the copy-then-exec sequence directly in `tests/e2e/defaults.toml [cli.gemini].command`, matching the exact shape of #147 §5:

```toml
command = [
  "bash", "-c",
  "mkdir -p /home/agent/.gemini && cp -R /run/gemini-creds/. /home/agent/.gemini/ && chown -R agent:agent /home/agent/.gemini 2>/dev/null || true; exec gemini \"$@\"",
  "sh"
]
```

**Why.** Three reasons rule out the alternatives:

1. **Parity with the existing Ollama workaround in `tests/e2e/local.toml`.** That file uses the same `bash -c "...; exec ..."` shape for the Ollama keypair mount (verified in `local.toml.example`). Two divergent patterns for the same problem class fragments the mental model.
2. **Debuggability without rebuilding the image.** A helper script shipped in `crewrig/e2e-gemini:latest` (Option B) requires a Docker image rebuild whenever the bootstrap changes. Inline TOML edits land in seconds and survive `task e2e:test` without `task e2e:build:gemini`.
3. **Single-source-of-truth for the contract.** With the command inline, reading `defaults.toml [cli.gemini]` tells the full story of how the container boots. Option B splits the truth between TOML and Dockerfile; Option C splits it between TOML and a helper. The command is 4 statements — not big enough to justify the split.

The string is ugly. We accept the ugliness; it is bounded and self-documenting in context.

**Blast radius for developer.** Quote `\"$@\"` carefully — the existing `timeout 120 gemini \"$@\"` uses the same TOML-escaping pattern, model on it. The trailing `"sh"` is `$0` for `bash -c` (sets `argv[0]` for any error messages from inside the wrapper); preserve it.

---

## Decision 3 — `settings-headless.json` shadow mount: **drop**

**Choice.** Remove the `settings-headless.json` generation block from `auth-gemini.sh` (lines starting `HEADLESS_SETTINGS=`) and the matching mount line from `defaults.toml`.

**Why.** Concur with #147 §6.1 #3. Test D (§4.2) empirically demonstrated that with the fix pattern in place, `oauth-personal` authenticates headless `gemini -p` invocations without env injection. The `{}`-shadow was a workaround for the `:ro` write-hang misdiagnosed as a WebSocket bug (§ Executive summary #3) — once writes succeed, the shadow buys nothing. Keeping a dead workaround as "harmless fallback" (the current comment claims) just delays the next person's mental-model load.

**Blast radius for developer.** Both files change: delete the `printf '{}\n' > "$HEADLESS_SETTINGS"` block including its preceding `e2e_info` line in `auth-gemini.sh`, and delete the `settings-headless.json:/home/agent/.gemini/settings.json:ro` mount line in `defaults.toml`. Existing developer e2e dirs will retain a stale `settings-headless.json` file — harmless, swept up next time they delete `~/.crewrig-e2e/gemini/`.

---

## Decision 4 — Permission model & secrecy posture

**Choice.**

| Concern | Rule |
|---|---|
| Dir mode | `auth-gemini.sh` ends with `chmod 700 "$DIR"` after capture |
| File modes | Normalized by `auth-gemini.sh` (`find … -type f -exec chmod 600`, `find … -type d -exec chmod 700`) after the denylist; container-side bootstrap uses `cp -a` (not `cp -R`) so modes survive the copy. Earlier wording claimed `cp -R` preserved modes — that claim was incorrect (security review on issue #148, Med-3 — see https://github.com/crewrig/crewrig/issues/148#issuecomment-4583250693). |
| `.gitignore` | **Not needed.** `~/.crewrig-e2e/` lives outside the repo root by design (per `e2e_cli_dir` in `auth-common.sh`). Defense-in-depth gitignore line is unnecessary noise. |
| README warning | Add a short note to the script's existing "Authenticated. Credentials persisted under $DIR." line: `"Bundle contains a long-lived OAuth refresh token. Treat ${DIR} like ~/.ssh — host-only, never sync to cloud storage, never ship in container images."` |

**Why.** The §8 `baseline.fs.txt` artifact shows `~/.crewrig-e2e/gemini/` at `drwxrwxrwx` today — readable by any other user on a shared dev box. The bundle's `oauth_creds.json` contains a refresh token good for the full Google account lifetime; `0700` on the parent dir is the minimum civilized posture. We do not encrypt at rest because (a) the container needs plaintext at run time, (b) #147 §1 scoped Keychain integration out as not used by the CLI itself, and (c) the e2e bundle is a developer-machine artifact, not a deployed secret — escalating to a vault adds operational friction without changing the threat model.

**Blast radius for developer.** One `chmod 700 "$DIR"` line at end of `auth-gemini.sh`. One sentence appended to the final `e2e_info` line. No new dependencies, no new env vars, no `.gitignore` edit.

---

## Decision 5 — `tests/e2e/defaults.toml` updates: TOML-only, runner contract preserved

> **Revision 2 (post-tester-feedback).** Tester confirmed the 120 s hang class is gone (Check 3 passes in ~10.7 s without env injection). But `gemini/01-layered-context` still fails — for a defect *uncovered* rather than introduced by #148. The sandboxed login bundle (per Decision 1 revision) contains no `[0-6]0_*.md` layered-context rules; those live in the developer's `~/.gemini/` (deployed by `build-components.sh`). Pre-#148, the scenario's own `${rules_dir}:/home/agent/.gemini:ro` mount and `defaults.toml`'s `:ro` mount collapsed onto the same path, and Docker deduplicated — the rules reached the container via that conflation. Now the two mounts have distinct targets (`/run/gemini-creds` vs `/home/agent/.gemini`), `cp -a` aborts on the alias, and the absence of rules in the auth bundle becomes visible for the first time. #148 is enabling `gemini/01` rather than regressing it.
>
> The user has authorized **Option 1**: a second `:ro` mount carrying the host's `~/.gemini` at a distinct container path, plus a selective bootstrap copy of `[0-6]0_*.md` only. Runner (`tests/e2e/run.sh`) remains untouched; the #149 seam is preserved.
>
> Rulings on the four sub-concerns:
>
> 1. **Mount scope** → **broad** (`${HOME}/.gemini:/run/gemini-rules:ro`). The bootstrap glob is the actual filter; broadening the mount source decouples us from `build-components.sh`'s exact output layout and avoids brittle per-file bind mounts.
> 2. **Beyond `[0-6]0_*.md`?** → **rule files only**, no directories. Scope check: scenario 03-skill-build runs `build-components.sh --target gemini` *inside* the container and generates the dirs there; scenarios 02/04 use a MemPalace sidecar, not local MCP config. No current scenario needs `extensions/`, `commands/`, `skills/`, `mcp/`, `policies/`, `hooks/` pre-staged. YAGNI — add later if a future scenario actually fails.
> 3. **Privacy** → **trade-off accepted, documented**. The `:ro` surface widens (entire `~/.gemini` visible read-only inside the container at `/run/gemini-rules`), but the selective `cp -a /run/gemini-rules/[0-6]0_*.md` keeps personal artifacts out of `/home/agent/.gemini`. `gemini` itself never reads from `/run/gemini-rules/` — only the bootstrap does. Residual risk: a malicious MCP server inside the test container could `cat /run/gemini-rules/oauth_creds.json`. In the e2e harness running the developer's own trusted binaries, this is theoretical; the container is short-lived and the developer authored everything inside it. Flag in the bootstrap comment so future maintainers don't widen the bootstrap's read surface without re-evaluating.
> 4. **CI portability** → **soft-skip with warning**. `cp -a … 2>/dev/null || :` swallows the empty-glob failure; an `echo` to stderr surfaces the condition. Hard-failing the bootstrap turns a missing-rules condition into a cryptic container error; soft-skip lets the scenario's own LLM-judge assertion produce the actually-informative failure. The CI-side contract: whoever provisions CI is responsible for deploying `~/.gemini/[0-6]0_*.md` via `build-components.sh` before invoking `task e2e:test`.
>
> **Revision 3 (post-tester-feedback, second).** Revision 2 landed and the rules now reach `/home/agent/.gemini/` correctly — but `gemini/01-layered-context` still fails. Tester's empirical evidence (probe.stderr on commit 6260e5e + host repro): `gemini -p` does **not** autoload `[0-6]0_*.md` from `~/.gemini/` based on filename alone. The autoload manifest is `settings.json.context.fileName: [<basenames>]`. The sandboxed login's `settings.json` contains only the `security` block; it has no `context` key. Result: rules sit inert in the container, `gemini` falls back to its training prior and hallucinates ("Zurich" instead of "Nantes").
>
> User has authorized **shape A**: generate the manifest at bootstrap time by listing the rules actually present and jq-merging `{context: {fileName: […]}}` into the bundle's `settings.json` before `exec gemini`. Rulings on the three sub-concerns:
>
> 1. **`jq` availability** → **use it**. Verified present in `crewrig/e2e-gemini:latest` via `crewrig/e2e-base` (`apt-get install … jq`). No Dockerfile change needed. Python fallback rejected — `jq` is the right tool, it's already there.
> 2. **Manifest content** → **minimal, dynamically derived**. The bootstrap lists `basename`s of `/home/agent/.gemini/[0-6]0_*.md` files actually present after the rules copy. No hardcoded list, no `AGENTS.md`. Three reasons: (a) `AGENTS.md` is at the repo root and was never in scope for the rules mount; (b) listing files not present would make `gemini` complain at startup; (c) dynamic listing is robust if a future user adds `70_*.md` — the authoritative priority-file set lives on disk, not in TOML.
> 3. **Merge strategy** → **jq-merge into the existing `settings.json`**. Preserves `security.auth.selectedType: oauth-personal` and any future keys the sandboxed login adds. Fresh-write would couple us to the current sandbox schema; one `jq` call buys forward compatibility cheap.
>
> Privacy posture is unchanged from Revision 2: container-side only, no new host path, no widening of the auth bundle. The bootstrap reads only from the writable `/home/agent/.gemini/` it had already populated.

**Choice.** Edit `defaults.toml [cli.gemini]` only. Do **not** touch `tests/e2e/run.sh` (lines 275–284 stay as-is for #149). Keep the full `env_keys` array (`GEMINI_API_KEY`, `GOOGLE_CLOUD_ACCESS_TOKEN`, `GOOGLE_GENAI_USE_GCA`) unchanged.

Resulting `[cli.gemini]` block:

```toml
[cli.gemini]
image        = "crewrig/e2e-gemini:latest"
# Container-side bootstrap: copy the :ro credentials bundle into a writable
# location owned by `agent`, copy the host's 00–60 layered-context rules in
# selectively from a second :ro mount, then exec gemini. Lets ProjectRegistry
# .save() perform its atomic-write to projects.json (see issue #147 §5) and
# surfaces the layered-context rules the scenario 01 LLM-judge asserts on.
#
# /run/gemini-rules is :ro-mounted from the developer's full ~/.gemini for
# scope decoupling from build-components.sh's output layout. The bootstrap
# copies ONLY [0-6]0_*.md from that mount — personal state never reaches
# /home/agent/.gemini. Do NOT widen the bootstrap glob without re-evaluating
# the privacy posture (design note Decision 5 Revision 2, concern 3).
command      = [
  "bash", "-c",
  "set -e; D=/home/agent/.gemini; mkdir -p $D && cp -a /run/gemini-creds/. $D/ && { cp -a /run/gemini-rules/[0-6]0_*.md $D/ 2>/dev/null || echo '[bootstrap] no layered-context rules found at /run/gemini-rules/ — gemini/01 will likely fail' >&2; } && M=$(ls $D/[0-6]0_*.md 2>/dev/null | xargs -n1 basename | jq -R . | jq -s .) && [ -n \"$M\" ] && jq --argjson m \"$M\" '.context.fileName = $m' $D/settings.json > $D/settings.json.tmp && mv $D/settings.json.tmp $D/settings.json; chown -R agent:agent $D 2>/dev/null || true; exec gemini \"$@\"",
  "sh"
]
command_args = []
mounts       = [
  "${CREWRIG_E2E_HOME}/gemini:/run/gemini-creds:ro",
  "${HOME}/.gemini:/run/gemini-rules:ro"
]
env_keys     = ["GEMINI_API_KEY", "GOOGLE_CLOUD_ACCESS_TOKEN", "GOOGLE_GENAI_USE_GCA"]
```

**Why.** #147 §4.2 Test D proved `GOOGLE_CLOUD_ACCESS_TOKEN` injection is **vestigial** but **harmless** — removal stays in #149's scope. The second mount adds one TOML line and keeps the runner untouched, so the #149 seam (env_keys + mount path + command shape as the contract surface) is preserved. The bootstrap's `cp -a` (not `cp -R`) preserves modes, which matters for the creds bundle and matches Decision 4's posture.

**Blast radius for developer.** One block rewrite in `defaults.toml` (now two mount lines + a longer `command` string). The `${HOME}` token in the second mount line MUST be interpolated by the runner the same way `${CREWRIG_E2E_HOME}` is — verify `tests/e2e/lib/toml_merge.sh` (or the equivalent path-interpolation pass in the runner) honors plain `${HOME}` substitution. If not, the developer must use the absolute path resolution already in place (the runner's `EFFECTIVE_JSON` materialisation step) and may need to add `${HOME}` to the recognized token list — a one-line change in the interpolation map, not a `run.sh` semantic change (still within Decision 5's "runner contract preserved" envelope; document it as a string-table edit, not a logic edit).

**Bootstrap reading order (for the developer reading the one-liner above):**

1. `D=/home/agent/.gemini` — alias to keep the rest readable.
2. `mkdir -p $D && cp -a /run/gemini-creds/. $D/` — Decision 5 Rev 1 (creds bundle).
3. `cp -a /run/gemini-rules/[0-6]0_*.md $D/ … || echo '[bootstrap] …' >&2` — Decision 5 Rev 2 (rules glob with soft-skip stderr warning).
4. `M=$(ls $D/[0-6]0_*.md | xargs -n1 basename | jq -R . | jq -s .)` — Revision 3: build JSON array of basenames actually present. `jq -R .` quotes each line as a JSON string; `jq -s .` slurps into an array. Empty glob → `M=""` → next step short-circuits.
5. `[ "$M" != "[]" ] && jq --argjson m "$M" '.context.fileName = $m' $D/settings.json > $D/settings.json.tmp && mv $D/settings.json.tmp $D/settings.json` — Revision 3: merge manifest into bundle's `settings.json`, preserving the `security` block. Write-to-tmp + atomic rename avoids partial writes if `jq` errors mid-pipeline. The `[ "$M" != "[]" ]` guard means a soft-skipped rules copy also skips the manifest patch (no manifest → no autoload attempt → no startup error from a stale `context.fileName` list). Note: `… \| jq -R . \| jq -s .` on empty stdin produces the literal string `[]` rather than an empty string, so the `-n` test would still be true; the explicit `[]` comparison is the correct guard.
6. `chown -R agent:agent $D 2>/dev/null || true` — Decision 5 Rev 1.
7. `exec gemini "$@"` — handoff.

The one-liner is ugly. Bounded ugliness; self-documenting in context. If it grows one more step, promote to a shipped helper (Decision 2 Option B) — that threshold is "exactly one more step", not "any growth".

**Additional file change — scenario script.** `tests/e2e/scenarios/01-layered-context/run.sh` currently mounts `${rules_dir}:/home/agent/.gemini:ro` for every CLI. Add a case-split: skip this mount for `gemini` (where the rules now arrive via the defaults.toml bootstrap), keep it for `claude` and `copilot` (where the scenario-level mount remains the rules delivery path). This is the minimal scenario-side change needed to unblock the bootstrap; broader unification of rules delivery across CLIs is out of scope.

---

## Decision 6 — CLI matrix maintenance

**Choice.** Update **two cells** in `docs/cli-matrix.md`:

1. **Row #21 (e2e dedicated-account auth flow), Gemini column.** Replace `{oauth_creds.json,settings.json}` with the broader `{oauth_creds.json, settings.json, google_accounts.json, google_account_id, installation_id, gemini-credentials.json, extension_integrity.json, trustedFolders.json, acknowledgments/, history/, projects.json, state.json, ...}` enumeration, and append a sentence: `Bundle is mounted :ro at /run/gemini-creds; a container-side wrapper copies it to /home/agent/.gemini before exec gemini (see issue #147 §5).`
2. **Row #22 (e2e pillar 01 — layered context), Gemini column.** Change `mounts ${CREWRIG_E2E_HOME}/gemini ro` → `mounts ${CREWRIG_E2E_HOME}/gemini at /run/gemini-creds ro, copy-on-boot to /home/agent/.gemini`. The truth of the mount path moved; the matrix must follow.

No `Parity gaps` entry changes — Claude continues to mount `~/.crewrig-e2e/claude` directly RO (no atomic-write pressure on its credential files), so the asymmetry is empirically justified and already documented as a behavior difference, not a gap.

**Why.** AGENTS.md "CLI Matrix Maintenance" lists `tests/e2e/defaults.toml` modifications as in the trigger surface. Drift here is a parity bug per the standing rule. Both affected rows already describe the mount mechanism; updating them is mechanical.

**Blast radius for developer.** Two cell edits. Same commit as the code change.

---

## Decision 7 — Test surface for the tester

The tester's brief beyond `task e2e:test passes`:

1. **Re-run #147 §4.2 Test E (minimal-bundle elimination) using the new `/run/gemini-creds` stable mount.** This is the test that was inconclusive in #147 because Docker Desktop fs sharing did not propagate `/tmp/gem-min/`. With the new mount path inside `~/.crewrig-e2e/`, fs sharing is already proven. Run with:
   - `oauth_creds.json` + `settings.json` only → expect EXIT=0 or specific error
   - Add one file at a time until passing
   Append the finding to `docs/research/gemini-cli-auth-blackbox.md` §4.2 Test E result column (replacing "inconclusive") and update §2.1 captured-today column accordingly.
2. **Wall-clock timing.** `time task e2e:test -- --cli gemini --scenario 01-layered-context`. Confirm < 10 s end-to-end (the previous `timeout 120 gemini` wrapper masked a hang; the new path should finish in single-digit seconds per #147 §4.1).
3. **Confirm `GOOGLE_CLOUD_ACCESS_TOKEN` injection is unneeded.** Temporarily unset it in `run.sh` (or comment out the injection block locally — do not commit) and verify the scenario still passes. This empirically validates the #149 cleanup contract before #149 lands.
4. **Negative test: simulate stale auth.** Remove `oauth_creds.json` from `~/.crewrig-e2e/gemini/` and confirm the scenario produces a clear, non-hanging failure (not a silent timeout).

---

## Handoff to developer — concrete edit checklist

1. **`scripts/e2e/auth-gemini.sh`** — already implemented in 79b815a + security follow-ups; per Decision 1 revision, the only remaining edits are: revert mount to `-v "${DIR}:/home/agent/.${CLI}"`, drop the `HOST_GEMINI` variable and the `cp -Rp "${HOST_GEMINI}/." "${DIR}/"` line, drop the host-precondition check. Denylist cleanup, broadened grep, `chmod 700`, mode normalization, and warning text all stay.
2. **`tests/e2e/defaults.toml`** — rewrite `[cli.gemini]` block per Decision 5 Revisions 2 + 3 (TWO mount lines: `/run/gemini-creds` from `${CREWRIG_E2E_HOME}/gemini`, `/run/gemini-rules` from `${HOME}/.gemini`; extended bootstrap with selective `[0-6]0_*.md` copy, soft-skip stderr warning, AND jq-merge of dynamic manifest into `settings.json.context.fileName`). Preserve `env_keys` unchanged.
3. **`tests/e2e/scenarios/01-layered-context/run.sh`** — add a case-split that skips the `${rules_dir}:/home/agent/.gemini:ro` mount when the target CLI is `gemini`. Claude and Copilot keep the existing mount.
4. **Verify `${HOME}` interpolation in the runner's TOML path-substitution pass.** If `${HOME}` is not already in the recognized token map, add it (one-line edit in the token list — NOT a runner logic change; the runner contract — env_keys + mount path + command shape — is unchanged). If it IS already recognized, no edit needed.
5. **`docs/cli-matrix.md`** — update Row #21 and Row #22 Gemini cells per Decision 6, and extend Row #22 to mention the dual `:ro` mount (`/run/gemini-creds` for creds, `/run/gemini-rules` for layered-context rules).
6. **Do NOT touch:** `tests/e2e/run.sh`, `scripts/e2e/lib/auth-common.sh` (specifically `e2e_gemini_refresh_access_token`), `tests/e2e/lib/test-token-refresh.sh`. All owned by #149.
7. **Verify locally before push:**
   - `bash scripts/check-skill-versions.sh` (no artifacts/ edits expected; should be a no-op)
   - `task e2e:auth:gemini` — re-run the interactive login; confirm the new files appear under `~/.crewrig-e2e/gemini/` and the dir is `0700`.
   - `task e2e:test -- --cli gemini` — single-digit-seconds completion expected; `gemini/01-layered-context` should now pass.
8. **Commit message** for the follow-up: `🔐 Add layered-context rules mount + selective bootstrap copy (issue #148)` (Gitmoji per AGENTS.md).

---

## Open concerns for team-lead

- **`history/` privacy** is resolved by the Decision 1 revision: the sandboxed login produces no prior history, so nothing to leak. If the tester (Decision 7 #1) finds the e2e scenario does write a `history/` entry at runtime, that entry is per-run and per-scenario, not the developer's personal transcript — no action needed.
- **API-key grep** has been broadened to walk the full `$DIR` (developer's implementation `grep -rlE ... "$DIR"` is correct). Keep as-is.
- **`${HOME}` token in TOML mount strings.** If the runner's path-interpolation map does not currently recognize `${HOME}`, adding it is a string-table edit (not a `run.sh` logic change). If for some reason this is judged a `run.sh` modification proper and therefore in #149's territory, the alternative is to resolve the host path at scenario-launch time and pass it via an env-var that the TOML already references. Flag to developer; rule is "smallest edit that preserves the #149 seam wins".
