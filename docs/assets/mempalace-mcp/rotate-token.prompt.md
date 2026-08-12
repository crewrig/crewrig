# Prompt sidecar — `rotate-token.png`

<!-- crewrig-doc: published=false -->

Generated for spec 0136 (issue #751), figure step of PLAN v5 (satisfies R13,
R14, R15). Depicts the ordered manual procedure for replacing the shared MCP
daemon's bearer token, in the order that leaves no daemon serving a
superseded value (R5).

**Corrected during REVIEW (cold `architect` pass on #877): the original
version of this figure and the runbook both repeated a false claim inherited
from `scripts/uninstall-mcp-daemon.sh`'s own inline comment** ("mints a new
one, restarts, and re-registers every CLI") — `switch-mempalace-http.sh`
does **not** restart the daemon: `install_daemon_supervisor` skips loading
an already-loaded launchd agent and no-ops `enable --now` on an
already-active systemd unit, and the launcher process `exec`s the wrapper
once and never re-reads the token file
(`scripts/lib/mcp-daemon-launcher.sh:187`). The upstream defect (false
comment, incomplete procedure, no test asserting the old token is refused
after rotation) is filed as #880. This figure now depicts the corrected,
five-step procedure with an explicit daemon-restart step added — its
original four-step order was otherwise right and is unchanged: delete the
token file, run `switch-mempalace-http.sh` (mints a new token, re-registers
every CLI, but does not restart), restart the daemon (`task mempalace:stop`
— the actual point the superseded token stops being honored), remove the
`.bak` config files that still hold the old token, then restart every
running session.

- **Model:** `gemini-3-pro-image` (Nano Banana Pro)
- **Skill:** `nano-banana`, `generate` subcommand
- **Invocation:** `python3 "$HOME/.claude/skills/nano-banana/scripts/nano_banana.py" generate --model gemini-3-pro-image --out docs/assets/mempalace-mcp/rotate-token.png --prompt "<exact prompt text below>"`
  (`NANO_BANANA_PYTHON` already exported to the skill's dedicated venv.)

## Exact prompt text

A clean, flat, minimal step-by-step procedure diagram for a technical
runbook, landscape orientation. Light neutral pale blue-gray solid background
filling the entire canvas (no transparency). No photorealism, no 3D effects,
no drop shadows, no gradients — a plain corporate technical diagram. Use a
dark navy blue color for every numbered box, white sans-serif text inside the
boxes, and a muted orange/tan color for every connecting arrow.

Layout: exactly five rounded-rectangle boxes arranged left to right in a
single horizontal row, connected by bold orange arrows pointing rightward
from each box to the next one, forming a single strict left-to-right
sequence. Each box has a small circular badge in its top-left corner
containing a single number in white text. In this exact left-to-right order:

1. Badge "1". Box text: "Delete the old token file"
2. Badge "2". Box text: "Run switch-mempalace-http.sh: mints new token"
3. Badge "3". Box text: "Restart the daemon: new token takes effect"
4. Badge "4". Box text: "Delete each CLI's .bak config (old token)"
5. Badge "5". Box text: "Restart every running session"

Render every specified word and every number exactly as given, with no
typos, no missing words, no substituted words, no reordering, and no extra
text, titles, legends, or watermarks anywhere else in the image. High
resolution, crisp sharp edges, generous light margin around the whole
diagram.
