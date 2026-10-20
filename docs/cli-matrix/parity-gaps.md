# Parity gaps

The following features exist for one CLI but not the other. Each gap is a
candidate follow-up issue. **Do not fix them in this ticket.**

- [GAP] Copilot CLI model-mapping offerings (row 33) — `model-mappings/copilot.yml` declares zero offerings by design:
  the model lineup actually served to GitHub Copilot CLI is deployment knowledge (a GitHub-routed deployment and a
  bring-your-own-key deployment reach disjoint sets), not something the core layer can name without reproducing the
  silent routing failure of `github/copilot-cli#4437`. Empirical reproduction: probe run `20260902T153919Z-0aa9` of
  issue #1103, verdict `BUG-PRESENT`, plus the unknown BYOK lineup recorded in the live-verification research report
  (issue #1111 comment 5523492666). Spec 0197 R42 states the condition a later delta must meet to lift this.
- [GAP] Antigravity CLI per-agent model frontmatter surface (row 33) — no per-agent `model:` field exists on this
  target; `model-mappings/antigravity.yml` states its declination on the guidance surface instead. Empirical
  reproduction: `agy --help`, `agy models`, `~/.gemini/antigravity-cli/settings.json`, and ten on-disk documentation
  files read in full, none naming a per-agent model field (spec 0197 Premise 1).

- [GAP] CI workflow — present for Claude Code (`.github/workflows/claude.yml`), missing for Gemini CLI.
- [GAP, CLOSED — spec 0183, issue #1008] Plugin/extension build script — was present for Claude Code
  (`scripts/build-claude-plugin.ts`), missing for Gemini CLI. `node scripts/build-extension.ts --target gemini` (spec 0173)
  is the render-side symmetric counterpart (row 13); `scripts/release-package-extension.ts` (spec 0183;
  `scripts/release-package-extension.ts` is a forwarding shim to it) is the RELEASE-artifact-packaging counterpart,
  since Claude's own release path never needed one — its plugin is installed via the marketplace mechanism (row 14),
  not a published archive. Left recorded here as history rather than deleted outright: the
  extensions-are-consumed-in-place framing was the reason no path existed, and this row is where a future reader would
  look for it.
- [GAP] In-repo workspace settings file — present for Claude Code (`.claude/settings.json`), missing for Gemini CLI
  (settings live only in `~/.gemini/settings.json`).
- [GAP] `.gitignore` carve-outs — Claude-specific entries (`dist-claude-plugin/`, `.claude/settings.local.json`,
  `CLAUDE.local.md`) have no Gemini equivalents (e.g., a `.gemini/settings.local.json` analog).
- [GAP] Top-level entry point file — `CLAUDE.md` lives at the repo root; `GEMINI.md` only appears inside extensions
  (no repo-root `GEMINI.md`).
- [GAP] Slash commands — Copilot CLI has no user-definable slash-command file format. CrewRig commands compile as
  user-invocable skills under `.github/skills/` (same workaround Claude uses). Same trade-off, documented and accepted.
- [GAP, CONTRADICTED on Windows — spec 0237] Project-dir env var — recorded as "Copilot does not export a
  `$COPILOT_PROJECT_DIR`". On Windows 11 ARM64 Copilot CLI 1.0.89 **does** export it, set to the session cwd (row 37c,
  measured transcript). macOS and Linux have not been re-measured, so the gap is kept open for them only.
  `hooks/mempalace-transcript.ts` (spec 0247) still extracts the workspace path from the hook stdin JSON payload and
  falls back to `$PWD`, which is correct either way.
- [GAP-confirmation] Repo-level Copilot agent layout — the public Copilot reference only documents the user-level
  `~/.copilot/agents/` directory. CrewRig adopts `.github/agents/<name>.md` by parallelism with the skills layout;
  implementers must verify loading behavior and downgrade to a hard `[GAP]` if the path is rejected. **Probe B run
  2026-09-02 (spec 0194 R12-R15, issue #1103, comment
  [5507202742](https://github.com/crewrig/crewrig/issues/1103#issuecomment-5507202742)):** all five cells (copilot
  nested/flat/cross-cell-control, claude nested/flat) recorded `indeterminate` — neither CLI session established
  (unrelated environment issues, not a defect in the probe), so no cell reached `consumed` or `not-consumed`. This gap
  stays a `[GAP-confirmation]`; a re-run with working sessions for both CLIs is needed to resolve it, and to ground epic #1100's
  compiled-layout seam.
- [GAP-confirmation] Copilot agent provenance carrier — CrewRig currently emits the same `metadata.provenance` YAML
  block in `.github/agents/<name>.md` that it emits for Claude. Copilot CLI's tolerance for non-standard frontmatter
  keys is undocumented; if Copilot rejects the block (as Gemini CLI 0.42.0 did, see issue #54), migrate Copilot agents
  to the same HTML-comment carrier used by Gemini. Follow-up ticket to be filed.
- [GAP-soft] e2e pillar 02 (cross-tool memory) for Copilot CLI — the `crewrig/e2e-copilot:latest` image does not embed
  the `mempalace` CLI (`docker/e2e/copilot.Dockerfile` installs only Node, `gh`, and `@github/copilot`; verified via
  `docker run --rm crewrig/e2e-copilot:latest which mempalace` → exit 1) and no MemPalace MCP wiring ships in
  `artifacts/community/` for Copilot. The scenario excludes Copilot via `applies_to = ["claude","gemini"]` in
  `tests/e2e/defaults.toml`. Re-evaluate when either the Copilot image gains the `mempalace` binary or a MemPalace MCP
  integration appears for Copilot.
- [GAP-soft] e2e pillar 04 (harness loop) full interactive leg — the scenario currently uses the simulated path
  (direct drawer write to `wing=harness-friction`, curator-style search) for all three CLIs. The fully interactive path
  that drives the `harness-report` skill end-to-end through the CLI's slash-command surface is not yet supported
  non-interactively from any CLI. The simulated path is parity-equivalent for v1: it writes the same drawer shape the
  skill would write and the curator reads the same lane regardless of the writer's identity.
- [GAP-soft] e2e auth flow for Copilot CLI (spec 0194 R1-R7, issue #1103) — `auth-claude.ts` and `auth-gemini.ts`
  persist a credential via a fresh, **interactive container login**; `auth-copilot.ts` instead **passes through** the
  workstation's own already-authenticated `~/.copilot/config.json` (copied to `~/.crewrig-e2e/copilot/config.json`,
  mounted read-write at `/home/agent/.copilot`), alongside the pre-existing env-var PAT (`$COPILOT_GITHUB_TOKEN` /
  `$GH_TOKEN`) and Ollama Cloud keypair paths. `e2e_auth_ready` (`scripts/e2e/lib/auth-common.ts`) recognizes all four.
  Empirical evidence for why no interactive container login exists is captured in `docs/adr/0002-e2e-auth-flow.md`
  Decision 4: the `crewrig/e2e-copilot:latest` image lacks `libsecret`, so the upstream desktop-keychain path is
  unavailable, and the documented plaintext-fallback device-flow adds login friction without scenario-coverage gain over
  the passthrough. Re-evaluate if a scenario ever needs a credential distinct from the developer's own workstation
  session.
- [GAP] Copilot CLI subagent model routing on BYOK/Ollama (row 4) — on a BYOK provider (e.g. Ollama), spawning a
  repo-level Copilot custom agent as a `task`-tool subagent **silently fails**
  (`Agent completed but produced no response.` / `Model '...' not found on provider ... (HTTP 404)`) when the session
  model differs from the subagent's default. Root cause: the **default subagent-model routing** (flight
  `copilot_cli_gpt_5_4_for_subagents` in `~/.copilot/config.json`) and hardcoded `model:` hints in repo agent files.
  Solution: `scripts/build-components.ts` omits hardcoded `model:` frontmatter from the two compiled agent surfaces
  GitHub Copilot CLI reads, `.claude/agents/` and `.github/agents/` — since spec 0200 migrated the 22 core agent
  sources onto `metadata.model:`, 22 `.gemini/agents/*.md` files carry a `model:` field
  (docs/agent-profile-migration.md), so the claim no longer holds tree-wide and is narrowed to the surfaces this hazard
  actually reaches. Workaround if using custom agent files: pass `model: <session-model>` explicitly to the `task` tool
  call. Tracked upstream at `github/copilot-cli#4437`. **Remove this note when the upstream fix lands.** **Probe A run
  2026-09-02 (spec 0194 R8-R11, issue #1103, comment
  [5506957758](https://github.com/crewrig/crewrig/issues/1103#issuecomment-5506957758)): `INDETERMINATE` /
  `surface-not-read-or-session-broken`** — Copilot CLI 1.0.82 via the Ollama Cloud BYOK path; the run did not
  discriminate because the BYOK session itself never established (an unrelated Ollama-client write-path regression
  against the read-only credential mount, not the routing defect this note tracks). This note stays **in force** per R11
  (an `INDETERMINATE` verdict neither discharges nor re-dates it); a re-run on a working BYOK session (or a
  `COPILOT_GITHUB_TOKEN`-backed provider) is needed for a discriminating verdict. **Probe B run
  `20260902T154627Z-0d89`** (spec 0201, epic #1100 seam (g), issue #1103, comment
  [5512320726](https://github.com/crewrig/crewrig/issues/1103#issuecomment-5512320726)): all three Copilot cells
  recorded `consumed` for the `.claude/agents/` surface — nested, flat, and the documented `~/.copilot/agents/`
  surface — confirming the shared-read hazard this note tracks holds on **both** compiled per-file layouts. Flattening
  the compiled Claude Code output to `.claude/agents/<name>.md` (spec 0201) therefore does **not** retire this note or
  the requirement 8 shared-read guard of `specs/0143-copilot-subagent-model-fallback.delta-01.md`; neither the Copilot
  emission nor that guard changes, and both remain necessary regardless of per-file layout.
- [GAP] MemPalace layered wake-up (row 7g) — MemPalace's `MemoryStack.wake_up()` (`L0–L3`) is exposed by the Python
  library and the `mempalace` CLI (`wake-up`) but is **absent from the agent-facing MCP tool surface** on the installed **3.6.0**
  (pinned `>=3.6.0,<3.7`; re-verified 2026-07-20 against the live 36-tool surface, issue #566). Unlike the gaps above,
  this is **not** a cross-CLI asymmetry: all four CLIs share the one MCP surface (row 7d), so the gap is uniform across
  them. The **MCP-only access** guard in `artifacts/core/rules/60-tools.md` forbids reaching it ad-hoc, and the
  deterministic session-start sweep (that file's *Wake-up budget* stub; full figures in
  `docs/mempalace-wakeup-budget.md`) is its bounded substitute. Candidate follow-up: an upstream request to expose the
  wake-up through MCP (consent-gated, out of scope for spec 0069).

<!-- Antigravity CLI gaps (spec 0058) -->

- [GAP] Settings template in `config/` (row 6) — Antigravity CLI writes settings directly to
  `~/.gemini/antigravity-cli/settings.json` via `setup-antigravity-interactive.ts`; no `config/antigravity/` repo
  template is defined. Same pattern as Gemini CLI's row-7 gap.
- [GAP] In-repo workspace settings file (row 7) — Antigravity CLI reads from `~/.gemini/antigravity-cli/settings.json`
  only; no `.agents/settings.json` analog written to the project tree.
- [GAP] Project-dir env var (row 9) — no `$ANTIGRAVITY_PROJECT_DIR` is injected. Since spec 0116 the project path is
  read from the hook payload's `workspacePaths[0]`, with the git root and `$PWD` as fallbacks. Evidence: a captured hook
  payload carries `workspacePaths`; no env var appears in any handler's environment.
- [GAP] Workspace-level hook discovery (row 8) — the vendor documents a per-workspace customization root (`.agents/`
  at the repository root) alongside the global one, but a manifest registered there **did not fire**. Evidence: two
  `agy --print` runs from a `git init`-ed workspace containing `.agents/hooks.json`, with a handler that appends its
  stdin to a log, produced no log entry; the identical manifest at `~/.gemini/config/hooks.json` fired `PreInvocation`,
  `PostInvocation` and `Stop` on the next run. `setup-antigravity-interactive.ts` therefore deploys only to the global
  root. Whether the per-workspace root fails in every configuration or only in the probed one (headless, single prompt,
  freshly initialized repository) is not established.
- [GAP-soft] Duplicate agent names across discovery roots (rows 4, 10) — Antigravity CLI does **not** de-duplicate an
  agent name discovered at two roots at once: `agy agents` lists it **twice**. Neither copy shadows the other and the
  CLI does not refuse the pair. Evidence: one probe sentinel installed simultaneously at `~/.gemini/config/agents/` and
  `~/.gemini/agents/`, listed twice while its unique-named siblings at the same two roots were each listed once (`agy` 1.1.11,
  2026-08-11, two runs; `docs/runbooks/antigravity-discovery-probe.md`). The live instance is `harness-curator`, which
  after spec 0123 exists at `~/.gemini/agents/harness-curator.md` from the Gemini setup and
  `~/.gemini/config/agents/harness-curator/AGENT.md` from the Antigravity setup. Both are the same crewrig component
  rendered for two CLIs, so either resolution yields the same agent and the only effect is a doubled line in the
  listing. Recorded rather than worked around: renaming a shipped component to dodge a vendor listing artifact would
  cost more than the artifact does.
- [GAP-confirmation] Two agent-discovery instruments, and they disagree (rows 4, 10) — `agy agents` enumerates agents
  from **all three** candidate roots (`~/.gemini/antigravity-cli/agents/`, `~/.gemini/config/agents/`,
  `~/.gemini/agents/`), in both the flat and the directory shape. A forced-choice prompt in the same session, against
  the same sentinels, reports only those under `~/.gemini/config/` as available. The two are not contradicting each
  other about facts — the subcommand reads a registry, the prompt measures what the assistant can reach in a session
  — but a discovery claim resting on `agy agents` alone rests on the more permissive of the two. The first probe on
  issue #761 concluded from `agy agents` alone that the application-data root "is a discovery location"; that conclusion
  is instrument-dependent and is corrected here. `~/.gemini/config/agents/` is the only root that satisfies both
  instruments, which is why spec 0123 R2's single documented root is the right target under either reading. Evidence:
  `agy` 1.1.11, 2026-08-11, two reproducible runs; `docs/runbooks/antigravity-discovery-probe.md`.
- [GAP] Extension skill/agent loader (row 5c) — Antigravity CLI has no in-repo extension skill/agent loader.
  `scripts/install-antigravity-extension.ts` builds a plugin package and calls `agy plugin install` — the plugin is
  consumed as a package, not via per-skill directory links.
- [GAP] CI workflow (row 18) — `agy --print` is confirmed non-interactive (exit 0; output:
  `Pong! How can I help you today?`), but no published GitHub Action (analogous to `anthropics/claude-code-action`)
  exists for Antigravity CLI. Evidence: `gh api /repos/antigravity-labs/agy-code-action` → HTTP 404;
  `gh api /users/antigravity-labs` → HTTP 404; `gh search repos "agy-action"` — no relevant results.
- [GAP-soft] e2e dedicated-account auth flow (row 21) — no `scripts/e2e/auth-antigravity.ts` or
  `crewrig/e2e-antigravity:latest` Docker image has been defined. Adding Antigravity CLI e2e coverage is explicitly out
  of scope per spec 0058.
- [GAP-soft] e2e pillar 01 — layered context (row 22) — no Antigravity CLI e2e container or scenario variant exists.
  Out of scope per spec 0058.
- [GAP-soft] e2e pillar 02 — cross-tool memory (row 23) — no Antigravity CLI e2e container or scenario variant
  exists. Out of scope per spec 0058.
- [GAP-soft] e2e pillar 03 — skill build (row 24) — no Antigravity CLI e2e container or scenario variant exists. Out
  of scope per spec 0058.
- [GAP-soft] e2e pillar 04 — harness loop (row 25) — no Antigravity CLI e2e container or scenario variant exists.
  Out of scope per spec 0058.
- [GAP] Usage-capture granularity (rows 8c, 11b) — Antigravity usage records are `session-cumulative`, never
  `per-request` or per-subordinate-agent, and have no backfill (spec 0206 R22/R23); the statusline payload is the only
  usage-bearing channel. Evidence, each link independent: (1) no hook payload carries a token or model field — the
  vendor's `~/.gemini/antigravity-cli/builtin/skills/agy-customizations/docs/hooks.md`, read field by field (#1167
  triage); (2) the per-conversation store the `transcriptPath` points at is sqlite whose payload columns are opaque
  protobuf blobs with no shipped `.proto` — no field could be tied to a token count with confidence (#1167, #1169);
  (3) telemetry is outbound-only (`enableTelemetry`, internal `AnalyticsService`) and the binary carries no `OTEL_*`
  string, so no local exporter exists (#1167); (4) an independent empirical reproduction with commands and outputs on
  upstream feature request
  [google-antigravity/antigravity-cli#366](https://github.com/google-antigravity/antigravity-cli/issues/366) (open, no
  maintainer decision as of 2026-09-24): [comment of
  2026-07-31](https://github.com/google-antigravity/antigravity-cli/issues/366#issuecomment-5140583537) —
  `agy --output-format=json --print=…` yields a print-mode `usage` object only, `--log-file` holds no `token`/`usage`
  field, the `conversations/*.db` protobuf blobs locate one of five known token counts, `OTEL_*` variables produce
  nothing. Revisit when #366 ships.
- [GAP] Windows checkout paths the usage-capture command line cannot carry (rows 8c, 37–37f; spec 0243 R17–R18,
  delta-03) — refused by `scripts/lib/hook-command.ts` with a diagnostic naming the character and the path, and no
  write, never a command line that cannot launch or that would launch the wrong program. A Windows checkout path holding
  whitespace or one of `& | < > ^ % ( )` cannot be wired where the target interpreter is `cmd.exe` and the path must
  stay unquoted, because a double-quoted argument does not group there (row 37b): both Antigravity CLI surfaces,
  `statusLine.command` (row 37e) and the hooks surface (row 37f), which receive the guarded form
  `set NoDefaultCurrentDirectoryInExePath=1&& node <abs> <args>` of #1392. Only the checkout path is judged: the `&&`
  and `=` of the guarded prefix belong to the template. Claude Code, Gemini CLI and Copilot CLI keep the path in double
  quotes, which their interpreters group (row 37b), so a path with a space works for them; `"`, `$`, a backtick, a
  backslash, a carriage return and a newline are refused for every CLI. macOS and Linux are unaffected. Residual (spec
  0243 R36): the guarded form closes only the implicit current-directory step of the `cmd.exe` search, on both surfaces.
  A `PATH` that itself names the current directory — a `.` entry, an empty entry, a relative entry, or an entry the
  user can write that comes before the real `node` — still lets a planted `node` run, and the module never reads,
  rewrites or judges `PATH`. Recovery: for a refused path, move the checkout to a path without the refused character;
  for the residual, remove such an entry from `PATH`, which is machine configuration outside setup's writes.
- [GAP] R12 missing-dependency diagnostic visibility (row 8c; spec 0243 R37–R38, delta-04) — the diagnostic line of
  spec 0243 R12 does not reach the user on every wired CLI. Copilot CLI shows no notice: the line reaches only
  `~/.copilot/logs/process-*.log`. Gemini CLI in interactive mode shows only a generic
  `Hook(s) [<name>] failed for event AfterModel` notice and hides the diagnostic text behind the F12 debug drawer, and
  in both modes `AfterModel` fires once per streamed chunk, so the notice or the line repeats within one turn. Evidence:
  the macOS probe of 2026-10-01 ([#1398](https://github.com/crewrig/crewrig/issues/1398#issuecomment-5935751970)). The
  gap is latent while spec 0243 R11 holds, because no entry point imports a third-party package and no firing takes the
  R12 path. The first change that adds such an import must close it or record per-CLI evidence under spec 0243 R38.
  Per-CLI detail: `docs/usage-capture.md` → *Exit status and blocking*.
- [CLOSED] Usage mirror on Windows (row 8d; spec 0253 delta-04, closed by issue
  [#1515](https://github.com/crewrig/crewrig/issues/1515)) — the detached spawn at the end of `onWrite` in
  `scripts/lib/usage-store/mirror.js` now runs `process.execPath` on `scripts/usage-mirror.ts --from-write` (no shell,
  no `bash`, `windowsHide: true`), with an `error` listener attached before `unref()` and a `try`/`catch` around the
  call, so a failed spawn never changes the write outcome; the pending marker is the recovery. Proved on Linux and on
  `windows-latest` (job `windows-usage-wrappers`) by `scripts/tests/usage-mirror-spawn.test.ts`, which runs with no
  `bash` on `PATH`. `scripts/usage-mirror.sh` was removed in #1344.
- [GAP] Windows: a real MemPalace is unverified, every flow is verified against a fake package (rows 11, 16; spec 0253
  R23 and R27 as modified by delta-03) — the four history importers
  (`scripts/import-{claude,gemini,copilot,antigravity}-history.ts`) and `scripts/prune-transcripts.ts` reach MemPalace
  through a Python interpreter with `mempalace` installed, and no Windows run installs the real package or touches a
  real palace. The `windows-history-import` job runs the TypeScript entries from PowerShell against the runner's real
  Python (`actions/setup-python`) with a FAKE `mempalace` package on `PYTHONPATH` (a `__main__` that logs its arguments
  and exits with a chosen status, and an `mcp_server` with two dummy drawer functions): the interpreter probe, the
  missing-interpreter, missing-source and empty-source paths, the declined and confirmed prompts, the dry-run and real
  `mine` calls with their arguments, the propagation of a failing `mine`, the Antigravity staging directory, and the
  Python body of `prune-transcripts` (dry run, `--apply`, `--project`) all run. A `.cmd` stub cannot be used (Node.js 20.12.2
  and 21.7.3 refuse to spawn `.cmd` or `.bat` files without a shell, CVE-2024-27980). Evidence: the
  `windows-history-import` job (`.github/workflows/build.yml`), added by spec 0253 PR C, passed on `windows-latest`
  (https://github.com/crewrig/crewrig/actions/runs/37983663078, head `09d0858` of PR #1530). The macOS and Linux
  behaviour is also covered by the Bash-driven oracle tests, which formerly called the `.sh` shims (removed).

<!-- Worktree git guard gaps (spec 0248) -->

- [GAP] Windows Antigravity CLI checkout path with whitespace (row 29; spec 0248 R29) — the guard command of the
  Antigravity CLI hooks surface on Windows is the guarded form
  `set NoDefaultCurrentDirectoryInExePath=1&& node <abs>/hooks/worktree-git-guard.ts`, whose path must stay unquoted
  because `cmd.exe` does not group a double-quoted argument (rows 37b, 37f). A checkout path holding whitespace or one
  of `& | < > ^ % ( )` therefore cannot be wired: `scripts/lib/hook-command.ts` refuses it with a diagnostic naming the
  character and the path, setup writes nothing for that CLI and reports the diagnostic, so no guard is registered there
  until the checkout moves to a path without those characters. It is the same refusal, for the same reason, as the
  usage-capture entry above, applied to a second hook; the other three CLIs keep the path in double quotes and are
  unaffected. macOS and Linux are unaffected.
- [GAP] `worktree-claim run` on Windows refuses some `.cmd` and `.bat` commands (row 29; spec 0248 R22) — the wrapped
  command is started from its argument vector with no shell, so on Windows it is resolved the way the platform resolves
  an executable name (a bare name through `PATH` and `PATHEXT` only, never the current directory) and `.exe` and `.com`
  files start directly. A `.cmd` or `.bat` cannot start without `cmd.exe`, so `run` hands one to `cmd.exe` only when
  `cmd.exe` has nothing in it to interpret: a path free of its metacharacters and arguments drawn from a small allowlist
  (`scripts/lib/worktree-claim/launch-windows.ts`). Any other argument or path is refused with exit `1` and a diagnostic **before
  the claim is taken**, never passed to a shell that would read it as syntax and never routed through a POSIX shell. A
  wrapped `npm` or other `.cmd` shim given an argument outside the allowlist is therefore refused on Windows; macOS and
  Linux are unaffected. Each Windows leg is proved by the `windows-worktree-git-guard` job, not by a developer host.
- [GAP] The worktree guard has no shim to fall back on (row 29; spec 0248 R13, R38(g); the shim
  `hooks/worktree-git-guard.sh`, which failed open without Node.js 24, was retired in #1344) — an installation still
  wired to the retired `.sh` path has **no enforcement** until setup is re-run. `scripts/worktree-claim.ts` fails
  closed, since it is invoked by name, since it is invoked by name: one `Error:` line and exit `1`, or the floor guard's
  own status and diagnostic, with the tool not run. A guard wired directly as `node "<abs>/hooks/worktree-git-guard.ts"`
  is not a shim: a Node.js downgraded after setup makes it fail with Node.js's own non-zero status until setup is re-run
  (spec 0243 R30), and how each CLI reads that status is the open measurement below. The Node.js 24 floor is checked at
  setup, not when the hook fires.
- [GAP-confirmation] Exit status `1` of the guard, and the Antigravity CLI hooks-surface working directory (row 29; spec
  0248, open measurements M1 and M2) — **pending owner measurement; no result is recorded here.** The guard refuses
  with exit status `1` on every CLI, as the shell guard did. `docs/usage-capture.md` records Claude Code and Gemini CLI
  reading a status other than `2` as a non-blocking error on the events measured there, and Copilot CLI documenting
  `preToolUse` as fail-closed; the tool events `PreToolUse` (Claude Code), `BeforeTool` (Gemini CLI) and `PreToolUse`
  (Antigravity CLI) are unmeasured in this repository. If status `1` does not block on a CLI, the guard has not
  protected that CLI since spec 0153: record it here, open a separate ticket and a delta of
  `specs/0153-tool-boundary-git-worktree-guard.md`, and the owner decides whether the change waits. M2 asks the working
  directory of the Antigravity CLI `PreToolUse` hook: row 37 records `~\.gemini\config` on the hooks surface for another
  event, which is not a repository, so the claim read cannot succeed there and every prohibited command is refused even
  with a claim held; the behaviour is preserved by spec 0248 and a change is a separate ticket. Both are measured with
  probe case `X2` (`docs/runbooks/windows-hook-parsing-probe.md`): macOS for Claude Code, Gemini CLI and Copilot CLI,
  the Windows host of rows 37e and 37f for Antigravity CLI.
- [GAP] The guard registration outlives the branch that carries its file (row 29; spec 0248, plan hazard O3) — the
  registered command names `<checkout>/hooks/worktree-git-guard.ts` by absolute path (spec 0169), so it keeps pointing
  there after that checkout switches to a branch without the file. On Copilot CLI, whose `preToolUse` is fail-closed, a
  missing `.ts` fails **every** tool call; the other CLIs read the status per M1. **Setup guidance:** run each setup
  from a checkout that stays on a branch carrying `hooks/worktree-git-guard.ts`, never from a throwaway or a linked
  worktree (the installers warn on the latter, `docs/usage-capture.md` → *Checkout-location dependency*). Recovery is
  the one it is for any in-repo path: restore the file or re-run setup from a durable checkout, and, on Copilot CLI,
  remove the guard entry from `~/.copilot/hooks/copilot-transcript-hooks.json` to unblock a session that cannot run a
  tool.

<!-- Session-recording hook gaps (spec 0247) -->

- [GAP] Windows Antigravity CLI checkout path the transcript command cannot carry (rows 8b, 37b, 37f; spec 0247 R20,
  R33) — on Windows the Antigravity CLI hooks surface receives the guarded form
  `set NoDefaultCurrentDirectoryInExePath=1&& node <abs>/hooks/mempalace-transcript.ts antigravity-cli Stop`, whose path
  must stay unquoted because `cmd.exe` does not group a double-quoted argument. A checkout path holding whitespace or
  one of `& | < > ^ % ( )` therefore cannot be wired. `hookCommandLine` in `scripts/lib/hook-command.ts` refuses it with
  a diagnostic naming the character and the path. `scripts/hook-wiring.ts transcript render antigravity` then prints an
  `ERROR: <diagnostic>` line on standard error and leaves the transcript handler out of the rendered manifest, so setup
  writes no transcript command for that CLI and reports session recording as not activated. An installed transcript
  command is left as it is. Evidence: the refusal branch of `hookCommandLine` (`CMD_UNSAFE`, applied when the measured
  interpreter is `cmd.exe`) and its transcript-render test `scripts/tests/hook-transcript-render.test.ts`. It is the
  same refusal, for the same reason, as the usage-capture and worktree-guard entries above, applied to a third hook.
  Claude Code, Gemini CLI and Copilot CLI keep the path in double quotes, which their interpreters group (row 37b), so a
  path with a space works for them. macOS and Linux are unaffected. Recovery: move the checkout to a path without the
  refused character and re-run setup.
- [GAP] Checkout paths no CLI's transcript command can carry (row 8b; spec 0247 R20, R33; spec 0243 R17) — a checkout
  path holding `"`, `$`, a backtick, a carriage return or a newline is refused by `hookCommandLine` for every CLI on
  every OS, and so is a backslash left in a POSIX path. Gemini CLI and Copilot CLI on Windows also refuse the
  typographic double quotes `“ ” „`, which PowerShell reads as quotes. The result is the one of the entry above:
  no transcript command is written for that CLI, and setup says why. Evidence: the same refusal branch of
  `hookCommandLine` and `scripts/tests/hook-transcript-render.test.ts`. Recovery: move the checkout.
- [GAP] The transcript hook cannot run without Node.js 24 when it fires (row 8b; spec 0247 R2, R27, R34) — on every
  CLI and OS, `hooks/mempalace-transcript.ts` needs Node.js 24 or later at firing time. A command still wired to the
  retired `.sh` shim (removed in #1344) records nothing on such a machine, and the setup rewrite re-points it;
  Antigravity CLI still reads its acknowledgement. A command wired directly to the `.ts` is not a shim: with Node.js
  downgraded after setup it fails with Node.js's own non-zero status and no `{}`, until setup is re-run on Node.js 24 or
  later (spec 0243 R30). Setup checks the floor only when it runs, and below it writes no direct form. Evidence: the
  capability `mempalace-transcript-node-24-0` in `ci/ci-capabilities.yml`. Recovery: install Node.js 24 or later and
  re-run setup.

<!-- Validation backend gaps (spec 0080) -->

- [GAP-confirmation] Internal-backend structured interactive prompt on Gemini / Copilot / Antigravity CLI (row 27b) —
  `AskUserQuestion` is confirmed on Claude Code; a structured interactive-prompt equivalent that avoids a bare prose
  question is unverified on the other three CLIs. Evidence to be gathered at DEV; downgrade to a hard [GAP] if none
  exists. The gate SHALL NOT silently degrade to a prose question (spec 0037).
- [GAP] Illustration image display for the `plannotator` backend (row 27) — the illustration option (spec 0080 R14)
  renders only when a browser image surface is available. Unlike the per-CLI gaps above, this is **not** a cross-CLI
  asymmetry: Plannotator renders the artifact as HTML in a browser it launches itself, so image display is a function of
  browser availability, uniform across all four CLIs (spec 0080 OQ4). On the `internal` backend there is no image
  surface on any CLI, and illustration is silently ignored (R14). Recorded as a documented uniform limitation — like
  row 7g (MemPalace wake-up) — so it is not mistaken for a per-CLI parity gap.

<!-- Solo-merge classifier gap (spec 0102) -->

- [GAP-confirmation] Solo-maintainer self-merge classifier block — Claude Code's auto-mode permission classifier can
  deny a `gh pr merge` invocation when the merging identity equals the pull-request author (confirmed on Claude Code:
  the denial text itself names "the Claude Code auto mode classifier"). Whether Gemini CLI, GitHub Copilot CLI, or
  Antigravity CLI exposes an equivalent classifier is **unverified and out of scope** for spec 0102 — no negative is
  asserted about those three. This is an external CLI runtime behaviour with no CrewRig source-of-truth artifact behind
  it, hence a *Parity gaps* note rather than a feature-matrix row. The reactive workaround (self-retry once → hand the
  merge to the user, no laundering to a sibling agent) and the two optional prevention paths are documented in
  `AGENTS.md` → *Branching Strategy* → *On Claude Code CLI — solo-maintainer self-merge block*.

<!-- TaskCreate coordination-primitive gap (spec 0221, issue #1267) -->

- [GAP-confirmation] Claude Code `TaskCreate` coordination primitive — `AGENTS.md` → *Agent Team Protocol* and
  `docs/agent-team-protocol.md` (per spec 0092) name `TaskCreate` as a Claude Code coordination primitive used for
  tracking. This session's `ToolSearch` for `TaskCreate` — and separately for the keywords `task` and
  `create tracking` — returned no matching tool against the current Claude Code harness build, while `TaskStop`,
  `TaskCreate`'s lifecycle counterpart, is confirmed present and loadable. `TaskStop` existing without `TaskCreate` is
  corroborating evidence this is a genuine capability gap in the current build rather than a session-specific fluke or a
  discovery-instrument artifact. This is an external CLI runtime behaviour with no CrewRig source-of-truth artifact
  behind it, hence a *Parity gaps* note rather than a feature-matrix row; unlike most gaps above, no cross-CLI asymmetry
  is asserted — no claim is made about Gemini CLI, GitHub Copilot CLI, or Antigravity CLI. `AGENTS.md` and
  `docs/agent-team-protocol.md` now describe `TaskCreate` as used for tracking only when the harness exposes it, with
  its absence not constituting a protocol violation or a basis for a REVIEW pass `tech`-class finding. Recorded as
  `[GAP-confirmation]` rather than a hard `[GAP]` because a future Claude Code harness release could expose the tool;
  re-verify via `ToolSearch` before citing this entry as still current.

<!-- Ticket-ownership forge gaps (spec 0244) -->

- [GAP-confirmation] Ticket-pickup check on GitLab (row 38) — three mechanics come from the GitLab API reference, not
  a live run: the assignment system-note grammar (`assigned to @a` / `unassigned @b` /
  `assigned to @b and unassigned @a`), the absence of notes for assignees set at creation (the tool assumes none and
  seeds a synthetic creation change), and `PUT assignee_ids` with one element on the Free tier. GitLab also has no
  assignee resource-event API, so the history is parsed from notes; any other system note mentioning "assign" makes the
  check exit `2`, except notes that quote user-chosen text (title, description, milestone, label, commit, branch and
  mention notes), which are ignored. Legacy or alternative forms such as `reassigned to @b` or `removed assignee` are
  therefore deliberately fail-closed (exit `2`) until #1397 confirms which forms supported GitLab versions emit. Verify
  on a gitlab.com sandbox project per the #1387 plan, step 8, tracked by #1397; downgrade to a hard `[GAP]` with GitLab
  failing closed if any of the three does not hold (spec 0244 R12).
- [GAP-confirmation] Ticket-pickup check on Gitea (row 38) — the timeline entry `type` value, the assignee-change
  event grouping of a `PATCH`, and the presence of the dedicated `POST`/`DELETE …/assignees` endpoints — detected
  from the server version against an assumed first release, 1.27.0 — come from the Gitea v1.24 source and the
  published API description, and the pinning of every call to the resolved remote with `tea api --remote <name>` comes
  from the tea 0.16 documentation; none has been exercised in a live run. Verify on gitea.com per the #1387 plan, step
  8, tracked by #1397; downgrade to a hard `[GAP]` with Gitea failing closed if any does not hold (spec 0244 R12). On
  servers without the dedicated endpoints, a lost-update race between a stale read and an add-only `PATCH` is an
  accepted limit (`docs/ticket-ownership.md` → *Accepted limits*).
<!-- MemPalace session-start check gaps (spec 0246, issue #1410) -->

- [GAP] Session-check user channel on Copilot CLI (row 8e) — the warning reaches the model only, through top-level
  `additionalContext`, and the model relays it; R13 is the agent-side complement. Evidence: (1) the [GitHub Copilot
  hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference) → *sessionStart*: "Only
  additionalContext is consumed for sessionStart (command and HTTP variants)", and `systemMessage` appears nowhere in
  that reference, on any event; (2) an empirical reproduction on Copilot CLI 1.0.90 ([issue #1410](https://github.com/crewrig/crewrig/issues/1410#issuecomment-5950885519)):
  a probe emitting `systemMessage`, `hookSpecificOutput.additionalContext` and `additionalContext` with distinct markers
  showed no marker on stderr or in any JSONL event, and only the `additionalContext` marker reached the model. An
  interactive-UI check by the owner is pending; if it shows the `systemMessage` marker, this gap closes and
  `SESSION_CHECK_CHANNELS.copilot.user` is set.
- [GAP-confirmation] Session-check user channel on Antigravity CLI (row 8e) — unconfirmed, pending
  [#1472](https://github.com/crewrig/crewrig/issues/1472). The check emits only the model channel,
  `injectSteps[].ephemeralMessage`, so the warning reaches the user only when the model relays it; R13 is the agent-side
  complement. The prose hooks documentation embedded in `agy` 1.2.14 (*`PreInvocation` Contract*) lists three step
  types, `toolCall`, `userMessage` and `ephemeralMessage`, none of them a user-interface field. The binary's compiled
  output schema, however, has eight step types, and two of them might reach the user: `system_message` and
  `error_message.user_message`. The prose documentation is therefore not the complete output schema, and it does not
  prove a user channel absent. The binary also contains an undocumented `SessionStart` hook (`CallSessionStartHook`).
  The check does not use it. [#1472](https://github.com/crewrig/crewrig/issues/1472) probes both step types and that
  hook live; until then no user field is emitted. Documented alternatives already rejected: a `userMessage` step would
  insert the warning as if the operator had typed it; `PreToolUse`'s `reason` ("Explanation shown to the user/agent")
  requires a `decision`, and `allow` auto-approves the tool call while `ask`, `force_ask` and `deny` interrupt it,
  against R9; `Stop`'s `reason` is injected only with `decision: "continue"`, which blocks the stop, also against R9.
- [GAP-confirmation] Session-check model channel on Gemini CLI (row 8e) — `hookSpecificOutput.additionalContext` is
  documented ([Gemini CLI hooks reference](https://geminicli.com/docs/hooks/reference/) → *SessionStart*: "Injected as
  the first turn in history") but not live-verified. Gemini CLI 0.28.2 fires the hook before authentication, so the user
  channel (`systemMessage`) and the millisecond timeout were verified live, but the probe account then fails with
  `IneligibleTierError … UNSUPPORTED_CLIENT` and no model turn is possible ([issue #1410](https://github.com/crewrig/crewrig/issues/1410#issuecomment-5950885519)).
  The field ships at its documented value, on the evidence of the hooks reference shipped in Gemini CLI 0.28.2 (spec
  0246 delta-02 R7). The live confirmation is tracked in [#1472](https://github.com/crewrig/crewrig/issues/1472): re-run
  the probe with API-key or Vertex authentication; if the marker does not reach the model, set
  `SESSION_CHECK_CHANNELS.gemini.model` to `null` (R7 fallback) and turn this entry into a [GAP].
- [GAP-confirmation] Session-check evidence on Antigravity CLI is documentation-only (row 8e) — no Antigravity account
  was available, so no live `agy` probe ran. Under spec 0246 delta-02 R7 and R8 (owner ruling), the hooks documentation
  embedded in `agy` 1.2.14 is the evidence for every Antigravity cell of row 8e: `conversationId` among the *Common
  Input Fields* of every payload (the throttle key), `injectSteps[].ephemeralMessage` as the `PreInvocation` output, and
  `timeout` in seconds. Only the suppressed-path cost was measured, outside `agy`. Earlier live evidence disagrees on
  one point: on `agy` 1.0.16, `conversationId` was observed on `Stop` only (row 8, Exercise B; spec 0116 delta-03). If
  `PreInvocation` lacks it, the throttle falls back to the 30-minute window, whose measured p95 (85.6 ms) is also within
  the R8 bound. The live confirmation is tracked in [#1472](https://github.com/crewrig/crewrig/issues/1472): it settles
  the payload key, the model channel, and whether a user channel exists.
- [GAP] Session check on platforms other than macOS and Linux (rows 8e, 10) — setup registers no check there on any
  CLI, and removes an entry an earlier run left (spec 0246 delta-01 R11 *Platform*). Evidence: on Windows, Gemini CLI
  and Copilot CLI run hook commands under PowerShell 5.1 and Antigravity CLI under `cmd.exe` (row 37, measured), so the
  POSIX hook command would fail at every session start, against R9; and no daemon supervisor is installed there, so the
  check would stay silent anyway (R6). Uniform across the four CLIs; R13 covers the agent side.

- **[GAP] Skill preload from an agent definition (row 43, spec 0269).** Gemini CLI has no such field: its local-agent
  frontmatter schema is strict and lists no `skills` key (evidence in row 43). Copilot CLI and Antigravity CLI are
  undetermined, so the "read it once at the start" instruction stays everywhere.

- **[GAP] Gemini CLI subagent usage attribution is channel-3 only (row 44, spec 0271 R11).** A Gemini CLI subagent
  record carries its own session id and an `unknown` project root, so the orchestrator's session declaration does not
  cover it; it is attributed through the worktree/branch channel from the capturing process's cwd. Evidence and fixtures
  in row 44. Not an asymmetry of the keep-one-call kind: it fails only when the subagent runs outside a ticket worktree
  or branch, which the Pre-Edit Guard forbids for edits.
