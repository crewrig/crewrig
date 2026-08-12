# Prompt sidecar — `convert-machine.png`

<!-- crewrig-doc: published=false -->

Generated for spec 0136 (issue #751), figure step of PLAN v5 (satisfies R13,
R14, R15). Depicts the ordered procedure for converting a machine to the
shared MemPalace MCP HTTP daemon, run via `task mempalace:switch-http`
(`scripts/switch-mempalace-http.sh`).

**Corrected during REVIEW (cold `architect` pass on #877): the original
version of this figure showed the daemon starting before the token was
provisioned — backwards.** Step order re-verified against the actual
source rather than the outer script's call sequence alone:
`install_mcp_daemon` (`scripts/lib/common.sh:812-830`) mints the bearer
token as its **first** statement — the comment above that line states why
("The token must exist before the launcher runs: it refuses to serve
without one, by design") — and only then calls `install_mcp_launcher` and
`install_daemon_supervisor`, which starts the daemon. `switch-mempalace-http.sh`
re-reads that same token afterward, registers every CLI
(`switch_assistants_to_http`), and verifies the result
(`status-mcp-server.sh`).

- **Model:** `gemini-3-pro-image` (Nano Banana Pro)
- **Skill:** `nano-banana`, `generate` subcommand
- **Invocation:** `python3 "$HOME/.claude/skills/nano-banana/scripts/nano_banana.py" generate --model gemini-3-pro-image --out docs/assets/mempalace-mcp/convert-machine.png --prompt "<exact prompt text below>"`
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

1. Badge "1". Box text: "Provision the bearer token"
2. Badge "2". Box text: "Install and start the daemon"
3. Badge "3". Box text: "Every CLI registered with the token"
4. Badge "4". Box text: "Verify status and auth"

Render every specified word and every number exactly as given, with no
typos, no missing words, no substituted words, no reordering, and no extra
text, titles, legends, or watermarks anywhere else in the image. High
resolution, crisp sharp edges, generous light margin around the whole
diagram.
