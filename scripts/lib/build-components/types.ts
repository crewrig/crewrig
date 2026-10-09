// types.ts — shared contracts of the build-components modules (spec 0250 R1, R4).
// Types and the one failure class only: no behaviour lives here.
//
// Twins the globals of scripts/build-components.sh :30-45 (TARGET, CHECK_MODE,
// TIER_FILTER, LIST_OUTPUT_DIRS, RESOLVE_*, DIAGNOSTICS_PATH), :147 (DRIFT_FOUND),
// :192 (CFG_KEYS), :377 (CHECK_COMPARE) and :503 (CHECK_STAGING_ROOT). One `Ctx`
// replaces them; `BuildState` holds the three that change while the build runs.
//
// Module map (one concern per file, each under 300 lines):
//   args.ts         `parseArgs`, `resolveRepoDir`            (:52-62; R4)
//   output-dirs.ts  `outputDirLines`                         (:67-117)
//   config.ts       `loadConfig`, `resolvePlaceholders`, `validateCanonicalRepo` (:193-244)
//   frontmatter.ts  `createFrontmatter`: one `YamlText` per process, `SourceDoc`  (:344-370)
//   provenance.ts   `provenanceBlock`, `geminiProvenanceComment`, `injectProvenance` (:263-339)
//   links.ts        link rewrites of a skill body and of a `.md` resource   (:557, :434)
//   write.ts        `joinRoot`, `checkOrWrite`, `finalizeText`   (:382-408)
//   resources.ts    `propagateSkillResources`, `copyResource`, `readUmask`  (:415-456)
//   tiers.ts staging.ts diagnostics.ts resolve-arm.ts emit-*.ts main.ts  — the rest.

import type { RenderCommand } from "../render-command.ts";
import type { YamlEntry, YamlPath, YamlText } from "../yaml-text.ts";

/** Environment as read from `process.env`: every value is `string | undefined`. */
export type Env = Readonly<Record<string, string | undefined>>;

/** The four CLIs a build targets (`--target` accepts these, `all`, and anything else). */
export type CliId = "gemini" | "claude" | "copilot" | "antigravity";

/**
 * Where the build writes. `out` and `err` append the line feed themselves (the
 * shell's `echo`); `errRaw` writes text as it is (the collision pre-pass reports,
 * whose `TextSink` carries its own line feeds). Nothing here exits the process:
 * `main` returns the exit code and the entry sets `process.exitCode`.
 */
export interface Io {
  out(line: string): void;
  err(line: string): void;
  errRaw(text: string): void;
}

/** What the entry hands `main` (the contract of `main.ts`, written by the second developer). */
export interface MainInput {
  /** `process.argv.slice(2)`. */
  readonly argv: readonly string[];
  readonly env: Env;
  readonly platform: NodeJS.Platform;
  /** The entry file's own path (`__filename`): `REPO_DIR` defaults to its physical grandparent. */
  readonly entryFile: string;
  readonly io: Io;
}

/** The parsed command line. Every field twins one shell global of `:30-45`. */
export interface BuildOptions {
  /** `--target` verbatim: `all`, a CLI id, or any other text (then no CLI is selected). */
  readonly target: string;
  /** `--tier` words, in order; `null` when no `--tier` was given (every tier), `[]` matches nothing. */
  readonly tierFilter: readonly string[] | null;
  readonly check: boolean;
  readonly listOutputDirs: boolean;
  /** `--resolve <source> <target>`; `null` when absent or when `<source>` is empty. */
  readonly resolve: { readonly source: string; readonly target: string } | null;
  /** `--diagnostics <path>`; the empty string when none. */
  readonly diagnosticsPath: string;
}

/** One `key = "value"` line of `crewrig.config.toml`: `key` is already upper-cased. */
export interface Placeholder {
  readonly key: string;
  readonly value: string;
}

/**
 * The configuration. `placeholders` keeps file order and repeated keys (the shell's
 * `CFG_KEYS` repeats them); every entry of a repeated key carries its last value.
 */
export interface Config {
  readonly placeholders: readonly Placeholder[];
  /** `CFG_CANONICAL_REPO`; the empty string when absent. */
  readonly canonicalRepo: string;
}

/** Mutable build state: the three globals that change while tiers are built. */
export interface BuildState {
  /** `DRIFT_FOUND`. */
  driftFound: boolean;
  /** `CHECK_COMPARE`: whether the tier being built is drift-compared (`--check`, `core` only). */
  compare: boolean;
  /** `CHECK_STAGING_ROOT`: the empty string until `staging.ts` creates it. */
  stagingRoot: string;
}

/**
 * One source file (`SKILL.md`, a command, an `AGENT.md`) read once, LF and no byte-order
 * mark. Every reader twins one `yq -r` expression of the shell; `path` is `"a.b"`, `".a.b"`
 * or `["a", "b"]`. A frontmatter that does not parse reads as having no field.
 */
export interface SourceDoc {
  readonly file: string;
  /** `extract_body`: every line after the second `---`, no trailing line feed. */
  readonly body: string;
  /** `yaml_field`: `yq -r .<name>` text; `null` for an absent key, empty on a read error. */
  field(name: string): string;
  /** `yaml_nested`: the same read, empty when the text is empty or `null`. */
  nested(path: YamlPath): string;
  /** `yq -r '<path> // ""'`: empty for absent, null, `false` and empty; the written text otherwise. */
  alt(path: YamlPath): string;
  /** `yq -r '<path> // [] | .[]'` read line by line: trailing blank lines dropped, `[]` when none. */
  lines(path: YamlPath): string[];
  /** `has(<last key>)` of the mapping at the rest of `path`: true when the key is present. */
  has(path: YamlPath): boolean;
  /** `<path> | to_entries | .[]`: key, kind and text of each entry, in document order. */
  entries(path: YamlPath): YamlEntry[];
}

/** The frontmatter reader of the build: one `YamlText` per process, shared with the render twin. */
export interface Frontmatter {
  readonly yaml: YamlText;
  readonly render: RenderCommand;
  /** Read a source once (LF, no byte-order mark); throws when it cannot be read. */
  open(file: string): SourceDoc;
}

/** What every phase before the configuration (the `--resolve` arm) needs. */
export interface BaseCtx {
  readonly opts: BuildOptions;
  /** `REPO_DIR`, verbatim (a trailing slash is kept: printed paths are `root + "/" + rel`). */
  readonly repoDir: string;
  /** `<repoDir>/artifacts`. */
  readonly artifactsDir: string;
  readonly env: Env;
  readonly platform: NodeJS.Platform;
  readonly io: Io;
  /** The process umask, read once at start (`readUmask`); `0` on win32. */
  readonly umask: number;
  readonly fm: Frontmatter;
  readonly state: BuildState;
}

/** The build context: the base plus the configuration read after the `--resolve` arm. */
export interface Ctx extends BaseCtx {
  readonly config: Config;
}

/**
 * A refusal with a status. `main` writes `message` to standard error verbatim (it carries its
 * own `Error:` prefix and may span two lines) and returns `exitCode`.
 */
export class BuildFailure extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = "BuildFailure";
    this.exitCode = exitCode;
  }
}
