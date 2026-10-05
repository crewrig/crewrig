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
| Antigravity CLI, status line (`antigravity-statusline`) | `~\.gemini\antigravity-cli\settings.json` (`statusLine.command`, merged) | the display-command invocation |

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
| `X1` | exit status | the four hook targets: `record <cli> X1 --exit 1` (spec 0243 R12) |
| `X2` | exit status, guard events | opt-in, on each CLI's tool event instead of its prompt event: `record <cli> X2 --exit 1` (spec 0248 M1, M2) |

The `antigravity-statusline` target (spec 0243 R18, plan step 17) carries only
the cases `I`, `Q0`, `Q1`, `Q4`, `P` and `P2d`. `statusLine.command` is a
single slot, so each case is installed alone and restored before the next; a
bare `install antigravity-statusline`, or one naming several ids, is a usage
error (exit 2) that writes nothing. Every other key of `settings.json`,
including the rest of `statusLine`, is kept and restored byte for byte.
`collect antigravity-statusline` always lists the whole six-case table.

`V` is the CLI's own variable name: `CLAUDE_PROJECT_DIR`, `GEMINI_PROJECT_DIR`,
`COPILOT_PROJECT_DIR` or `ANTIGRAVITY_PROJECT_DIR`.

`record` writes nothing to stdout, so no CLI reads its output as a hook
decision. It exits 0, except when given `--exit <n>` (cases `X1` and `X2`): it then
writes its complete record first and exits `<n>`. Only 0, 1 and 3–255 are
honoured. Exit 2 is never emitted, because it blocks a Claude Code `Stop`; a
refused value is recorded as `exitError` and the hook exits 0. It writes the record file three times: first `argv`, cwd and a
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

Antigravity CLI's status line, one case at a time, from the interactive console
session (the same `agy` authentication constraint as above). No prompt is
needed and none can be scripted: `agy` runs `statusLine.command` on every
render of its idle start-up screen (8 to 12 draws in about 60 s), so start `agy`
interactively in `C:\crewrig-probe\proj`, let the start-up screen render for
about 60 s, then quit. Do not try to send a prompt with `SendKeys` or
`AppActivate` by process id: the keystrokes never reach the window, because
Windows Terminal hosts the console.

The driver that worked is a `schtasks /it` task, created as for the session
commands above, that runs this PowerShell script (save it as
`C:\crewrig-probe\drive-agy.ps1`):

```powershell
$p = Start-Process cmd.exe -ArgumentList '/k','agy' -WorkingDirectory C:\crewrig-probe\proj -PassThru
Start-Sleep 60
taskkill /T /F /PID $p.Id
```

The task's command is `powershell -NoProfile -File C:\crewrig-probe\drive-agy.ps1`
(pass it as `/tr`), created, run, waited on and deleted for each case:

```sh
for id in I Q0 Q1 Q4 P P2d; do
  vm "$P install antigravity-statusline --only $id"
  # run the drive-agy.ps1 task (schtasks /create ... /it, /run, wait ~65 s, /delete)
  vm "$P collect antigravity-statusline"
  vm "$P restore antigravity-statusline"
done
```

Read the interpreter, quoting, working directory and separators from the
`launched=` groups and the parent chain, as for the hook targets. `collect`
prints only the first record, and the `wmic` parent chain it shows is often
`[]`, because the short-lived `cmd /c` has already exited by the time the
snapshot is taken (4 of 12 records caught it on this surface). For the parent
chain, read the raw records under `out\antigravity-statusline\` instead. They
become row 37e of `docs/cli-matrix.md`.

*Source: corrections by @hcross on the row 37e measurement,
<https://github.com/crewrig/crewrig/issues/1389#issuecomment-5915177073>.*

Exit status (case `X1`, spec 0243 R12), one real turn per CLI, macOS or
Windows: `install <cli> --only X1`, run the session command, `collect <cli>`
(it prints `exit status requested: 1`), note whether the turn completed, whether
the CLI showed a hook-error notice, and whether anything was blocked, then
`restore <cli>`. The probe fires on each CLI's prompt event
(`UserPromptSubmit`, `BeforeAgent`, `userPromptSubmitted`), so record the
event next to the result.

Guard events (case `X2`, spec 0248 M1 and M2). Two questions about the worktree
git guard (`docs/cli-matrix.md` row 29) were never measured: does exit status
`1` block a tool call on each CLI's tool event, and in which directory does the
hook run. `X2` answers both with a hook registered where the guard is, and it is
**opt-in**: a bare `install <cli>` skips it, because a blocking tool hook would
stop every tool call of the session. Install it alone with
`install <cli> --only X2`. The entry goes on:

| CLI | Event |
|---|---|
| Claude Code | `PreToolUse`, matcher `Bash` |
| Gemini CLI | `BeforeTool`, matcher `run_shell_command` |
| Copilot CLI | `preToolUse` |
| Antigravity CLI | `PreToolUse`, matcher `run_command`, under the named hook `crewrig-probe` |

The hook writes its usual record (its working directory is the `cwd` field),
prints one line to standard error, `crewrig-probe X2: tool call refused, exit
status 1 requested`, and exits 1, as the guard does on a refusal. The decision
comes from a second command, run by the session and not by a hook: `node
<root>/kit/probe.ts marker <cli>` writes `out\<cli>\X2-marker.txt`. The marker
file's presence answers whether status 1 blocks the call.

1. `install <cli> --only X2`. It deletes any earlier marker and prints the
   marker command to ask for.
2. Start a session in `C:\crewrig-probe\proj` and ask it to run that marker
   command once, for example `claude -p "Run this shell command and report its
   output: <marker command>"`. A tool event does not fire on a plain prompt, so
   the session must actually call its shell tool.
3. `collect <cli>`. It prints `marker: present` or `marker: absent` and a
   verdict line: marker absent means status 1 blocked the tool call; marker
   present means the call ran, so status 1 did not block; `inconclusive` means
   the hook never fired, and the event may not fire on that surface. Note the
   CLI's own error notice, if any, and the `cwd` of the record (for Antigravity
   CLI that is M2: a directory that is not a repository means the guard's claim
   read cannot succeed there).
4. `restore <cli>`, even when the session was blocked: a blocking `preToolUse`
   on Copilot CLI stops every tool call until the entry is removed.

Run it on macOS for Claude Code, Gemini CLI and Copilot CLI, and on the Windows
host of rows 37e and 37f for Antigravity CLI, from the interactive console
session that CLI needs (see above). The results belong in `docs/cli-matrix.md` row 29 and its *Parity gaps*
entry; until they are recorded there, both questions stay open.

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
