// bundle.ts — the installed bundle of the two installer-written programs
// (spec 0252 requirement 10; plan v3 D9). Installer-side only: this file is
// NOT part of any bundle.
//
// The two entries import by repository-relative path so they typecheck in
// place. Installing copies the entry with its constants substituted and every
// import specifier rewritten to `./service-lib/<basename>`, and copies the
// bundle files side by side into one flat `service-lib/` directory. The files
// of the bundle import each other only as `./<name>.ts`.

import path from "node:path";

/** Repository path (relative to `scripts/lib/`) of each file of each bundle. */
export const LAUNCHER_BUNDLE: readonly string[] = [
  "service/launcher/launcher-child.ts",
  "service/launcher/launcher-token.ts",
  "service/launcher/launcher-wait.ts",
  "mempalace-registration.ts",
  "session-check-throttle.ts",
];

export const TRUST_WRAPPER_BUNDLE: readonly string[] = [
  "service/launcher/launcher-child.ts",
  "tls-env.ts",
  "tls-env-quote.ts",
];

/** Every bundled file once, in a fixed order. */
export const SERVICE_LIB_FILES: readonly string[] = [
  ...new Set([...LAUNCHER_BUNDLE, ...TRUST_WRAPPER_BUNDLE]),
];

/** Flat name under `service-lib/` of a bundle path. */
export function flatName(repoPath: string): string {
  return path.posix.basename(repoPath);
}

/** Rewrite each relative `from "…"` specifier of an entry to the flat bundle. */
export function rewriteEntryImports(source: string): string {
  return source.replace(
    /(\bfrom\s+")(?:\.{1,2}\/(?:[^"]*\/)?)([^"/]+\.ts)(")/g,
    (_all, pre: string, file: string, post: string) => `${pre}./service-lib/${file}${post}`,
  );
}
