// store-guidance.ts — `print_store_access_guidance` of scripts/lib/common.sh (spec 0256 requirements
// 25 and 32, delta-01 G9). It only prints: no file is written and no trust config is changed. The
// two CLIs that gate an out-of-workspace read (Gemini and Copilot) get the guidance; the others get
// nothing. The text is copied byte for byte from the shell (a test diffs it against the shell source).

import type { Cli, Io } from "./context.ts";

const STORE = "~/.crewrig/system-context";

const HEADER: readonly string[] = [
  "",
  "System-context store access (spec 0068):",
  `  The framework installs a shared rule store at ${STORE}.`,
  "  When a rule from the store is needed, the CLI reads it on demand.",
  "  Setup writes NO durable trust config; where the read still cannot be",
  "  satisfied, the store surfaces its explicit fallback signal (spec 0068).",
];

const GEMINI: readonly string[] = [
  "  Gemini gates tool use on workspace trust. Make the store path",
  "  trusted for the invocation with one of:",
  `    gemini --include-directories ${STORE}`,
  "    GEMINI_CLI_TRUST_WORKSPACE=true gemini ...",
  "    gemini --skip-trust ...",
  "  or approve the directory interactively when prompted.",
];

const COPILOT: readonly string[] = [
  "  Copilot denies the out-of-workspace read unless the path is",
  "  granted. Grant it per-invocation with one of:",
  `    copilot --add-dir ${STORE}`,
  "    copilot --allow-all-paths",
  "  or approve the read interactively when prompted.",
  "  Note: trustedFolders in ~/.copilot/config.json does NOT durably",
  "  authorize this cross-project read.",
];

/** The lines the shell prints for `cli` (empty for the CLIs that read the store bare). */
export function storeAccessGuidanceLines(cli: Cli): readonly string[] {
  if (cli === "gemini") return [...HEADER, ...GEMINI];
  if (cli === "copilot") return [...HEADER, ...COPILOT];
  return [];
}

/** Print the guidance for Gemini and Copilot; print nothing for Claude and Antigravity. */
export function printStoreAccessGuidance(io: Pick<Io, "out">, cli: Cli): void {
  for (const line of storeAccessGuidanceLines(cli)) io.out(line);
}
