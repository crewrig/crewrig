// link-or-copy-types.ts — shared types of the link-or-copy module (spec 0255 R14-R21).
// Types only: no runtime code, so every sibling can import it without a cycle.

/**
 * What `linkOrCopy` / `placeCopy` did for one destination. `fallback-copy` is a copy made because
 * the link was refused (R15): it carries the refusal `code` and is what `summarizeFallbacks` counts.
 */
export type LinkOutcome =
  | { readonly method: "link"; readonly dest: string; readonly source: string }
  | { readonly method: "copy"; readonly dest: string; readonly source: string }
  | {
      readonly method: "fallback-copy";
      readonly dest: string;
      readonly source: string;
      readonly code: string;
    };

/** Options of `linkOrCopy`; every field is a test seam or a policy switch (R20, R21). */
export interface LinkOrCopyOptions {
  /** What a refused link does: copy instead (default) or rethrow (`monorepo-release`, R20). */
  readonly onRefusal?: "copy" | "throw";
  /** Platform used by the refusal classification; defaults to `process.platform`. */
  readonly platform?: string;
  /** Replacement for `fs.symlinkSync`, so a unit test can force a refusal. */
  readonly symlinkImpl?: (target: string, path: string, type: "dir" | "file") => void;
  /** Environment read for the forced-refusal seam; defaults to `process.env`. */
  readonly env?: Record<string, string | undefined>;
}
