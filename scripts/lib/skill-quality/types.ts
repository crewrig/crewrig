// types.ts — shared shapes of the skill linter (spec 0293 R5, R17, R18).
//
// Usage: import type { Finding, Severity } from "./types.ts".
// Exit codes: not applicable (library). Finding-line format: see run.ts `formatFinding`.

export type Severity = "error" | "warning";

/** One finding. `severity` is decided by run.ts from the rule and from whether the skill is protected. */
export interface Finding {
  readonly rule: string;
  readonly message: string;
  readonly skill: string;
  /** Path relative to the repository root. */
  readonly file: string;
  readonly line?: number;
  severity: Severity;
}

/** A rule's raw output before the skill name and severity are attached. */
export interface Raw {
  readonly rule: string;
  readonly message: string;
  readonly file: string;
  readonly line?: number;
}

export interface YamlNamespace {
  load(input: string): unknown;
}

/** Rules whose finding is an error whether or not the skill ships evals (spec 0293 R18). */
export const ALWAYS_ERROR: ReadonlySet<string> = new Set(["description-length", "evals-invalid"]);
/**
 * Rules whose finding is always a warning: the absence of evals is itself a warning (R18), and the
 * three eval-authoring rules of spec 0304 R19 never break a protected skill.
 */
export const ALWAYS_WARNING: ReadonlySet<string> = new Set([
  "evals-missing",
  "evals-absence-expectation",
  "evals-sample-missing",
  "evals-too-many",
]);

export interface SkillDir {
  readonly name: string;
  /** Absolute path of the skill source directory. */
  readonly dir: string;
  /** Path of the skill directory relative to the repository root, `/` separators. */
  readonly rel: string;
}
