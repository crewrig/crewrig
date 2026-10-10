---
id: "0255"
slug: install-manage-link-typescript
status: draft
complexity: standard
interaction-mode: MINIMAL
related-issue: 1334
version: 1.2.0
---

# Install, manage and link scripts in TypeScript

*Delta 02 of `specs/0255-install-manage-link-typescript.md`. Source: ticket 1334,
the differential test of PR C (`scripts/tests/install-differential.test.ts`, which
runs the unchanged shell scripts and the TypeScript entries over the same sandbox
and fails on any difference not tagged with a letter of requirement 22). It runs
under the release-branch regime of
`specs/0215-shell-to-typescript-migration.delta-04.md`: its spec-PR targets
`release/1231-ts-migration`, and the base ref of every protocol is
`origin/release/1231-ts-migration` (requirement 34 of that delta). Requirement 22
of the parent closes the list of deviations at letters (a) to (k) and reserves
letters (l) onward for what the differential test discovers, to be recorded by a
delta. The test found two: a symbolic link at the target of an MCP
configuration merge whose own target cannot be created, which adds deviation (l), and one byte of output on the
end-of-input path of the one-key prompt, which is stated as part of deviation (c)
and listed as (m). The version is a MINOR bump: the two deviations are additions to
a closed list and no requirement is invalidated. This delta changes no other
requirement of the parent and opens no question.*

## ADDED

**Scenario:** An unwritable link at a JSON configuration is an error, not a success

Given `~/.copilot/mcp-config.json` is a symbolic link into a directory that does not exist, and an
MCP declaration `<name>.json`
When `node scripts/manage-copilot-component.ts install mcp-servers <name>` runs
Then it exits 1 with one `Error: <message>` line on standard error naming the link's
path, its unresolvable target and the corrective action (create the target's directory
or remove the link), prints no
`Merged:` line, and creates nothing: the link is unchanged, nothing exists at its
target and no `.bak` file is left.

## MODIFIED

**Requirement 22 — Listed deviations.** Original, the closing sentence of the list as
it stands after delta 01 of this spec (letters (a) to (k) are unchanged):

> (k) the shell's `ln -s` on Windows (Git Bash msys, which may copy silently) is not
> reproduced. Letters (l) onward are reserved for deviations the plan's differential
> test discovers and a `delta-01` of this spec records.

Replacement:

> (k) the shell's `ln -s` on Windows (Git Bash msys, which may copy silently) is not
> reproduced; (l) when the target of a JSON configuration merge (the `mcpServers` merge of
> the Copilot, Antigravity and Gemini manage scripts and the `themes` merge of the Gemini
> manage script) is a symbolic link whose own target cannot be created (for example
> `~/.copilot/mcp-config.json`, `~/.gemini/settings.json` or
> `~/.gemini/antigravity-cli/settings.json` pointing into a directory that does not
> exist; a link to a missing file in an existing directory is written through, as the
> shell did), the shell's merge sequence (the initial write, the `.bak` copy and the
> `jq … > "$config_file"` redirect) failed on standard error, yet, because every driver
> runs the merge handler under `|| exit $?`, which suspends `set -e`, the script printed
> `Merged: <name> into <key>` and exited 0 having written nothing; the TypeScript entry
> exits 1 with one `Error: <message>` line on standard error, which names the path of the
> link, the target that cannot be created and the corrective action (create the target's
> directory or remove the link), prints no `Merged:` line
> and writes nothing (no `.bak` file either), because reporting success while nothing
> was written is a defect, and the observable changes are that exit status and that
> output line; (m) deviation
> (c) includes one difference of the last output byte: at end of input the shell's
> `read -n 1` failed and `set -e` aborted the script before its `echo ""`, so it
> printed no trailing line feed, whereas the TypeScript entry prints the line feed it
> prints on every other answer, then exits 1 as the shell did. Letters (n) onward are
> reserved for deviations the plan's differential test discovers and a `delta-03` of
> this spec records.

The modes of the JSON files the merge writes are not a deviation: the TypeScript
entries keep the shell's behaviour (an existing file keeps its mode; a new file takes
`0666` less the process `umask`), so no letter is listed for them.

## REMOVED

None.
