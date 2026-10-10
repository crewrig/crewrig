// descriptor.ts — the types of the setup flow (spec 0256 requirements 3 and 6, plan v2 step B3b.1).
// Types only: no logic and no import of a module that has any. A descriptor is PURE DATA (no
// function): the ordered step ids, the homes, the rule files and the strategy keys one CLI's setup
// differs by. The step bodies live in the `steps-*.ts` files and read the descriptor; they never
// copy the flow.
//
// Paths in a descriptor: `homes.*` are relative to `ctx.home`; `RuleFile.src` is relative to
// `ctx.repoDir`; `RuleFile.dest` is relative to `homes.rulesDir`; every one is joined with
// `node:path` by the step that uses it, never concatenated.

import type { LinkOutcome } from "../link-or-copy.ts";
import type { PromptStdin } from "../manage/confirm.ts";
import type { Cli, Env, Io, SetupCtx, Spawner } from "./context.ts";
import type { PromptSession } from "./prompt.ts";

/** Every step a setup runs, in the vocabulary of the B3b step table (section 2). */
export type StepId =
  | "banner"
  | "prerequisites"
  | "link-confirm"
  | "ensure-home"
  | "identity-check"
  | "copilot-workspace-files"
  | "rules-existing"
  | "rules-shared"
  | "rules-selection"
  | "mcp-prepare"
  | "tls-offer"
  | "deps-install"
  | "mcp"
  | "tiers"
  | "migrate-superseded"
  | "hooks-rewrite-installed"
  | "session-recording"
  | "usage-capture"
  | "session-check"
  | "legacy-context-cleanup"
  | "system-context-file"
  | "summary";

/** The picks of the catalogue, in the names of `prompt-ids.ts` (`catalogue.team` ...). */
export type PickKind = "team" | "expertise" | "level";

/** One rule file to place; `label` is the exact text of `  Copied: <label>` in the shell. */
export interface RuleFile {
  readonly src: string;
  readonly dest: string;
  readonly label: string;
  /** Placed only when `src` exists (the `66` org rules of Gemini, Copilot and Antigravity). */
  readonly optional?: boolean;
}

/** The closing report of the run (shell lines 552-571 for Claude, 507-528 Gemini, ...). */
export interface SummarySpec {
  readonly listHeader: string;
  readonly listGlob: string;
  readonly mcpHeader: string;
  readonly mcpSource: "claude-mcp-list" | "settings.json" | "mcp-config.json" | "mcp_config.json";
  readonly note?: string;
  readonly restartLine?: string;
  readonly extraLines: readonly string[];
}

/** Which body the strategy steps run: one key per axis, resolved by the step files. */
export interface Strategies {
  readonly mcp: "claudeMcp" | "geminiMcp" | "copilotMcp" | "antigravityMcp";
  readonly tiers: "standard" | "antigravity";
  readonly usageCapture: "settings" | "user-hooks-json" | "statusline";
}

export interface SetupDescriptor {
  readonly cli: Cli;
  /** The title line of the banner (`Claude Code Configuration Setup`). */
  readonly banner: string;
  /** THE order of the run. `link-confirm` is executed by the flow itself (it owns the queue). */
  readonly steps: readonly StepId[];
  readonly homes: {
    readonly cliHome: string;
    readonly rulesDir: string;
    readonly skillsDir: string;
    readonly agentsDir?: string;
    /** `settings.json`, `mcp-config.json` or `mcp_config.json` of this CLI, when it has one. */
    readonly settings?: string;
    readonly mcpConfig?: string;
  };
  readonly rules: {
    readonly existingGlob: string;
    /** Wording of the rules-existing and rules-selection steps, keyed by name (`existingHeader` ...). */
    readonly texts: Readonly<Record<string, string>>;
    readonly sharedHeader: string;
    /** Placed by `rules-shared`, in this order (Copilot's order differs from the others'). */
    readonly shared: readonly RuleFile[];
    readonly store: RuleFile;
    readonly pickOrder: readonly PickKind[];
    readonly selections: Readonly<Record<PickKind, RuleFile>>;
    /** `method`: ask `profile-method` when it differs; `direct`: a plain install (Copilot). */
    readonly profile: { readonly mode: "method" | "direct"; readonly file: RuleFile };
    /** Copilot only: `rules-existing` creates `homes.rulesDir` itself (shell line 116). */
    readonly mkdirInExisting?: boolean;
  };
  readonly hooks: {
    readonly channel: "settings" | "user-json" | "agy-json";
    /** The hooks file of the channel, relative to home. */
    readonly file: string;
    /** The transcript manifest in the repository (`hooks/<cli>-transcript-hooks.json`). */
    readonly src: string;
    readonly envPatch: boolean;
    /** The `mempalace-transcript.sh` copy the rewrite step reports as unused, relative to home. */
    readonly unusedCopy: string;
    /** Whether the rewrite step prints the blank line first (Copilot and Antigravity do not). */
    readonly leadingBlank: boolean;
  };
  readonly strategies: Strategies;
  readonly storeGuidance: boolean;
  readonly summary: SummarySpec;
}

/** What the steps share while one run progresses; written by the steps, read by the later ones. */
export interface FlowState {
  /** The flow-owned copy of `FlowDeps.env`; `ctx.env` IS this object (see `StepEnv`). */
  readonly env: Record<string, string | undefined>;
  skipRules: boolean;
  pythonBin?: string;
  mempalaceVersion?: string;
  mempalaceInstalled: boolean;
  settingsTarget?: string;
  tlsVars: Readonly<Record<string, string>>;
  tlsWrote: boolean;
  srTranscriptWired: boolean;
  srAllHooksDisabled: boolean;
  ucState?: string;
  ucAnswer?: string;
  agentsMdLines: number;
  readonly outcomes: LinkOutcome[];
}

/**
 * What one step receives. `ctx.env` and `state.env` are ONE mutable object owned by the flow (never
 * `process.env`): `tls-offer` merges the CA variables into it, so every later module that reads
 * `ctx.env` and the spawner (which reads it at call time) hand them to their children.
 */
export interface StepEnv {
  readonly descriptor: SetupDescriptor;
  readonly ctx: SetupCtx;
  readonly state: FlowState;
  readonly session: PromptSession;
  readonly spawn: Spawner;
  readonly deps: FlowDeps;
}

/** A step prints through `ctx.io`, mutates `state`, and ends the run with `throw new SetupExit(n)`. */
export type StepFn = (env: StepEnv) => Promise<void>;
export type StepRegistry = Partial<Record<StepId, StepFn>>;

export interface TextSink {
  write(text: string): unknown;
}

/** The standard input as the one-key question and the line queue both need it. */
export type StdinLike = NodeJS.ReadableStream & PromptStdin;

/** Every seam of the machine: the flow reads nothing from `process`. */
export interface FlowDeps {
  readonly argv: readonly string[];
  readonly stdin: StdinLike;
  readonly stdout: TextSink;
  readonly stderr: TextSink;
  readonly env: Env;
  readonly platform: NodeJS.Platform;
  readonly home: string;
  readonly repoDir: string;
  /** Defaults to `createSpawner` over the flow-owned env. */
  readonly spawn?: Spawner;
  readonly now?: () => Date;
  /** Replaces registered steps by id (tests, and the entry's own seams). */
  readonly steps?: StepRegistry;
  /** Per-module test seams keyed by module name (`chroma`, `ensureHttp`, `tierBuild` ...); a step narrows its own. */
  readonly seams?: Readonly<Record<string, unknown>>;
}

export type { Io };
