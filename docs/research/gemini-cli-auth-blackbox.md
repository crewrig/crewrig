# Gemini CLI auth — black-box analysis

> **Status:** Research deliverable for issue #147. Feeds the capture redesign
> (#148) and the headless-invocation simplification (#149).
>
> **Method:** Observation-only. No source code reading. Tools used on the
> host: `find` snapshot-diff, `lsof` polling, `security dump-keychain`.
> Inside the container: `bash`, `ls`, `gemini -p` itself. All raw artifacts
> captured under [`artifacts/147/`](artifacts/147/).

## Executive summary

1. **Gemini CLI does NOT use the macOS Keychain.** All auth state lives on
   the filesystem under `~/.gemini/`. The three Keychain hits matching
   "gemini" belong to the IntelliJ plugin and the Gemini macOS desktop app —
   neither is the CLI.
2. **The captured bundle (`scripts/e2e/auth-gemini.sh` output) is
   incomplete.** Several files present in a working `~/.gemini/` are
   missing from `~/.crewrig-e2e/gemini/`. Whether each is load-bearing
   is verified empirically in [§4](#4-load-bearing-test-results).
3. **The headless block is a `:ro` mount artifact, not a WebSocket
   bug.** `gemini -p` writes to `~/.gemini/projects.json` and
   `~/.gemini/history/<projectId>/.project_root` on every invocation.
   When the mount is read-only, the write hangs silently (the container
   timeout misdiagnosed this as a generic Bidi WebSocket issue).
4. **The fix pattern is "`:ro` source + copy into a writable dir inside
   the container."** Empirically confirmed in [§5](#5-fix-pattern). Same
   shape as the existing Ollama workaround in `tests/e2e/local.toml`.
5. **`GOOGLE_CLOUD_ACCESS_TOKEN` injection is vestigial** once the fix
   pattern is in place. The runner's `e2e_gemini_refresh_access_token`
   dance is unnecessary — `oauth-personal` works headless when the bundle
   is writable.

## 1. Scope

Black-box observation of:

- where Gemini CLI persists auth state on a macOS host, and
- what it reads/writes during a healthy `gemini -p "..."` invocation,
- contrasted with what happens inside `crewrig/e2e-gemini:latest`.

Out of scope: source-code inspection (intentionally), Claude Code parity
(deferred to a follow-up), Linux host (not the target platform of the
current friction).

## 2. Host inventory — `~/.gemini/` (excl. browser caches)

Two large subtrees are intentionally excluded from the inventory because
they are clearly unrelated to CLI auth:

- `~/.gemini/antigravity-browser-profile/` — full Chromium profile
  (~18k files of browser cache state).
- `~/.gemini/tmp/` — transient session scratch.

The remaining top-level entries fall into four buckets.

### 2.1 Bucket A — Identity & credentials (load-bearing status verified in #148)

Re-run of Test E on the now-stable `/run/gemini-creds` mount path (#148
commit, see `tests/e2e/reports/148/test-e-subsets.md`) narrowed the
minimal load-bearing set for `gemini -p` under `crewrig/e2e-gemini:latest`
to **three files**: `oauth_creds.json`, `settings.json`, and
`trustedFolders.json`. The other four files in the table below either
ship in the bundle but are not consulted by `gemini -p`, or never reach
the bundle in the first place. The `Status` column replaces the prior
`Captured today?` qualifier with the empirically verified outcome.

| File | Mode | Schema (keys) | Status (verified in #148) |
|---|---|---|---|
| `oauth_creds.json` | `0600` | `access_token`, `refresh_token`, `id_token`, `expiry_date`, `scope`, `token_type` | ✅ load-bearing (minimal set) |
| `settings.json` | `0600` | `$schema`, `security.auth.selectedType`, `context`, `hooks`, `mcpServers`, `privacy`, `general` | ✅ load-bearing (minimal set) |
| `trustedFolders.json` | `0600` | folder allowlist | ✅ load-bearing (minimal set) — image CLI enforces trusted-folder mode; absence triggers `Gemini CLI is not running in a trusted directory` exit-1 |
| `google_account_id` | `0644` | 21-byte numeric Google user ID | ⚪ absent from sandboxed login bundle; not consulted by `gemini -p` (verified by passing test without it) |
| `google_accounts.json` | `0644` | accounts map | ⚪ shipped but not load-bearing (S2 vs S5 elimination) |
| `installation_id` | `0644` | 36-byte UUID | ⚪ shipped but not load-bearing (S3 vs S5 elimination) |
| `gemini-credentials.json` | `0600` | opaque hex blob (encrypted; format `<iv>:<salt>:<ciphertext>`) | ⚪ absent from sandboxed login bundle; scenario passes without it |

### 2.2 Bucket B — Runtime mutables (`gemini -p` WRITES these every run)

| File | Mode | Created/modified by `-p`? |
|---|---|---|
| `projects.json` | `0644` | **Modified.** Project registry indexed by cwd hash. Atomic-write pattern (open `<file>.<uuid>.tmp`, fsync, rename). |
| `history/<projectId>/.project_root` | dir + file | **Created on first run per cwd.** Marks the project root for transcript storage. |
| `state.json` | `0644` | session state (UI counters: `defaultBannerShownCount`, `tipsShown`, etc.) — not modified by `-p` specifically but written by interactive flows. |

These are the files that **break the `:ro` mount** in §5.

### 2.3 Bucket C — Configuration & rules (not auth-related)

| File / dir | Role |
|---|---|
| `00_SOUL.md` ... `60_TOOLS.md` | Layered context system, deployed by `build-components.sh` — already in scope of CrewRig and unrelated to auth. |
| `.env` | Local override; user-managed. |
| `extensions/`, `commands/`, `skills/`, `mcp/`, `policies/`, `hooks/` | CrewRig artifacts deployed by build. |
| `acknowledgments/agents.json` | Agent consent acknowledgments registry. Status w.r.t. headless auth: **unknown** — to be tested in #148. |
| `extension_integrity.json` | Hash manifest of installed extensions (`0600`). Likely a startup integrity check. |
| `mcp-server-enablement.json` | per-server enable flags. |

### 2.4 Bucket D — Backups / leftovers (not load-bearing)

A pile of `settings.json.bak.<ts>` and `.ori`/`.orig` files left by the
CrewRig setup scripts. Inert.

## 3. macOS Keychain

```sh
$ security dump-keychain ~/Library/Keychains/login.keychain-db \
  | grep -i -E '"svce".*=|"acct".*=' \
  | grep -i -E 'gemini|google.*(oauth|cli|generative|api|cloud)'
"svce"<blob>=...="IntelliJ Platform Gemini in AndroidStudio — API Key"
"acct"<blob>="Gemini Keys"
"svce"<blob>="Gemini Safe Storage"
```

All three hits are non-CLI: IntelliJ Android Studio plugin and the macOS
desktop app ("Gemini Safe Storage" = Chromium's Safe Storage pattern,
emitted by Electron apps). **The CLI does not store auth in the
Keychain.** No special host capture path is needed.

## 4. Load-bearing test results

### 4.1 Healthy host `gemini -p` — full trace

Run via [`artifacts/147/trace-gemini-p.sh`](artifacts/147/trace-gemini-p.sh).
See [`artifacts/147/trace.txt`](artifacts/147/trace.txt) for raw output.

| Observation | Result |
|---|---|
| Wall-clock | < 5 s |
| Exit code | 0 |
| Output | "Blanc." |
| Files **modified** under `~/.gemini` | `projects.json`, `history/<projectId>/.project_root` |
| Files **created** under `~/.gemini` | `history/<projectId>/.project_root` |
| OAuth refresh? | No (access_token expiry still in the future) |

`lsof` polling at 200 ms missed the read-only opens (Gemini exits faster
than the poll period catches the syscalls). This is the limit of the
no-sudo method. For #148, an opt-in `fs_usage` capture under sudo can
fill the gap; for #147, the WRITE evidence above plus §4.2 elimination
tests are sufficient.

### 4.2 Container A/B/C/D/E elimination

| Test | Mount strategy | env injection | Result | Conclusion |
|---|---|---|---|---|
| **A** | `~/.crewrig-e2e/gemini` `:ro` + `settings-headless.json` shadow | `GOOGLE_CLOUD_ACCESS_TOKEN`+`GOOGLE_GENAI_USE_GCA` | **EXIT=124** (timeout, no output) | Current state. The `:ro` write to `projects.json` hangs. |
| **B** | full host copy `:rw` | same | EACCES on `projects.json.<uuid>.tmp` | UID mismatch (Darwin Docker bind-mount). |
| **C** | `~/.crewrig-e2e/gemini` `:ro` at `/run/gemini-creds`; copied to `/home/agent/.gemini` inside container; `chown agent:agent` | same | **EXIT=0**, "Pong" in seconds | ✅ fix pattern works |
| **D** | same as C | **no env injection** | **EXIT=0**, "White" | OAuth token refresh is vestigial — `oauth-personal` works headless when the bundle is writable. |
| **E** | minimal bundle (`oauth_creds.json` + `settings.json` only) | none | inconclusive — Docker Desktop fs sharing did not propagate `/tmp/gem-min/` into the container | To be re-run inside #148 with a stable mount path. |
| **E′** | minimal bundle re-run on the `/run/gemini-creds` stable mount inside `$HOME/tmp/gem-148/` (#148 closure of Test E) | none | **EXIT=0** only when `trustedFolders.json` is included; `oauth_creds.json + settings.json` alone returns `Gemini CLI is not running in a trusted directory` exit 1 | ✅ minimal load-bearing set narrowed to `{oauth_creds.json, settings.json, trustedFolders.json}`. See `tests/e2e/reports/148/test-e-subsets.md` and §2.1. |
| **F** | bundle as in C + `~/.gemini/[0-6]0_*.md` mounted at `/run/gemini-rules:ro`, bootstrap-time patch of `settings.json.context.fileName` to enumerate the manifest, then `exec gemini -p` (#148 commit `fd196d4`) | none | **EXIT=0**, "Nantes" — LLM in-context loads the layered rules and answers from `30_USER_PROFILE.md` | ✅ `settings.json.context.fileName` is the autoload manifest contract — pre-#147 unknown (cf. §7 read-side trace gap). Empty manifest or absent `context` block ⇒ rules not autoloaded ⇒ model hallucinates (verified empirically: "Zurich" hallucination at `6fcac29` before manifest wiring). |

### 4.3 Diagnostic value of error messages

- Test A: silent hang. No log line, no syscall error, no useful stderr.
  Only the wrapper `timeout` proves it was stuck.
- Test B: clear stack trace pointing at `ProjectRegistry.save` performing
  an atomic-write to `projects.json.<uuid>.tmp`. This is what gemini
  was trying to do silently in Test A.

The Test B stack trace is the smoking gun for the write path: it names
`ProjectRegistry.save`, which closes the loop on §2.2 — `projects.json`
is written by the Project Registry on every invocation. Test A's silent
hang against `:ro` is **almost certainly** the same write attempt failing
upstream of the EACCES path Test B exercises (different mount mode, same
target file), but the syscall trace that would prove identity directly
is precisely the read-side trace §7 admits we did not capture. The
strength of the §5 fix-pattern recommendation does not depend on closing
that residual uncertainty: Test C empirically demonstrates the fix works,
whatever the exact failure mode in Test A.

## 5. Fix pattern

Use the same shape already in place for Ollama Cloud credentials in
`tests/e2e/local.toml`:

```text
mounts =
  - "${CREWRIG_E2E_HOME}/gemini:/run/gemini-creds:ro"
command =
  - "bash"
  - "-c"
  - |
      mkdir -p /home/agent/.gemini
      cp -R /run/gemini-creds/. /home/agent/.gemini/
      chown -R agent:agent /home/agent/.gemini 2>/dev/null || true
      exec gemini "$@"
  - "sh"
```

Properties:

- The host bundle remains immutable (`:ro` source). No risk that a buggy
  scenario corrupts `oauth_creds.json` on the host.
- The container's `/home/agent/.gemini` is owned by `agent`, writable, and
  contains a full copy — gemini can atomic-write `projects.json` happily.
- No env-var injection. No timeout wrapper. No `settings-headless.json`
  shadow.

## 6. Recommendations for #148 and #149

### For #148 (auth capture redesign)

1. **Keep capturing the full `~/.gemini/` top-level**, minus the
   browser-profile and `tmp/` subtrees. Stop trying to be surgical with
   the file list; the cost of over-capture is negligible.
2. **Add to `auth-gemini.sh`'s capture set:** `google_account_id`,
   `gemini-credentials.json`, `extension_integrity.json`,
   `acknowledgments/agents.json`. None of these have been individually
   load-bearing-tested yet; capture them all and let §4 Test E (re-run
   on a stable mount) determine the minimal subset.
3. **Drop the `settings-headless.json` shadow.** With the fix pattern,
   `oauth-personal` from the captured `settings.json` works.
4. **Document explicitly that the bundle is NOT a secret-at-rest.** The
   refresh token in `oauth_creds.json` is a long-lived credential. The
   `~/.crewrig-e2e/gemini/` directory must be `chmod 700` and never
   committed.

### For #149 (headless simplification)

1. **Move the `cp -R` + `chown` into `defaults.toml [cli.gemini].command`.**
2. **Remove from `tests/e2e/run.sh`:** the `if [[ "$cli" == "gemini" ]]`
   token-refresh block (lines 275–284) and the `GOOGLE_CLOUD_ACCESS_TOKEN`
   / `GOOGLE_GENAI_USE_GCA` exports.
3. **Remove from `tests/e2e/defaults.toml [cli.gemini]`:** the
   `timeout 120 gemini "$@"` wrapper (replaced by the `cp -R` + `exec`
   pattern) and the `settings-headless.json` mount line.
4. **Delete `e2e_gemini_refresh_access_token` from `auth-common.sh`** when
   #149 lands. Grep at the time of this analysis (run from the worktree
   root) returns three call sites: `tests/e2e/run.sh:279` (the runner
   injection block removed by #149), `tests/e2e/lib/test-token-refresh.sh`
   (the helper's own regression test, added in #143 — goes with the
   helper), and the definition itself in `scripts/e2e/lib/auth-common.sh`.
   No CI cron, no other script, no documented external consumer. Recent
   hardening (#143, commit `b1c3add`) was fixing a helper whose user base
   is about to shrink to zero.

## 7. Limits of this analysis

- **No sudo-level syscall trace.** `lsof` at 200 ms polling missed all
  read-only file opens during the < 5 s `gemini -p` window. The WRITE
  evidence (snapshot-diff) plus the container error stack (§4 Test B)
  cover the load-bearing path, but a complete list of files read at
  startup is not in this document. Whether more files than §2.1+§2.2
  matter will surface during #148 implementation.
- **macOS-only.** Linux host behavior was not characterized. If a Linux
  CI runner ever calls `auth-gemini.sh` directly (not just via the
  e2e container), §3 should be re-run with `secret-tool` / GNOME keyring.
- **Single CLI version.** The trace was captured against the version
  shipped in `crewrig/e2e-gemini:latest` at the date of this document.
  Atomic-write patterns and registry locations can shift across Gemini
  CLI releases.

## 8. Raw artifacts

All under [`artifacts/147/`](artifacts/147/):

- `baseline.fs.txt` — snapshot of `~/.gemini` top-level before the trace.
- `baseline.keychain.txt` — filtered Keychain entries matching gemini/google.
- `baseline.library.txt` — `~/Library/...` Gemini-related state (none CLI-relevant).
- `trace-gemini-p.sh` — the wrapper script used in §4.1.
- `trace.txt` — output of the §4.1 wrapper run.
