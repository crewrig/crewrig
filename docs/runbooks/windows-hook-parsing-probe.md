# Runbook — the Windows hook command-line parsing probe

<!-- crewrig-doc: published=false -->

Spec 0237 (issue #1322, sub-spec B of spec 0215) requires `docs/cli-matrix.md`
rows 37–37d to record, **from a reproduction actually run on Windows**, how
each CLI parses a hook command line: the interpreter it hands the line to, the
quoting rule, how its project-directory variable expands, and how path
separators survive. This runbook is the re-runnable procedure behind those
rows. Re-run it whenever one of the four CLIs changes its major or minor
version, and before sub-spec C (#1326) picks the migrated hooks'
command-line form.

`scripts/probe-windows-hook-parsing.ts` is the whole kit. It is standalone
(Node.js built-ins only, no repository import), so one `scp` copies it to the
Windows host.

This is not a CI gate. It needs the four CLIs installed and authenticated on a
real Windows host, the same stance as `docs/runbooks/extension-hook-probe.md`.
GitHub's `windows-latest` runner is x64 and has none of the four CLIs'
credentials.

## Preconditions

- A Windows host reachable over OpenSSH, with Node.js 24 or later on `PATH`.
- `claude`, `gemini`, `copilot` and `agy` installed and authenticated for the
  account the probe runs as.
- No hook configuration of your own that you mind being snapshotted. The
  probe backs up each file byte for byte and restores it, but read the restore
  contract below first.

## How it works

`setup` creates the layout beside the kit:

```text
C:\crewrig-probe\
  kit\probe.ts                   the probe (scp'd)
  sp ace\probe.ts                copy, for the spaced-path case (Q0)
  proj\                          session cwd; `git init`-ed; the project dir
  proj\.crewrig-probe\probe.ts   copy, for the project-dir cases (M, D)
  out\<cli>\<case>-<ms>-<pid>.json   one record per hook firing
  state.json                     home + per-CLI snapshots
  .crewrig-probe-root            root marker
```

`install <cli>` writes one hook entry per case into that CLI's **user-level**
hook surface, the same surface `docs/cli-matrix.md` row 8 deploys to:

| CLI | File | Event |
|---|---|---|
| Claude Code | `~\.claude\settings.json` (merged) | `UserPromptSubmit` |
| Gemini CLI | `~\.gemini\settings.json` | `BeforeAgent` |
| Copilot CLI | `~\.copilot\hooks\copilot-transcript-hooks.json` | `userPromptSubmitted` |
| Antigravity CLI | `~\.gemini\config\hooks.json` (named hook `crewrig-probe`) | `Stop` |

Every entry runs `node <probe> record <cli> <case> [token]`, and each entry
carries **one** token under test, so a token the interpreter cannot parse only
loses its own entry. The cases:

| Case | Dimension | Token or shape |
|---|---|---|
| `I` | interpreter | none; reads the parent-process command lines |
| `Q0` | quoting | `node "C:/…/sp ace/probe.ts"` (quoted spaced script path) |
| `Q1`–`Q4` | quoting | `"a b"`, `'c d'`, `"e\"f"`, `a^b` |
| `E1`–`E5` | expansion | `"$V"`, `"${V}"`, `"%V%"`, `"$env:V"`, `"${V:-$PWD}"` |
| `M` | expansion | the committed `hooks/<cli>-transcript-hooks.json` shape, `bash` → `node` |
| `D` | expansion | the shape setup deploys: absolute path, Gemini's `VAR=value` prefix, Antigravity's trailing event name |
| `P` | separators | `node C:\crewrig-probe\kit\probe.ts` (backslash script path) |
| `P2a`–`P2e` | separators | `C:\a\b`, `.\r\x`, `\\srv\s`, `C:/a/b`, `./r/x` |
| `P3a`–`P3b` | separators | `/c/crewrig-probe/x`, `/x/y:/z` (MSYS conversion) |
| `I-bash`, `I-ps` | interpreter | Copilot only: case `I` under the entry keys `bash` and `powershell` |

`V` is the CLI's own variable name: `CLAUDE_PROJECT_DIR`, `GEMINI_PROJECT_DIR`,
`COPILOT_PROJECT_DIR` or `ANTIGRAVITY_PROJECT_DIR`.

`record` writes nothing to stdout, so no CLI reads its output as a hook
decision. It writes the record file three times: first `argv`, cwd and a
redacted environment; then the stdin summary; then the parent-process chain.
A CLI that kills a slow hook therefore still leaves the argument evidence.
The chain is one `wmic process get … /format:list` snapshot, which takes about
0.1 s. PowerShell CIM is the fallback for the `I` cases only, because it costs
5–8 s per call and twenty concurrent calls overran Claude Code's 30 s hook
timeout. Environment values are kept only for diagnostic keys, and a key that
looks like a secret (`KEY`, `TOKEN`, `SECRET`, `PASS`, `CRED`, `AUTH`,
`COOKIE`) is always `<redacted>`.

## Running it

From the Mac or Linux side (zsh). Keep `ssh` in a shell function, never in a
variable:

```sh
vm()  { ssh -i ~/.ssh/<key> -o IdentitiesOnly=yes <user>@<host> "$@"; }
vcp() { scp -i ~/.ssh/<key> -o IdentitiesOnly=yes "$@"; }
P='node C:\crewrig-probe\kit\probe.ts'

vm 'mkdir C:\crewrig-probe\kit'
vcp scripts/probe-windows-hook-parsing.ts <user>@<host>:C:/crewrig-probe/kit/probe.ts
vm "$P setup"

# One CLI at a time. Use `;` (not `&&`) so collect and restore always run.
vm "$P install claude"; vm 'cd /d C:\crewrig-probe\proj && claude -p "Reply with the single word OK."'; vm "$P collect claude"; vm "$P restore claude"
```

The other session commands measured on 2026-09-30:

- Gemini CLI: `gemini --skip-trust -p "Reply with the single word OK."`.
- Copilot CLI through Ollama: `ollama launch copilot --yes --model <model> -- -p "Reply with the single word OK."`. Headless `--yes` refuses to start without `--model`.
- Antigravity CLI: `agy --print "Reply with the single word OK."`, **run from the interactive console session**. From a key-authenticated SSH logon it fails with `Error: authentication timed out.` before any hook runs. A temporary scheduled task works: put the session command in a `.cmd` file under `C:\crewrig-probe`, then run `schtasks /create /tn crewrig-probe-agy /tr <file> /sc once /st 23:59 /it /f`, `schtasks /run /tn crewrig-probe-agy`, wait for it to finish, and run `schtasks /delete /tn crewrig-probe-agy /f`.

`install <cli> --only I,Q3,…` installs a subset. Use it to re-run one case, or
to split a run into several shorter sessions. On 2026-09-30, Gemini CLI
reported `Hook timed out after 60000ms` for every hook of some sessions, even
though each hook had written its complete record in under 7 s. Sessions of 4–5
cases completed. `collect` then lists only the installed cases.

Finish with:

```sh
vcp -r <user>@<host>:C:/crewrig-probe/out ./raw     # keep the raw records
vm "$P verify-clean"                                # must print: clean
vm 'rmdir /s /q C:\crewrig-probe'
```

## Retry rule

If `collect <cli>` shows no `I` record, look for a hook enablement flag or a
per-hook interpreter selector in the CLI's own installed material (read-only),
then re-run once with that setting and the CLI's debug flag (`claude
--debug`, `gemini --debug`). Transcribe both attempts. A CLI whose `I` case
never fires on both attempts is a parity gap per spec 0237 R7. Record it with
the transcript as evidence, never as a blank cell.

## Restore contract

- `install` refuses a CLI that is already installed and not yet restored. It
  also refuses when the config file changed since the first snapshot.
- `restore <cli>`, when the file existed before: copies back the byte-exact
  backup `<file>.crewrig-probe.bak`, compares its SHA-256 with the snapshot,
  and removes the backup only on a match. Otherwise it exits 1 and keeps the
  backup.
- `restore <cli>`, when the file was absent before: deletes the file and any
  directory `install` created.
- `verify-clean` re-checks all four files against the snapshots, looks for a
  leftover backup, and looks for the substring `crewrig-probe` in each
  surviving file. It prints `clean` only when every check passes.
- If the driver is interrupted, run `restore <cli>` on its own before any
  other step.

The CLIs also write their own session history: a Claude project folder named
after `C:\crewrig-probe\proj`, Gemini's `~\.gemini\tmp\proj` and
`projects.json` entry, a Copilot session, and an Antigravity conversation.
`verify-clean` does not touch these. Delete the self-contained folders by
hand, and leave entries in the CLIs' own indexes alone.

## Reading a record

`collect` prints one group per case: `launched=yes|no`, the exact hook
command, the `args` received after `record <cli> <case>`, the cwd, the value
of `V` in the hook's environment, and, when the chain was collected, each
ancestor's command line. The nearest ancestor is the interpreter the CLI
chose, or the CLI itself when it spawns the command directly. `launched=no`
with the interpreter's own error in the session output (for example a
PowerShell `ParserError`) is a measured value, not a gap.
