# System-context store — per-CLI sandbox read probe

<!-- crewrig-doc: published=false -->

> **Status:** Research deliverable for spec 0068 (issue #503), PLAN v2 Step 1.
> Establishes, per CLI, whether the store installed to `~/.crewrig/system-context/`
> can be read directly at runtime (spec 0068 R6). Every later PLAN step is
> conditioned on this table.
>
> **Method:** Observation-only, black-box. A probe file with a unique token was
> planted at `~/.crewrig/system-context/PROBE.md`, then each CLI was invoked
> headlessly and asked to read that exact absolute path and echo its contents.
> Runs were performed from **both** the pre-trusted working tree **and** a fresh
> scratch directory with no prior trust history, to control for this operator's
> accumulated trust grants (PLAN v2 Finding 2). Copilot's two persistent-config
> surfaces were both probed (PLAN v2 Finding 1).
>
> **Machine / date:** macOS, 2026-07-06. CLI versions: `gemini-cli` 0.46.0
> (Homebrew). Others as installed on `$PATH` at that date.

## Executive summary

1. **Claude Code — PASS-default.** `claude -p` read the store file from an
   untrusted scratch directory, bare, with no flags and no config. The `Read`
   tool has documented unrestricted absolute-path access; the probe confirms it.
2. **Antigravity — PASS-default.** `agy --print` read the store file from an
   untrusted scratch directory, bare, with no flags and no config.
3. **Copilot — PASS with a path grant (no durable config surface).** The read
   capability is real — `copilot -p` read the store file from an untrusted
   scratch directory — **but only** when the store path was allowlisted for the
   invocation (`--add-dir <store>` or `--allow-all-paths`). Path verification
   gates any out-of-workspace absolute read; with tools allowed but the path not
   granted, the read is **denied** (and in headless mode it cannot prompt, so it
   fails). Adding the store to `trustedFolders` in `~/.copilot/config.json` does
   **not** grant a durable cross-project read (tested directly — see §4.3).
4. **Gemini — could not be probed here (auth ineligible) + trust-gated.**
   `gemini -p` fails at authentication on this machine, from **both** the
   trusted working tree and the scratch dir, with `IneligibleTierError`
   (free-tier deprecated → "migrate to the Antigravity suite"). The LLM turn
   never starts, so Gemini's direct-read capability is **unverifiable here**.
   Independently, from an untrusted directory Gemini also hard-stops with exit 55
   (`Gemini CLI is not running in a trusted directory`), reproducing the
   `gemini-cli-auth-blackbox.md` trusted-folder finding. Per the honesty rule
   this is recorded as *could-not-probe*, **not** a fabricated PASS/FAIL, and
   Gemini is handled on the conservative branch (see §5).

## 1. Result table (spec 0068 R6)

| CLI | Headless flag | Verdict | Store read from untrusted scratch dir | Requires |
|---|---|---|---|---|
| Claude Code | `claude -p` | **PASS-default** | ✅ token returned, bare | nothing |
| Antigravity | `agy --print` | **PASS-default** | ✅ token returned, bare | nothing |
| Copilot | `copilot -p` | **PASS-with-path-grant** | ✅ with `--add-dir`/`--allow-all-paths`; ❌ denied without | per-invocation path allowlist **or** interactive approval; no durable config |
| Gemini | `gemini -p` | **could-not-probe (auth ineligible)** | ⚪ unverifiable (auth fails before any tool call); trust-gated by default | working auth **and** workspace trust (`trustedFolders` / `GEMINI_CLI_TRUST_WORKSPACE=true` / `--include-directories`) |

Because not all four are PASS-default, the realization builds the **full** design
(direct-read default + universal explicit-signal fallback + optional MemPalace
enhancement), not the collapsed direct-read-only variant PLAN v2 allowed for the
all-pass case.

## 2. Probe fixture

```text
~/.crewrig/system-context/PROBE.md
  # CrewRig probe file
  Unique token: CREWRIG_PROBE_TOKEN_0068_a7f3e91c
```

Prompt issued to every CLI (absolute path, no `~` expansion left to the CLI):

```text
Read the file at /Users/<user>/.crewrig/system-context/PROBE.md using your
file-reading tool and output ONLY its exact verbatim contents, nothing else.
```

Scratch directory: a `mktemp -d` under `/tmp`, i.e. outside every entry in
`~/.gemini/trustedFolders.json`, `~/.copilot/permissions-config.json`'s
`locations`, and `~/.copilot/config.json`'s `trustedFolders`.

## 3. Pre-existing trust state (documented confound — PLAN v2 Finding 2)

This machine's accumulated grants **would have produced a false PASS** had the
probe run only from the working tree. Confirmed by inspection during the probe:

- `~/.gemini/trustedFolders.json` trusts
  `$HOME/devel/perso/genai/framework` (a direct ancestor of the
  crewrig tree) **and** a case-variant `$HOME/devel` entry (macOS paths are
  case-insensitive → effectively all of `~/devel`).
- `~/.copilot/config.json` `trustedFolders` lists the exact crewrig repo path.
- `~/.copilot/permissions-config.json` `locations` has an approvals entry keyed
  to the exact crewrig repo path.

None of these lists contains `~/.crewrig/system-context` or the scratch dir. The
scratch-dir pass is therefore the representative fresh-adopter signal; the
working-tree pass agreed with it for Claude and Antigravity (both PASS regardless
of cwd), and for Gemini both passes failed identically on auth.

## 4. Per-CLI raw findings

### 4.1 Claude Code — PASS-default

From the scratch dir, both `claude -p "<prompt>"` (bare) and
`claude -p --permission-mode bypassPermissions "<prompt>"` returned the exact
token, exit 0. The `--help` text for the `Read` tool documents unrestricted
absolute-path access by default; the probe confirms the store is readable with no
flags, no config, from any cwd.

### 4.2 Antigravity — PASS-default

From the scratch dir, both `agy --print "<prompt>"` (bare) and
`agy --dangerously-skip-permissions --print "<prompt>"` returned the exact token.
No trusted-directory gate and no path gate were observed for an absolute read.

### 4.3 Copilot — PASS with a path grant only

From the scratch dir:

| Invocation | Result |
|---|---|
| `copilot -p` (bare) | first run: `model_not_supported` (400 CAPIError — an environmental model-config error, not a permission error); on retry: **Permission denied** on the path |
| `copilot -p --allow-all-tools` (tools allowed, path verification ON) | **Permission denied** — `Permission denied and could not request permission from user` |
| `copilot -p --allow-all-tools --allow-all-paths` | ✅ token returned |
| `copilot -p --allow-all-tools --add-dir <store>` | ✅ token returned |

So the gate is **path verification** of the out-of-workspace absolute path, not
tool approval. In headless mode Copilot cannot prompt, so an ungranted path
fails hard; in an interactive session it would prompt the user to approve the
read.

**Durable-config probe (PLAN v2 Finding 1).** `~/.crewrig/system-context` was
appended to `trustedFolders` in `~/.copilot/config.json` (backed up and
restored after), then `copilot -p --allow-all-tools` was run from the scratch
dir with no `--add-dir`/`--allow-all-paths`: still **denied**
(`insufficient permissions`). Conclusion: Copilot's `trustedFolders` governs
workspace-trust prompts for the current project cwd, **not** cross-project
absolute-path reads. There is no persistent config surface to pre-authorize the
store read; the per-invocation flags and interactive approval are the only
grants. Consequence for setup: `setup-copilot-interactive.sh` installs the store
but writes **no** ineffective durable config, and the store's explicit-signal
fallback covers the headless-deny case.

### 4.4 Gemini — could-not-probe (auth ineligible) + trust-gated

From the working tree (`--approval-mode yolo -p`), the scratch dir (same), and
the scratch dir with `GEMINI_CLI_TRUST_WORKSPACE=true`, every run failed at
authentication before any tool call:

```text
Error authenticating: IneligibleTierError: This client is no longer supported
for Gemini Code Assist for individuals. To continue using Gemini, please migrate
to the Antigravity suite of products.
  tierId: free-tier, reasonCode: UNSUPPORTED_CLIENT
```

Separately, from the untrusted scratch dir Gemini reported
`Approval mode overridden to "default" because the current folder is not trusted`
and exited 55 with `Gemini CLI is not running in a trusted directory` (escape
hatches named by the CLI: `--skip-trust`, `GEMINI_CLI_TRUST_WORKSPACE=true`, or
interactive trust). This reproduces the trusted-folder enforcement documented in
`gemini-cli-auth-blackbox.md` (§2.1).

Because the LLM turn never starts, whether trusted-mode Gemini can read an
arbitrary absolute path **outside** its workspace is **not answerable on this
machine**. No PASS/FAIL is fabricated. Gemini is the spec 0068 R6 at-risk CLI: on
a machine with working Gemini auth, the store read would still need workspace
trust to be granted, and the arbitrary-absolute-read question remains open. It is
covered at runtime by the store's explicit-signal fallback.

## 5. Consequences for the build (how Step 1 gates later steps)

- **Single shared stub, not per-CLI text.** `artifacts/core/rules/60-tools.md`
  is installed verbatim to all four CLI homes (`~/.claude/rules/60-tools.md`,
  `~/.gemini/60_TOOLS.md`, `~/.copilot/instructions/60-tools.instructions.md`,
  `~/.gemini/antigravity-cli/60_TOOLS.md`). There is no per-CLI templating of its
  content, so the store-retrieval stub is authored **once** in the universal
  explicit-signal form (direct read → MemPalace optional → explicit signal). This
  is the single-source realization of PLAN v2 Step 9's per-CLI intent: PASS CLIs
  (Claude, Antigravity) take the direct read and never reach the fallback;
  Copilot (headless) and Gemini (unverified) are caught by the fallback. It
  satisfies spec 0068 R4 for **every** CLI.
- **No fabricated per-CLI config.** `setup-copilot` writes no `trustedFolders`
  entry (tested ineffective, §4.3); `setup-gemini` writes no settings mutation
  (unverifiable here). Both install the store identically to Claude/Antigravity.
- **R6 documentation.** Gemini (auth-unverified + trust-gated) and Copilot
  (headless, no durable pre-auth) are the documented trigger conditions for the
  deferred dedicated retrieval service. Building that service stays out of scope
  (spec 0068 "Out of scope").
