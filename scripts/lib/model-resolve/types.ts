// types.ts — shared contracts of the model-resolve modules (spec 0250 R19, R20).
// Types only: no behaviour lives here.
//
// Twins of the state the shell library keeps in globals (scripts/lib/model-resolve.sh
// :652-654 the OFF_* arrays, :723-731 the PROF_* globals, :972 DIAG_LINES,
// :989-1001 the RESOLVED_*, EMIT_* and IT_* globals) and in the dynamically scoped
// `CANDIDATES` array of `resolve_agent` (:1334). One `ResolveState` per
// `resolveAgent` call replaces all of them.
//
// R2 (spec 0250): this slice of the shell library moved only because the step (b)
// build depends on it; that is not a precedent for its other consumers.

import type { YamlText } from "../yaml-text.ts";

/** Environment as read from `process.env`: every value is `string | undefined`. */
export type Env = Readonly<Record<string, string | undefined>>;

/**
 * "Extract the frontmatter text of a file", the shell's `extract_frontmatter`
 * (render-command.sh, sourced by model-resolve.sh:749). Injected so the entry
 * wires `render-command.ts` in. It may throw: an unreadable source reads as no
 * frontmatter, as `awk` on a missing file printed nothing.
 */
export type ExtractFrontmatter = (file: string) => string;

/** Everything the library reads from outside itself. */
export interface ResolveContext {
  /** The shell's `$REPO_DIR`. */
  readonly repoDir: string;
  readonly env: Env;
  readonly platform: NodeJS.Platform;
  /** The shell's `$$` of a derived merge root. */
  readonly pid: number;
  /** `process.geteuid()` (the shell's `-O` tests the effective user); `undefined` where ownership is not modelled (win32). */
  readonly uid: number | undefined;
  /** `os.tmpdir()`: the base when `TMPDIR` is unset or empty. */
  readonly tmpdir: string;
  readonly yaml: YamlText;
  readonly extractFrontmatter: ExtractFrontmatter;
  /** Receives one `mapping-merge*` line, without its line feed (the shell's `>&2`). */
  readonly stderr: (line: string) => void;
}

/** The six selection axes other than intelligence (spec 0198 rule (d)). */
export type Axis = "reasoning" | "specialization" | "context" | "speed" | "modalities" | "locality";

export interface AxisValue {
  /** `PROF_HAS_<AXIS>`. */
  readonly has: boolean;
  /** `PROF_<AXIS>`; modalities are space-joined. */
  readonly value: string;
}

/** `profile_read`'s globals (model-resolve.sh:723-731). */
export interface Profile {
  readonly present: boolean;
  readonly intelligence: AxisValue;
  readonly axes: Readonly<Record<Axis, AxisValue>>;
  /** `PROF_TUNING_KEYS` and `PROF_TUNING_VALS`, in declared order. */
  readonly tuning: ReadonlyArray<readonly [string, string]>;
}

/** One entry of the `OFF_*` parallel arrays (model-resolve.sh:652-654). */
export interface Offering {
  readonly id: string;
  readonly rank: string;
  readonly native: string;
  readonly intelligence: string;
  readonly specialization: string;
  readonly context: string;
  readonly speed: string;
  readonly locality: string;
  readonly modalities: string;
  readonly encodedReasoning: string;
  readonly supportsReasoningSurface: string;
}

/** The mutable state of one `resolveAgent` call. */
export interface ResolveState {
  offeringId: string;
  nativeValue: string;
  offeringSrs: string;
  fmLines: string[];
  prose: string;
  diag: string[];
  /** `IT_*` arrays, indexed by `itemIdx` (parallel to `ITEM_VOCAB_ORDER`). */
  disposed: boolean[];
  directed: boolean[];
  fm: boolean[];
  gd: boolean[];
  value: string[];
  profile: Profile;
  offerings: Offering[];
  /** The shell's dynamically scoped `CANDIDATES`: indexes into `offerings`. */
  candidates: number[];
}

/** The four outputs of the shell plus its diagnostic lines (R19). */
export interface ResolveResult {
  /** `RESOLVED_OFFERING_ID` */
  readonly offeringId: string;
  /** `RESOLVED_NATIVE_VALUE` */
  readonly nativeValue: string;
  /** `EMIT_FM_LINES` */
  readonly fmLines: readonly string[];
  /** `EMIT_PROSE` */
  readonly prose: string;
  /** `DIAG_LINES`, tab-separated, in the order the shell produces them. */
  readonly diagLines: readonly string[];
}
