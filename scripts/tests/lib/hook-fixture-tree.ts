// hook-fixture-tree.ts — a throwaway checkout for testing the hook entries
// (spec 0243 R4-R14 verification, plan step 8).
//
// Copies the two entry files, `scripts/lib/*.ts`, `cursor.js` and the real
// `hook-run.ts` into a temporary directory that holds an empty `.git` (which
// `repoRootFrom` needs) and a root `package.json` with no `"type"` field, then
// lets a test swap `hook-run.ts` and `index.js` for stubs. The entries run
// from that copy through their real files, so what is asserted is what ships.

import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const CAPTURE_DIR = ["scripts", "lib", "usage-capture"] as const;

export interface FixtureTreeOptions {
  /** Source text of a stub `scripts/lib/usage-capture/hook-run.ts`. Default: the real one. */
  hookRun?: string;
  /** Source text of a stub `scripts/lib/usage-capture/index.js`. Default: a no-op dispatcher. */
  index?: string;
  /** Root `package.json` content. Default: no `"type"`, no dependencies. */
  packageJson?: Record<string, unknown>;
}

export interface FixtureTree {
  readonly root: string;
  /** Absolute path of a file inside the tree. */
  file(...segments: string[]): string;
  cleanup(): void;
}

/** A dispatcher that records nothing: enough for a lazy load to succeed. */
export const NOOP_INDEX = "'use strict';\nmodule.exports = { capture() {}, submit() {} };\n";

function copyInto(tree: string, ...relative: string[]): void {
  const target = path.join(tree, ...relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(REPO, ...relative), target);
}

export function makeFixtureTree(options: FixtureTreeOptions = {}): FixtureTree {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-hook-tree-")));
  fs.mkdirSync(path.join(root, ".git"));
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify(options.packageJson ?? { name: "fixture", private: true }),
  );
  copyInto(root, "hooks", "usage-capture.ts");
  copyInto(root, "hooks", "antigravity-statusline-shim.ts");
  for (const name of fs.readdirSync(path.join(REPO, "scripts", "lib"))) {
    if (name.endsWith(".ts")) copyInto(root, "scripts", "lib", name);
  }
  copyInto(root, ...CAPTURE_DIR, "cursor.js");
  copyInto(root, ...CAPTURE_DIR, "hook-run.ts");
  if (options.hookRun !== undefined) {
    fs.writeFileSync(path.join(root, ...CAPTURE_DIR, "hook-run.ts"), options.hookRun);
  }
  fs.writeFileSync(path.join(root, ...CAPTURE_DIR, "index.js"), options.index ?? NOOP_INDEX);
  return {
    root,
    file: (...segments) => path.join(root, ...segments),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

export interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Environment for a hook run: the parent's, minus every Node.js option, plus `extra`. */
export function hookEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env["NODE_OPTIONS"];
  delete env["CREWRIG_USAGE_CAPTURE_TEST"];
  delete env["CREWRIG_USAGE_CAPTURE_CLI"];
  return { ...env, ...extra };
}

/**
 * Run an entry the way a CLI does: `node <entry> <args>` with no flag, the
 * payload on standard input, output captured.
 */
export function runEntry(
  entry: string,
  args: readonly string[],
  input: string | null,
  env: NodeJS.ProcessEnv,
  extra: SpawnSyncOptions = {},
): RunResult {
  const res = spawnSync(process.execPath, [entry, ...args], {
    encoding: "utf8",
    env,
    ...(input === null ? { stdio: ["ignore", "pipe", "pipe"] } : { input }),
    ...extra,
  });
  return { status: res.status, stdout: String(res.stdout), stderr: String(res.stderr) };
}

/** A `hook-run.ts` stub that appends `label` to `$MARKER` on load and on each call. */
export function markerHookRun(label = "run"): string {
  return [
    'import fs from "node:fs";',
    'const marker = process.env["MARKER"] ?? "";',
    'fs.appendFileSync(marker, "loaded\\n");',
    "export async function runCapture(input: { cli: string; event: string; rawPayload: string }): Promise<void> {",
    `  fs.appendFileSync(marker, ${JSON.stringify(label)} + " " + input.cli + " " + input.event + "\\n");`,
    "}",
    "",
  ].join("\n");
}
