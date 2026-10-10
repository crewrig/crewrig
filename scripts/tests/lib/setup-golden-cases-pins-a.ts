// setup-golden-cases-pins-a.ts — the pin cells of the Claude and Gemini shell setups (spec 0256
// requirements 25-26, plan v2 step A4b). The cells both CLIs share live in setup-golden-cases-pins-a2.ts;
// the Gemini-only cells are here.
import type { GoldenCase } from "./setup-golden-types.ts";
import { put, sharedCells } from "./setup-golden-cases-pins-a2.ts";

const LEGACY_MD = (marker: boolean): string =>
  `${marker ? "<!-- crewrig-section: 00-soul -->\n" : ""}# Legacy context\n`;

const OPERATOR_SETTINGS = `{
  // an operator comment the merge must survive
  "theme": "Dracula",
  "general": { "vimMode": true },
  /* block comment */
  "mcpServers": { "operator-tool": { "command": "op-mcp" } }
}
`;

const geminiOnly: readonly GoldenCase[] = [
  {
    id: "legacy-gemini-md-marker",
    cli: "gemini",
    note: "A ~/.gemini/GEMINI.md carrying the crewrig-section marker is removed (D1 row gemini-md, spec 0061 delta-02).",
    seed: (sb) => put(sb, ".gemini/GEMINI.md", LEGACY_MD(true)),
  },
  {
    id: "legacy-gemini-md-no-marker",
    cli: "gemini",
    note: "A ~/.gemini/GEMINI.md without the marker is an operator file and is kept.",
    seed: (sb) => put(sb, ".gemini/GEMINI.md", LEGACY_MD(false)),
  },
  {
    id: "gemini-settings-merge",
    cli: "gemini",
    note: "The settings merge keeps operator keys, comments-tolerant JSONC and operator MCP servers (spec 0214).",
    seed: (sb) => put(sb, ".gemini/settings.json", OPERATOR_SETTINGS),
  },
];

export const cases: readonly GoldenCase[] = [...sharedCells, ...geminiOnly];
