# Runbook — extension-scoped MCP server: token resolution and collision probe

<!-- crewrig-doc: published=false -->

Spec 0180 R9 requires the resolution form chosen for each target's MCP
delivery to be "pinned with recorded evidence obtained from that installed
tool against a rendered tree, before the first built MCP declaration for that
tool is delivered." R13 requires each target's own name-collision resolution
to be recorded with evidence rather than assumed uniform across tools.

This runbook is that procedure's documentation.
`scripts/probe-extension-mcp-token.sh` is the procedure.

## Why observation and not the vendor guide

`copilot mcp list`/`copilot mcp get` and `agy mcp list` all echo the
**declared** configuration, not the **launched process** — this was true even
before this probe existed (spec 0180's own `## Open questions` names it: "This
shows the merged declaration rather than the launched process and therefore
settles nothing about expansion inside `args`"). Only a live session that
actually spawns the stdio server settles token expansion, and only a live
session with two same-named declarations at different scopes settles
collision resolution. Reading `plugins.md`/`reference.md` alone gets exactly
one of the four tools right by coincidence and the other three wrong or
unstated — the same lesson spec 0123 already drew for skill/agent discovery.

## Running it

```sh
bash scripts/probe-extension-mcp-token.sh [q1|q2q3|q4|all]
```

Preconditions: `jq`, `copilot`, `agy`, `claude` on `PATH`; `gh` authenticated
(`gh auth login`) for a non-interactive Copilot token. Copilot and Claude are
probed under an **isolated `HOME`** (their plugin/user config never touches
the real `~/.copilot` or `~/.claude`). Antigravity is probed against the
**real** `~/.gemini/config/plugins/` root, mirroring
`scripts/probe-antigravity-discovery.sh`'s own precedent: Antigravity has no
per-invocation `--plugin-dir` equivalent that also exercises `agy plugin
install`'s copy/rewrite behaviour, so the only way to observe the real
install-and-resolve path is to use it, under a uniquely-named artifact,
collision-checked before write and removed unconditionally on exit (including
on an unbound-variable abort — see *A bug caught while authoring this probe*
below).

Cost: one Copilot inference call per Q1 variant (three) plus one for Q4
(billed against the operator's own subscription), and two to three Antigravity
model calls for Q2/Q3/Q4. Each call is bounded (60-90s timeout).

Exit status:

| Exit | Meaning |
|---|---|
| `0` | every requested question produced a definite (possibly negative) answer |
| `1` | precondition failure — a required binary/credential is missing, or the Antigravity install root already exists |
| `2` | a probe ran but produced no definite answer (e.g. a session timed out) — re-run before recording anything |

## The four questions

- **Q1 (Copilot).** Does a plugin-root token expand inside `command`, and
  does a bare relative command resolve via Copilot's own `cwd` default? Three
  variants of the same stdio server (`${PLUGIN_ROOT}/dist/stub.sh`,
  `${COPILOT_PLUGIN_ROOT}/dist/stub.sh`, bare `dist/stub.sh`), each installed
  in turn and exercised by one non-interactive `copilot -p` session. The stub
  server writes its `argv`/`cwd` to a sentinel log OUTSIDE the isolated HOME
  so the probe can inspect it after the session exits.
- **Q2 (Antigravity).** Does a RELATIVE `command`/`args` resolve against the
  plugin's own directory? A stub server declared with a bare relative
  `command` (plus an explicit `"cwd": ""`, to rule out that an empty-string
  `cwd` changes anything), installed into the real customization root, then
  exercised by a session that asks for the full MCP tool-name list. Absence
  from that list — with an empty invocation log — is the negative verdict;
  Antigravity surfaces no error to the operator when a plugin's MCP server
  fails to start.
- **Q3 (Antigravity).** Where does `agy plugin install <dir>` copy the
  plugin, and does it rewrite anything inside `mcp_config.json`? Read
  directly off the tree Q2 already produced: byte-diff the installed
  `mcp_config.json` against the source.
- **Q4 (collision).** How does each tool resolve an extension-declared server
  whose name already exists at another scope? Gemini
  (`bundle/docs/extensions/reference.md:151`, "the server defined in the
  `settings.json` file takes precedence") and Antigravity
  (`plugins.md`, "namespaced if necessary to prevent collisions") are
  **citations** from the vendor's own documentation, recorded in spec 0180's
  `## Open questions` and not re-probed here. Claude and Copilot are **live
  probes**: a plugin declaring server name `probe-args`, a SEPARATE
  user/local-scope declaration of the same name, then inspect which the
  CLI's own `mcp list`/`get` resolves to.

## Results

### 2026-08-25 — `copilot` 1.0.80, `agy` 1.1.19, `claude` 2.1.241, macOS (arm64)

**Q1 — Copilot token expansion: ALL THREE forms spawn correctly.**

| Form | Spawned? | Observed CWD |
|---|---|---|
| `${PLUGIN_ROOT}/dist/stub.sh` | yes | the installed plugin directory |
| `${COPILOT_PLUGIN_ROOT}/dist/stub.sh` | yes | the installed plugin directory |
| bare `dist/stub.sh` | yes | the installed plugin directory |

Both `${PLUGIN_ROOT}` and `${COPILOT_PLUGIN_ROOT}` are injected into the
spawned process's own environment (confirmed via `copilot mcp list --json`,
which additionally shows `"cwd": "${PLUGIN_ROOT}"` merged into the effective
config even when the manifest declares no `cwd` at all) — **Copilot defaults
a plugin-sourced stdio server's `cwd` to its own plugin root**, which is why
even the bare relative form resolves. **Verdict: `${COPILOT_PLUGIN_ROOT}` is
the resolution form** (spec 0180 R7's named resolver for Copilot; requirement
9's evidence-before-delivery is satisfied by this table).

**Q2 — Antigravity relative resolution: FAILS SILENTLY.** A bare relative
`command` (`dist/stub.sh`), with or without an explicit `"cwd": ""`, produces
**no error** and **no tool** — `probe-args` is simply absent from `agy -p`'s
own reported MCP tool list, and the stub's invocation log stays empty (the
server was never spawned). A control run with the **same** plugin but an
**absolute** `command` (`$installed_root/dist/stub.sh`) DID spawn — the stub's
invocation log recorded a real invocation with `CWD` equal to **Antigravity's
own launch directory**, not the plugin root. This is the opposite of
Copilot's default and explains the silent failure: Antigravity's plugin-scoped
MCP server inherits the CLI's own process `cwd`, with no per-plugin default
and no path variable of any kind — `mcp_servers.md`'s own schema table lists
only `command`/`args`/`env`, no `cwd` key at all. **Verdict: no relative form
resolves; Option B (spec 0180 PLAN v5 step 8) is REFUTED by direct evidence.**

Consequence recorded elsewhere: because Antigravity's MCP `cwd` behaviour
(launch-directory-relative) DIFFERS from its hooks `cwd` behaviour (working
directory is the plugin root when a hook fires — see
`scripts/lib/extension-hooks.sh`'s antigravity token-stripping comment), the
`rootToken: null` row in `scripts/lib/extension-targets.json` cannot mean the
same thing for both subjects. For hooks it means "strip the token, the
resulting relative command works." For MCP it must mean "no render-time
substitution — leave `${extensionRoot}` unresolved for the install-time
rewrite (Option A) to find," which is why `ext_mcp_native` implements its own
null-handling rather than reusing `_ext_hooks_resolve_command`.

**Q3 — Antigravity install destination and rewriting.** `agy plugin install
<dir>` copies the plugin verbatim to `~/.gemini/config/plugins/<name>/`,
where `<name>` is `plugin.json`'s own `.name` field (NOT the source
directory's basename) — confirmed by installing a source directory named
differently from its declared plugin name and finding the installed
directory under the declared name. `agy plugin list` names the plugin back
under an `imports` array. **No rewriting of any kind happens at install** —
byte-diffing the installed `mcp_config.json` against the source produced no
difference. **Verdict: the destination is deterministic
(`~/.gemini/config/plugins/<pluginName>/`) and the file arrives unmodified —
exactly the precondition spec 0180 PLAN v5 step 8 Option A needs** ("locate
the installed directory... assert the file exists on disk, then rewrite it
there").

**Q4 — collision resolution, one cell per tool:**

| Tool | Resolution | Evidence |
|---|---|---|
| Gemini | operator/org (`settings.json`) wins over the extension | citation: `bundle/docs/extensions/reference.md:151` |
| Claude | **no collision is possible** — the plugin server is namespaced `plugin:<pluginName>:<serverName>`, distinct from any bare name at user/project scope; both listed side by side | live probe: `claude --plugin-dir ... mcp list` showed both `plugin:crewrig-probe-plugin:probe-args:` and `probe-args:` as separate entries |
| Copilot | **the plugin-sourced entry wins** — a same-named user-scope declaration is written successfully but never appears in the merged `mcp list`/`get` output | live probe: `copilot mcp add` succeeded (confirmed by reading `~/.copilot/mcp-config.json` directly) yet `copilot mcp get probe-args --json` returned only the `"source": "plugin"` entry |
| Antigravity | tools "namespaced if necessary to prevent collisions" | citation: `plugins.md` |

Four tools, three distinct resolution orders (operator-wins, no-collision,
plugin-wins) plus one under-specified "namespaced if necessary" — R13's
"never assert one order across tools that differ" is not a hedge here, it is
the literal finding.

### A bug caught while authoring this probe

The first run of `probe_q2q3_antigravity()` used `local name=...` /
`local install_root=...` and set `trap 'cleanup_agy; cleanup_work' EXIT`
*inside* that function. The trap does not fire at function return — only at
actual script exit, by which point the `local` variables were out of scope.
Under `set -u` the cleanup function aborted on its first line
(`agy plugin uninstall "$name"` — unbound), so **none** of the real-config
cleanup ran: the probe plugin, its install directory, and its `config.json`
entry were left behind in the operator's real Antigravity configuration.
Caught immediately by re-checking `agy plugin list` after the run reported
success, cleaned up by hand, and fixed by promoting the two variables to
globals (`AGY_PROBE_NAME`, `AGY_PROBE_INSTALL_ROOT`) so the trap's own
variable references stay bound regardless of which scope invokes it. Recorded
here because a probe script that silently corrupts the very state it exists
to observe is worse than not having the probe: re-run the fixed script (not
a hand-rolled variant) if this procedure is ever re-established.

### Recording a new run

Append a dated section above rather than editing an existing one. Write
locations as `~/.gemini/…`, not the machine's own `/Users/<login>/…` —
`scripts/check-no-machine-paths.sh` rejects a pasted absolute path.
