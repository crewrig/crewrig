# Prompt sidecar — `rotate-token.png`

<!-- crewrig-doc: published=false -->

Generated for spec 0136 (issue #751), refreshed for spec 0160 (issue #914)
following the token-rotation revocation fix in PR #897 (issue #880 / spec 0139).
Depicts the ordered manual procedure for replacing the shared MCP daemon's bearer
token, in the order that leaves no daemon serving a superseded value.

**Refreshed for spec 0160 (issue #914):** PR #897 (issue #880) resolved the
previous defect where `switch-mempalace-http.sh` did not restart the running
daemon. The script now directly replaces the daemon process
(`mcp_daemon_replace_process`) and verifies that the new token is served before
re-registering any assistant. The redundant manual daemon restart step
(`task mempalace:stop`) is therefore removed. This figure depicts the
authoritative four-step procedure matching shipped script behaviour: (1) delete
the old token file, (2) run `switch-mempalace-http.sh` (mints new token,
replaces daemon process, re-registers every CLI), (3) delete `.bak` config files
that still hold the old token, and (4) restart every running CLI session.

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

Layout: exactly four rounded-rectangle boxes arranged left to right in a
single horizontal row, connected by bold orange arrows pointing rightward
from each box to the next one, forming a single strict left-to-right
sequence. Each box has a small circular badge in its top-left corner
containing a single number in white text. In this exact left-to-right order:

1. Badge "1". Box text: "Delete the old token file"
2. Badge "2". Box text: "Run switch-mempalace-http.sh: mints new token"
3. Badge "3". Box text: "Delete each CLI's .bak config (old token)"
4. Badge "4". Box text: "Restart every running session"

Render every specified word and every number exactly as given, with no
typos, no missing words, no substituted words, no reordering, and no extra
text, titles, legends, or watermarks anywhere else in the image. High
resolution, crisp sharp edges, generous light margin around the whole
diagram.
