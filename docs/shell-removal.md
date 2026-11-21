# Shell Removal Migration Table

<!-- crewrig-doc: published=false -->

Spec 0266 removes the last Bash entry points of the TypeScript migration
(epic #1231). Each removed path has a TypeScript replacement; this table is the
one place that maps the old path to the new command. Later removal slices add
their rows here.

| Removed path | Replacement command | Removed in |
| --- | --- | --- |
| `artifacts/library/skills/harness-curator/scripts/curate.sh` | `node artifacts/library/skills/harness-curator/scripts/curate.ts` | #1344 (J4, slice S3b) |
| `artifacts/library/skills/harness-curator/scripts/schedule-curator.sh` | `node artifacts/library/skills/harness-curator/scripts/schedule-curator.ts` | #1344 (J4, slice S3b) |
| `artifacts/library/skills/harness-curator/scripts/setup-labels.sh` | `node artifacts/library/skills/harness-curator/scripts/setup-labels.ts` | #1344 (J4, slice S3b) |
| `scripts/check-agents-size.sh` | `node scripts/check-agents-size.ts` | #1344 slice 3c |
| `scripts/check-extension-provenance.sh` | `node scripts/check-extension-provenance.ts` | #1344 slice 3c |
| `scripts/check-feedback-routing.sh` | `node scripts/check-feedback-routing.ts` | #1344 slice 3c |
| `scripts/check-figure-labels.sh` | `node scripts/check-figure-labels.ts` | #1344 slice 3c |
| `scripts/check-gemini-overlay-enrollment.sh` | `node scripts/check-gemini-overlay-enrollment.ts` | #1344 slice 3c |
| `scripts/check-markdown-links.sh` | `node scripts/check-markdown-links.ts` | #1344 slice 3c |
| `scripts/check-no-machine-paths.sh` | `node scripts/check-no-machine-paths.ts` | #1344 slice 3c |
| `scripts/check-skill-versions.sh` | `node scripts/check-skill-versions.ts` | #1344 slice 3c |
| `scripts/check-test-strays.sh` | `node scripts/check-test-strays.ts` | #1344 slice 3c |
| `scripts/check-test-wiring.sh` | `node scripts/check-test-wiring.ts` | #1344 slice 3c |
| `scripts/import-claude-history.sh` | `node scripts/import-claude-history.ts` | #1344 slice 3c |
| `scripts/import-gemini-history.sh` | `node scripts/import-gemini-history.ts` | #1344 slice 3c |
| `scripts/import-copilot-history.sh` | `node scripts/import-copilot-history.ts` | #1344 slice 3c |
| `scripts/import-antigravity-history.sh` | `node scripts/import-antigravity-history.ts` | #1344 slice 3c |
| `scripts/usage-price.sh` | `node scripts/usage-price.ts` | #1344 slice 3c |
| `scripts/usage-query.sh` | `node scripts/usage-query.ts` | #1344 slice 3c |
| `scripts/usage-attribute.sh` | `node scripts/usage-attribute.ts` | #1344 slice 3c |
| `scripts/usage-backfill.sh` | `node scripts/usage-backfill.ts` | #1344 slice 3c |
| `scripts/usage-dashboard.sh` | `node scripts/usage-dashboard.ts` | #1344 slice 3c |
| `scripts/usage-drain.sh` | `node scripts/usage-drain.ts` | #1344 slice 3c |
| `scripts/usage-prune.sh` | `node scripts/usage-prune.ts` | #1344 slice 3c |
| `scripts/usage-task.sh` | `node scripts/usage-task.ts` | #1344 slice 3c |
| `scripts/worktree-claim.sh` | `node scripts/worktree-claim.ts` | #1344 slice 3c |
| `scripts/prune-transcripts.sh` | `node scripts/prune-transcripts.ts` | #1344 slice 3c |
| `scripts/doctor-mempalace.sh` | `node scripts/doctor-mempalace.ts` | #1344 slice 3c |
| `scripts/switch-mempalace-http.sh` | `node scripts/switch-mempalace-http.ts` | #1344 slice 3c |
| `scripts/repair-mempalace-http.sh` | `node scripts/repair-mempalace-http.ts` | #1344 slice 3c |
| `scripts/uninstall-mcp-daemon.sh` | `node scripts/uninstall-mcp-daemon.ts` | #1344 slice 3c |
| `scripts/stop-mcp-server.sh` | `node scripts/stop-mcp-server.ts` | #1344 slice 3c |
| `scripts/status-mcp-server.sh` | `node scripts/status-mcp-server.ts` | #1344 slice 3c |
| `scripts/start-chroma-server.sh` | `node scripts/start-chroma-server.ts` | #1344 slice 3c |
| `scripts/stop-chroma-server.sh` | `node scripts/stop-chroma-server.ts` | #1344 slice 3c |
| `scripts/sync-from-upstream.sh` | `node scripts/sync-from-upstream.ts` | #1344 slice 3c |
| `scripts/build-antigravity-extension.sh` | `node scripts/build-antigravity-extension.ts` | #1344 slice 3c |
| `scripts/build-copilot-plugin.sh` | `node scripts/build-copilot-plugin.ts` | #1344 slice 3c |
| `scripts/install-antigravity-extension.sh` | `node scripts/install-antigravity-extension.ts` | #1344 slice 3c |
| `scripts/install-claude-plugin.sh` | `node scripts/install-claude-plugin.ts` | #1344 slice 3c |
| `scripts/install-copilot-plugin.sh` | `node scripts/install-copilot-plugin.ts` | #1344 slice 3c |
| `scripts/install-extension-all.sh` | `node scripts/install-extension-all.ts` | #1344 slice 3c |
| `scripts/install-extension.sh` | `node scripts/install-extension.ts` | #1344 slice 3c |
| `scripts/install-workspace.sh` | `node scripts/install-workspace.ts` | #1344 slice 3c |
| `scripts/link-extensions.sh` | `node scripts/link-extensions.ts` | #1344 slice 3c |
| `scripts/manage-antigravity-component.sh` | `node scripts/manage-antigravity-component.ts` | #1344 slice 3c |
| `scripts/manage-claude-component.sh` | `node scripts/manage-claude-component.ts` | #1344 slice 3c |
| `scripts/manage-copilot-component.sh` | `node scripts/manage-copilot-component.ts` | #1344 slice 3c |
| `scripts/manage-workspace-component.sh` | `node scripts/manage-workspace-component.ts` | #1344 slice 3c |
| `scripts/setup-antigravity-interactive.sh` | `node scripts/setup-antigravity-interactive.ts` | #1344 slice 3c |
| `scripts/setup-claude-interactive.sh` | `node scripts/setup-claude-interactive.ts` | #1344 slice 3c |
| `scripts/setup-copilot-interactive.sh` | `node scripts/setup-copilot-interactive.ts` | #1344 slice 3c |
| `scripts/setup-gemini-interactive.sh` | `node scripts/setup-gemini-interactive.ts` | #1344 slice 3c |
| `scripts/unlink-component.sh` | `node scripts/unlink-component.ts` | #1344 slice 3c |
| `scripts/unlink-extensions.sh` | `node scripts/unlink-extensions.ts` | #1344 slice 3c |
| `scripts/check-core-paths.sh` | `node scripts/check-core-paths.ts` | #1344 slice 3c |
| `scripts/check-claude-agent-layout.sh` | `node scripts/check-claude-agent-layout.ts` | #1344 slice 3c |
| `scripts/check-component-metadata-keys.sh` | `node scripts/check-component-metadata-keys.ts` | #1344 slice 3c |
| `scripts/check-extension-hook-map.sh` | `node scripts/check-extension-hook-map.ts` | #1344 slice 3c |
| `scripts/check-extension-hook-tokens.sh` | `node scripts/check-extension-hook-tokens.ts` | #1344 slice 3c |
| `scripts/check-extension-manifest-version.sh` | `node scripts/check-extension-manifest-version.ts` | #1344 slice 3c |
| `scripts/check-extension-pivot.sh` | `node scripts/check-extension-pivot.ts` | #1344 slice 3c |
| `scripts/build-docs-index.sh` | `node scripts/build-docs-index.ts` | #1344 slice 3c |
| `scripts/build-extension.sh` | `node scripts/build-extension.ts` | #1344 slice 3c |
| `scripts/build-claude-plugin.sh` | `node scripts/build-claude-plugin.ts` | #1344 slice 3c |
| `scripts/migrate-extension.sh` | `node scripts/migrate-extension.ts` | #1344 slice 3c |
| `scripts/create-extension.sh` | `node scripts/create-extension.ts` | #1344 slice 3c |
| `scripts/package-extension.sh` | `node scripts/package-extension.ts` | #1344 slice 3c |
| `scripts/package-extensions.sh` | `node scripts/package-extensions.ts` | #1344 slice 3c |
| `scripts/release-package-extension.sh` | `node scripts/release-package-extension.ts` | #1344 slice 3c |
| `scripts/monorepo-release.sh` | `node scripts/monorepo-release.ts` | #1344 slice 3c |
| `scripts/merge-spec-pr.sh` | `node scripts/merge-spec-pr.ts` | #1344 slice 3c |
| `scripts/sweep-en-us.sh` | `node scripts/sweep-en-us.ts` | #1344 slice 3c |
| `scripts/lib/common.sh` | The TypeScript setup modules under `scripts/lib/setup/` and the service modules under `scripts/lib/service/`; the MemPalace pin moved to `scripts/lib/mempalace-pin.json` | `#1344 slice 5` |
| `scripts/lib/gemini-settings.sh` | `scripts/lib/setup/gemini-settings.ts`, `gemini-settings-merge.ts`, `gemini-settings-seed.ts`; `scripts/lib/jsonc.ts` | `#1344 slice 5` |
| `scripts/lib/mcp-daemon-launcher.sh` | `scripts/lib/service/launcher/mcp-daemon-launcher.ts`, installed by `scripts/lib/service/program-install.ts` | `#1344 slice 5` |
| `scripts/lib/render-command.sh` | `scripts/lib/render-command.ts` | `#1344 slice 5` |
| `scripts/lib/usage-capture-optin.sh` | `scripts/usage-capture-optin.ts` and `scripts/lib/setup/usage-capture*.ts`, `session-recording*.ts`, `hooks-rewrite.ts` | `#1344 slice 5` |
| `scripts/lib/extension-hooks.sh` | `scripts/lib/extension/hooks-emit.ts`, `hooks-resolve.ts`, `hooks-vocab.ts`, `validate-hooks.ts` | `#1344 slice 5` |
| `scripts/lib/extension-install.sh` | `scripts/lib/install/antigravity-tokens.ts` | `#1344 slice 5` |
| `scripts/usage-mirror.sh` | `scripts/usage-mirror.ts` | `#1344 slice 5` |
| `scripts/status-chroma-server.sh` | `scripts/status-chroma-server.ts` | `#1344 slice 5` |
| `hooks/usage-capture.sh` | `hooks/usage-capture.ts` (an installed `bash .../usage-capture.sh` line is rewritten to `node .../usage-capture.ts` by the next setup run) | `#1344 slice 5` |
| `hooks/mempalace-transcript.sh` | `hooks/mempalace-transcript.ts` (same rewrite on the next setup run) | `#1344 slice 5` |
| `hooks/worktree-git-guard.sh` | `hooks/worktree-git-guard.ts` (same rewrite on the next setup run; the guard is absent until then) | `#1344 slice 5` |
| `scripts/lib/tls-exec.sh` | `scripts/tls-exec.ts` (module `scripts/lib/tls-exec/run.ts`). An installed MCP registration or Chroma unit still naming `bash <repo>/scripts/lib/tls-exec.sh` is rewritten by the next `node scripts/setup-<cli>-interactive.ts` run, and until then it fails with a missing-file error | `#1344 slice 5b` |
| `scripts/lib/tls-delegation.sh` | `scripts/tls-delegation.ts` (detection `scripts/lib/setup/tls-detect.ts`, offer `scripts/lib/setup/tls-offer.ts`) | `#1344 slice 5b` |
| `scripts/build-ci.sh` | `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/build-ci.ts` | #1344 slice 6 |
| `scripts/check-agent-profiles.sh` | `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-agent-profiles.ts` | #1344 slice 6 |
| `scripts/check-ci-parity.sh` | `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-ci-parity.ts` | #1344 slice 6 |
| `scripts/check-model-mappings.sh` | `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-model-mappings.ts` | #1344 slice 6 |
| `scripts/check-spec-id-reserved.sh` | `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-spec-id-reserved.ts` | #1344 slice 6 |
| `scripts/ci-cache-guard.sh` | `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/ci-cache-guard.ts` | #1344 slice 6 |
| `scripts/ci-changeset-coverage.sh` | `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/ci-changeset-coverage.ts` | #1344 slice 6 |
| `scripts/reserve-spec-id.sh` | `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/reserve-spec-id.ts` | #1344 slice 6 |
| `scripts/build-components.sh` | `node scripts/build-components.ts` | #1344 slice 6 |
| `tests/e2e/lib/test-gemini-headless.sh` | `node tests/e2e/lib/test-gemini-headless.ts` | #1344 slice 6 |
| `task skill:check` (inline `yq`/`awk` script) | `node scripts/check-skill-mirrors.ts <skill-name>` | #1344 slice 6 |

From a built skill directory the same commands read `node scripts/curate.ts`,
`node scripts/schedule-curator.ts` and `node scripts/setup-labels.ts`; the
arguments are unchanged.

## Harness Curator scheduled job (manual step)

The three `.sh` files were forwarding shims (spec 0258 R32) that ran the
`.ts` entry. Anything that still invokes them by path fails once they are gone.

- **Linux with a crontab entry.** A crontab written by an earlier
  `schedule-curator.sh` still names `curate.sh`, so the job now fails. Run
  `crontab -e`, delete the marker line
  `# crewrig-harness-curator (managed by schedule-curator.sh)` and the command
  line directly below it, then re-run
  `node artifacts/library/skills/harness-curator/scripts/schedule-curator.ts`
  to register the current schedule (a systemd user timer). The job logs to
  `~/.local/state/crewrig/harness-curator.log`, where the failures appear until
  the entry is removed.
- **macOS.** The launchd plist is replaced in place by the new
  `schedule-curator.ts`; nothing to remove manually.
- **Other callers.** Update any script, alias or CI job that runs
  `bash .../curate.sh`, `bash .../schedule-curator.sh` or
  `bash .../setup-labels.sh` to the `node ...ts` form above.

## Adopter notes for removed entry points (slice 3c)

Every `.sh` path in the table above was a forwarding shim that ran the `.ts`
entry beside it, with the same arguments. Your own scripts, cron jobs, CI steps
and documents that call `bash <checkout>/scripts/<name>.sh` must call
`node <checkout>/scripts/<name>.ts` instead.

- **`import-*-history` and `usage-*` entries.** The same rule applies; the
  Taskfile targets already use the `node` form.
- **`scripts/usage-task.sh`.** Copies of the global rule file
  `~/.claude/rules/60-tools.md` installed by an older version still say
  `bash scripts/usage-task.sh set ...` in the session-start protocol. Re-run
  setup to refresh them; the current rule says
  `node scripts/usage-task.ts set ...`.
- **MemPalace, Chroma and daemon scripts** (`doctor-mempalace`,
  `switch-mempalace-http`, `repair-mempalace-http`, `uninstall-mcp-daemon`,
  `start-chroma-server`, `stop-chroma-server`, `stop-mcp-server`,
  `status-mcp-server`), `worktree-claim` and `prune-transcripts`: launchd or
  systemd units, cron entries and runbooks that name the `.sh` path must name
  `node <checkout>/scripts/<name>.ts`.
- **`scripts/sync-from-upstream.sh`.** An adopter's own scripts, cron jobs and
  documents must call `node <checkout>/scripts/sync-from-upstream.ts`. An
  adopter whose copy of `sync-from-upstream.ts` is defective restores the last
  shell version with
  `git checkout cad08ac64d30dcd3ed96b4aadaf156ed7673abae -- scripts/sync-from-upstream.sh`.
  This works only while that commit is an ancestor of `main`, which holds
  because the final merge of epic #1231 is a merge commit (spec 0266 R12).
- **Setup entry points.** The four `setup-<cli>-interactive.sh` scripts are
  gone. Run setup as `node <checkout>/scripts/setup-<cli>-interactive.ts`
  (or `task setup-<cli>-interactive`); an adopter's own scripts and documents
  that call the `.sh` path must be updated.
- **Install, manage, link and build entries** (`install-*`, `manage-*`,
  `link-extensions`, `unlink-*`, `build-copilot-plugin`,
  `build-antigravity-extension`): call `node <checkout>/scripts/<name>.ts`.
  `scripts/build-components.sh` is removed in slice 6: call
  `node <checkout>/scripts/build-components.ts` (after
  `node <checkout>/scripts/lib/node-floor-guard.js`).
- **`scripts/reserve-spec-id.sh`, `scripts/check-ci-parity.sh`,
  `scripts/build-ci.sh`.** These forwarding shims are gone, along with
  `check-model-mappings`, `check-agent-profiles`, `check-spec-id-reserved`,
  `ci-cache-guard` and `ci-changeset-coverage`. A contributor's own scripts,
  shell aliases, git hooks and CI jobs must call
  `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON <checkout>/scripts/<name>.ts`
  with the same arguments; the exit status, output and streams are unchanged.
  For `ci-cache-guard`, the wrapped command keeps following `--`.
