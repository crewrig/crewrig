# Prompt sidecar — `topology.png`

<!-- crewrig-doc: published=false -->

Generated for spec 0136 (issue #751), figure step of PLAN v5 (satisfies R12,
R14, R15). Depicts the two-layer memory coordination topology: the shared
MemPalace MCP HTTP daemon (tier 2, this ADR 0016) sitting in front of the
shared ChromaDB HTTP daemon (tier 1, ADR 0006), fed by all four CLIs.

- **Model:** `gemini-3-pro-image` (Nano Banana Pro)
- **Skill:** `nano-banana`, `generate` subcommand
- **Invocation:** `python3 /Users/hoanicross/.claude/skills/nano-banana/scripts/nano_banana.py generate --model gemini-3-pro-image --out docs/assets/mempalace-mcp/topology.png --prompt "<exact prompt text below>"`
  (`NANO_BANANA_PYTHON` already exported to the skill's dedicated venv.)

## Exact prompt text

A clean, flat, minimal software-architecture diagram for a technical README,
landscape orientation, wide aspect ratio. Light neutral pale blue-gray solid
background filling the entire canvas (no transparency). No photorealism, no
3D effects, no drop shadows, no gradients, no decorative flourishes — a plain
corporate technical diagram. Use a dark navy blue color for every box, white
sans-serif text inside the boxes, and a muted orange/tan color for every
connecting line and arrow.

Layout, strictly left to right:

- Far left: four separate small rounded-rectangle boxes stacked vertically,
  evenly spaced, each containing ONLY one line of white text, top to bottom
  in this exact order:
  1. "Claude Code"
  2. "Gemini CLI"
  3. "Copilot CLI"
  4. "Antigravity CLI"
- Thin orange lines run rightward from all four boxes and merge into a single
  vertical bus line, which continues right into one larger navy box in the
  middle of the canvas.
- Middle box, two lines of white text, first line larger:
  "TIER 2 — shared MCP daemon"
  "port 41893 — one writer lease"
- One bold orange arrow points rightward from the middle box to a box on the
  right side of the canvas.
- Right box, same size and color as the middle box, two lines of white text,
  first line larger:
  "TIER 1 — shared ChromaDB daemon"
  "port 8001 — one HNSW compactor"
- Below the right box, a thin orange line runs straight down to a small navy
  cylinder (database icon) shape with one line of white text inside or
  directly beneath it: "the palace"

Render every specified word exactly as given, with no typos, no missing
words, no substituted words, and no extra text, titles, legends, or
watermarks anywhere else in the image. High resolution, crisp sharp edges,
generous light margin around the whole diagram.
