// setup-golden-types.ts — the data contract of the golden matrix of the four setup entry points
// (spec 0256 requirement 7, plan v2 steps A4-A6). A case is DATA: the harness (setup-golden-regen.ts)
// runs it on a leg, and the cell modules (setup-golden-cases-*.ts) export `cases`.
import type { Leg, SetupSandbox, SetupSandboxOptions } from "./setup-sandbox.ts";
import type { StubOptions } from "./setup-stubs.ts";

export type Cli = "claude" | "gemini" | "copilot" | "antigravity";
export const CLIS: readonly Cli[] = ["claude", "gemini", "copilot", "antigravity"];

export interface GoldenCase {
  /** Kebab-case, unique per cli; the golden fixtures live in fixtures/setup-golden/<cli>/<id>/. */
  readonly id: string;
  readonly cli: Cli;
  /** The property this cell pins and the spec or plan row it serves (one sentence). */
  readonly note: string;
  /** Extra command-line arguments (`--link` and so on); `--answer` is for the TypeScript leg only. */
  readonly args?: readonly string[];
  /** Piped standard input; omitted means a closed standard input. */
  readonly stdin?: string;
  /** Extra environment; an undefined value removes the variable. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly sandbox?: SetupSandboxOptions;
  /** Stub behaviour: the fzf answer table (header substring -> option or CANCEL), servers, probe mode... */
  readonly stubs?: StubOptions;
  /** Real tools to expose on the sandbox PATH in addition to the stubs (at least `jq` and `git`). */
  readonly tools?: readonly string[];
  /** Pre-existing state to create in the sandbox home or repo before the run. */
  readonly seed?: (sb: SetupSandbox) => void;
  /** Legs the cell runs on; default every available leg. */
  readonly legs?: readonly Leg[];
  /** Set when the cell is the shell baseline only: the reason (a deviation letter of requirement 44 or delta-01). */
  readonly shellOnly?: string;
}
