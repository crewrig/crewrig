// entry-ctx.ts — the context every extension entry builds first (spec 0254 R5, R15).
// Resolves the repository from the entry file (never by searching for `.git`), reads the
// target table once, loads `js-yaml` here and nowhere else, and binds the command renderer.
// A missing `js-yaml` prints its diagnostic and yields `null` (the entry exits 1), as
// scripts/lib/build-components/main.ts does.

import fs from "node:fs";
import path from "node:path";

import { createRenderCommand } from "../render-command.ts";
import { loadDependency, MissingDependencyError } from "../require-dependency.ts";
import { createYamlText, toYamlLib } from "../yaml-text.ts";
import { readTargetTable } from "./descriptors.ts";
import type { Env, ExtCtx, Io } from "./types.ts";

export interface EntryInput {
  /** Script arguments only (`process.argv.slice(2)`). */
  readonly argv: readonly string[];
  readonly env: Env;
  readonly platform: NodeJS.Platform;
  /** The entry's own file: `<repoDir>/scripts/<name>.ts`. */
  readonly entryFile: string;
  readonly io: Io;
}

/** The physical grandparent of the entry file, as the shell's `cd "$(dirname "$0")/.."`. */
export function repoDirOf(entryFile: string): string {
  return path.dirname(fs.realpathSync(path.dirname(entryFile)));
}

export async function createCtx(input: EntryInput): Promise<ExtCtx | null> {
  let namespace: unknown;
  try {
    namespace = await loadDependency("js-yaml");
  } catch (error) {
    if (!(error instanceof MissingDependencyError)) throw error;
    input.io.err(error.message);
    return null;
  }
  const repoDir = repoDirOf(input.entryFile);
  const libDir = path.join(repoDir, "scripts", "lib");
  const yaml = createYamlText(toYamlLib(namespace));
  return {
    repoDir,
    libDir,
    env: input.env,
    platform: input.platform,
    io: input.io,
    table: readTargetTable(libDir),
    renderCommand: createRenderCommand(yaml),
    yaml,
  };
}
