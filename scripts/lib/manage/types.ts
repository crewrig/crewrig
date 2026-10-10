// types.ts — the declaration shape of one manage-*-component command (spec 0255 R6, plan step 9).
//
// One `CliDescriptor` holds what the four manage-*-component.sh scripts declare today: the
// home, the types and their aliases, where each type lands, which root it resolves from, the
// link-mode prompt and the MCP handler. The values live in `descriptors.ts` and are read
// from the shell scripts; nothing here computes a path. Every path is written relative to the
// user's HOME (forward slashes, no leading slash) so a printer can emit it with a sentinel.

/** What a type does once resolved: place the component, or hand it to an MCP handler. */
export type TypeAction = "place" | "mcp";

export interface TypeDescriptor {
  /** The plural name the dispatch arm matches, e.g. `claude-skills`. */
  readonly name: string;
  /**
   * `staging` types resolve from `dist/<tier>/<rootArg>` (the compiled tree, refreshed on a
   * miss); `artifact` types resolve from `artifacts/<tier>/<rootArg>` and are never compiled.
   */
  readonly root: "staging" | "artifact";
  /** The argument of `component_set_staging_roots` / `component_set_artifact_roots`. */
  readonly rootArg: string;
  /** The landing directory relative to HOME; `null` for a type an MCP handler consumes. */
  readonly dest: string | null;
  readonly action: TypeAction;
  /** The CLI handed to the staging refresh; `""` for an artifact type (nothing to rebuild). */
  readonly refreshCli: string;
  /** JSON-merge types only: the settings key that receives the entry. */
  readonly mcpKey?: string;
  /** Skills of antigravity: the narrow superseded-placement migration runs after the loop. */
  readonly migratesSuperseded?: boolean;
}

export type McpHandler =
  /** claude: `claude mcp add --scope user` through a spawn. */
  | { readonly kind: "spawn" }
  /** copilot, antigravity, gemini: a JSON merge into `file` (relative to HOME). */
  | { readonly kind: "json"; readonly file: string; readonly initial: string };

export interface CliDescriptor {
  /** The name used in tier-resolution facts: claude, copilot, antigravity, gemini. */
  readonly cli: string;
  /** The shell script this descriptor twins. */
  readonly script: string;
  /** The CLI home relative to HOME: CLAUDE_HOME, COPILOT_HOME, ANTIGRAVITY_HOME, GEMINI_HOME. */
  readonly home: string;
  /** Antigravity only: AGY_CUSTOMIZATION_ROOT, relative to HOME (skills land here, spec 0123). */
  readonly customizationRoot?: string;
  readonly defaultMode: "install";
  /** The text after `Types: ` in the usage and unknown-type output. */
  readonly typesLine: string;
  /** Singular to plural, in the order of the script's normalisation `case`. */
  readonly aliases: Readonly<Record<string, string>>;
  readonly types: readonly TypeDescriptor[];
  /** Plural types the dispatch refuses with an error (copilot `agents`). */
  readonly refused: readonly string[];
  /** The link-mode lines between the two-line header and `Only use if you trust ...`. */
  readonly linkWarning: readonly string[];
  /** claude, copilot, antigravity ask `Continue? [y/N]`; workspace prints the warning only. */
  readonly linkPrompt: boolean;
  /** The word in `Error: unknown <label> '<type>'` and whether `Types:` follows it. */
  readonly unknownType: { readonly label: string; readonly listsTypes: boolean };
  readonly mcp: McpHandler;
}
