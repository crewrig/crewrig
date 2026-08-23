# Gemini extension `mcpServers` path-form evidence (spec 0173 R14, as amended)

Scope: pin the one path form Gemini CLI demonstrably resolves for an
`mcpServers.<name>.args` entry, from the installed tool, against a rendered
build tree installed from a local path — the state the render-at-publication
model (`specs/0173-extension-declaration-model.delta-01.md`) actually ships,
not a committed sibling loaded in place. Issue #1004. Date: 2026-08-23.

## Method

Both arms come from one throwaway synthetic extension (`probe-mcp`), never
committed, built under `mktemp -d`:

- `extension.json` declares one MCP server, `command: "node"`, with `args`
  set to the form under test.
- `dist/index.js` is a trivial stand-in (`console.error(...); process.exit(0)`)
  — it does not need to speak the MCP protocol; only whether Gemini resolves
  the path to it is under test.

For each arm: rendered with `bash scripts/build-extension.sh --target gemini
probe-mcp` into `build/extensions/probe-mcp/`, installed from there with `bash
scripts/install-extension.sh install probe-mcp` (default `cp -rf` mode,
`scripts/install-extension.sh:53`), against an isolated `$HOME` (a fresh
`mktemp -d`, so the probe never touches a real `~/.gemini`), then read back
with `gemini mcp list`. Both the render and the install ran from a sandbox
copy of `scripts/` (not the live repository), so the whole artifact is
regenerable by the next agent with nothing installed but Gemini CLI itself.

**Environment.** Gemini CLI version `0.46.0`. Install mode: copy (default);
link mode (`ln -s`, `scripts/install-extension.sh:50`) resolves to the same
absolute build-directory path and is not expected to differ. Tree ref: the
`scripts/build-extension.sh` and `scripts/install-extension.sh` introduced on
branch `feat/1004-extension-declaration-model` (issue #1004), based on
`crewrig/main` at `7b518bf`.

## Arm A — bare form (`"dist/index.js"`)

Rendered `gemini-extension.json` (installed, unresolved):

```json
{
  "mcpServers": {
    "default": { "command": "node", "args": ["dist/index.js"] }
  }
}
```

`gemini mcp list` output:

```text
○ default (from probe-mcp): node dist/index.js (stdio) - Disabled
```

The command Gemini would spawn is `node dist/index.js` — a path relative to
whatever Gemini's own working directory happens to be at spawn time, **not**
to the extension's install directory. Not the form that resolves.

## Arm B — braced form (`"${extensionPath}/dist/index.js"`)

Rendered `gemini-extension.json` (installed, unresolved):

```json
{
  "mcpServers": {
    "default": { "command": "node", "args": ["${extensionPath}/dist/index.js"] }
  }
}
```

`gemini mcp list` output (the fake, per-probe `$HOME` redacted to
`<FAKE_HOME>`):

```text
○ default (from probe-mcp): node <FAKE_HOME>/.gemini/extensions/probe-mcp/dist/index.js (stdio) - Disabled
```

Gemini resolved `${extensionPath}` to the extension's own absolute install
directory. This is the form that resolves.

## Conclusion

`${extensionPath}/…` is the form Gemini CLI demonstrably resolves when
loading an extension installed from a rendered build tree. This is not a new
finding relative to the interim fix of issue #725's S0 — it re-derives the
same conclusion against the state the render-at-publication model actually
ships (a build tree installed from a local path), per requirement 14 as
amended. `extensions/core/hello-world/extension.json`'s
`mcpServers.default.args` already carries this form (step 5 of the issue
#1004 PLAN keeps it), and `scripts/build-extension.sh` passes a declared
`args` value through to the built manifest verbatim — the render does not
itself resolve or rewrite the form, so declaring the wrong one still ships
the wrong one; this evidence is what tells an author which one to declare.

**Both `- Disabled` lines are Gemini's untrusted-folder MCP suppression**
(`gemini mcp list`'s own warning: "MCP servers are configured but disabled
because this folder is untrusted"), unrelated to path resolution — both arms
show it identically, and the command string each line displays (unresolved
vs. resolved to an absolute path) is the evidence this file exists to record.

## Sibling evidence — R15 build-against-build conformance (one-time DEV proof)

Requirement 15 as amended (`specs/0173-extension-declaration-model.delta-01.md`)
asks for one one-time proof that the generalized pipeline's outputs are
unchanged relative to the pre-change render, compared build against build
since no committed command form survives to serve as the baseline. Method:
`git worktree add --detach` at the merge-base (`7b518bf`, unchanged at the
time of this proof — no commit had yet landed on this branch), then:

- **Gemini command form.** `bash scripts/build-extension-pivot.sh hello-world
  --check` in the pre-change worktree confirms the committed `hello.toml`
  (still present there) matches its pivot; `bash scripts/build-extension.sh
  --target gemini hello-world` here produces `build/extensions/hello-world/
  commands/hello.toml`. `diff -q` between the two: **identical.**
- **Claude, Copilot, Antigravity plugins.** The pre-change worktree's
  `build-claude-plugin.sh` / `build-copilot-plugin.sh` /
  `build-antigravity-extension.sh` against a `mktemp -d` output root, and this
  branch's `build-extension.sh --target all hello-world` (which delegates to
  the same three builders, unchanged) against their default output roots.
  `diff -r`, after normalizing each side's own absolute output-root path to
  `<PLUGIN_ROOT>` (the only difference `.mcp.json`'s resolved `${extensionPath}`
  can carry, since the two renders necessarily write to different absolute
  paths): Copilot and Antigravity outputs are **byte-identical** with no
  normalization needed; the Claude plugin's `.mcp.json` differs only in the
  absolute path literal and is **byte-identical after normalization**, every
  other file byte-identical without it.

**Conclusion: all four targets' outputs are unchanged relative to the
pre-change render.** The permanent guard,
`scripts/tests/test-extension-render-conformance.sh`, pins the produced FILE
SET for each target (a heredoc'd, human-readable expected-path list per
target) rather than a content digest — this one-time proof is what
establishes the content-level baseline the permanent guard does not itself
re-assert on every run.

## Corroboration (not re-derived here)

The third-party `gemini-cli-security` extension's absolute-path observation,
cited in prior evidence for this ticket, is recorded as corroboration only —
it is not independently re-derived in this file because that extension is not
installed in this environment. The conclusion above stands on the live probe
alone.
