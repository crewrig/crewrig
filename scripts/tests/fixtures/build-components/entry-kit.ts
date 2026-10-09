// entry-kit.ts — builders shared by the end-to-end suites of the build entry (spec 0250 R3-R16,
// plan steps 21-24): source texts, the real mappings, isolated temporary directories and tree
// listings. Nothing here reimplements a module under test: expected outputs are written by
// hand in the suites from the rules of spec 0250 R13.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after } from "node:test";

import { REPO } from "../../lib/build-fixture-tree.ts";
import type { FixtureTree } from "../../lib/build-fixture-tree.ts";
import { offering } from "./model-resolve-kit.ts";

export { REPO };

/** A source file: `---`, the frontmatter lines, `---`, the body. */
export function source(frontmatter: readonly string[], body = "Body.\n"): string {
  return `---\n${frontmatter.join("\n")}\n---\n${body}`;
}

/** A minimal skill source named `name`. */
export const skill = (name: string, body = "Body.\n", extra: readonly string[] = []): string =>
  source([`name: ${name}`, 'description: "A skill."', ...extra], body);

/** A minimal agent source named `name` (no capability profile: it resolves to nothing). */
export const agent = (
  name: string,
  body = "Agent body.\n",
  extra: readonly string[] = [],
): string => source([`name: ${name}`, 'description: "An agent."', ...extra], body);

/** A minimal command source named `name`. */
export const command = (name: string, body = "Do it.\n", extra: readonly string[] = []): string =>
  source([`name: ${name}`, 'description: "A command."', ...extra], body);

/** The configuration the suites use (the repository's own `canonical_repo` shape). */
export const CONFIG =
  'canonical_repo = "https://example.test/o/r"\nfeedback_repo = "https://example.test/o/f"\n';

/** Copy the committed `model-mappings/` into the tree (the mappings an agent resolves against). */
export function seedMappings(tree: FixtureTree): void {
  fs.cpSync(path.join(REPO, "model-mappings"), tree.resolve("model-mappings"), { recursive: true });
}

const temps: string[] = [];
after(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
  temps.length = 0;
});

/** A fresh physical directory under the OS temporary directory, removed when the file ends. */
export function scratch(prefix = "entry-"): string {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `bc-${prefix}`)));
  temps.push(dir);
  return dir;
}

/** The `crewrig-*` entries a run left under an isolated `TMPDIR`. */
export function strays(tmpDir: string): string[] {
  return fs.readdirSync(tmpDir).filter((name) => name.startsWith("crewrig-"));
}

/** Every regular file below `root/<dir>` for each `dirs`, as `/`-separated paths relative to `root`. */
export function filesUnder(root: string, dirs: readonly string[]): string[] {
  const found: string[] = [];
  const walk = (rel: string): void => {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) return;
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const sub = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(sub);
      else found.push(sub);
    }
  };
  for (const dir of dirs) walk(dir);
  return found.sort();
}

/** The four committed trees' roots. */
export const BUILT_DIRS = [".gemini", ".claude", ".github", ".agents"] as const;

/** `/`-separated paths of the files of a build under the four trees plus `dist/`. */
export function builtFiles(tree: FixtureTree): string[] {
  return filesUnder(tree.root, [...BUILT_DIRS, "dist"]);
}

/** The `Generated:` and `Building` lines and the other stdout lines of a run, split. */
export function lines(text: string): string[] {
  return text === "" ? [] : text.replace(/\n$/, "").split("\n");
}

/** An organisation channel for `target` that declares one extra offering (so a merge is made). */
export function orgMapping(target: string): string {
  return `target: ${target}\nofferings:\n${offering("org-extra", 20, "org-native", "max")}\n`;
}

/** The inherited environment without `REPO_DIR`, then `extra` (which may set it back). */
export function cleanEnv(extra: Readonly<Record<string, string>> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env["REPO_DIR"];
  return { ...env, ...extra };
}

/**
 * Set on Windows: the build prints native separators there (spec 0250 R33(d)), so a suite that
 * compares printed paths byte for byte skips; `scripts/tests/lib/windows-build-proof.ts` proves
 * the bytes of the files on that system.
 */
export const NATIVE_PATHS: string | undefined =
  process.platform === "win32"
    ? "skipped: printed paths use the native separator (R33(d))"
    : undefined;
