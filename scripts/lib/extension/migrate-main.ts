// migrate-main.ts — the migration entry's order of operations (spec 0254 R20, R25).
// Twin of the head of scripts/migrate-extension.sh (:41-50): arguments, then the tool. The tool
// needs no YAML library, so the context is not built here: the repository root and the descriptor
// directory come from the entry file's physical location (`scripts/<entry>.ts` -> its grandparent).

import fs from "node:fs";
import path from "node:path";

import { parseMigrateArgs } from "./args.ts";
import type { EntryInput } from "./entry-ctx.ts";
import { migrateExtension } from "./migrate.ts";

/** Run the migration; returns the exit status and never exits the process. */
export function migrateMain(input: EntryInput): Promise<number> {
  const parsed = parseMigrateArgs(input.argv);
  if (!parsed.ok) {
    input.io.err(parsed.message);
    return Promise.resolve(parsed.status);
  }
  const scriptsDir = fs.realpathSync.native(path.dirname(input.entryFile));
  const repoDir = path.resolve(scriptsDir, "..");
  const libDir = `${scriptsDir}/lib`;
  return Promise.resolve(migrateExtension({ repoDir, libDir, io: input.io }, parsed.extArg));
}
