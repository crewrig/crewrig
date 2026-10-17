// Taskfile entry-point driver for the tier-resolution suite (spec 0119 R19, ported by spec 0263).

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import type { FixtureTree } from "./build-fixture-tree.ts";
import { runIn } from "./tier-landing.ts";
import type { Out } from "./tier-fixtures.ts";

/** Whether the go-task runner is on PATH. */
export const HAS_TASK = spawnSync("task", ["--version"], { encoding: "utf8" }).status === 0;

/**
 * Every command of one task entry, verbatim and in order: a single `cmd:` (one line) or a `cmds:`
 * list (one line per `- <command>` item). A `- |` block item is skipped with its continuation.
 */
export function taskfileCmds(taskfile: string, name: string): string[] {
  const out: string[] = [];
  let inBlock = false;
  let inList = false;
  let skipIndent = -1;
  for (const line of fs.readFileSync(taskfile, "utf8").split("\n")) {
    if (!inBlock) {
      inBlock = line === `  ${name}:`;
      continue;
    }
    if (/^ {2}[A-Za-z]/.test(line)) break;
    const single = /^\s*cmd:\s*(.*)$/.exec(line);
    if (single !== null) return [single[1] ?? ""];
    if (/^\s*cmds:\s*$/.test(line)) {
      inList = true;
      continue;
    }
    if (!inList) continue;
    const indent = line.length - line.trimStart().length;
    if (skipIndent >= 0) {
      if (indent === skipIndent && /^\s*-\s+/.test(line)) skipIndent = -1;
      else continue;
    }
    if (/^\s*-\s+[|>][-+]?\s*$/.test(line)) {
      skipIndent = indent;
      continue;
    }
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item !== null) out.push(item[1] ?? "");
  }
  return out;
}

/** Drive one entry by the go-task runner, else by its extracted commands in one `set -e` shell. */
export function driveTask(
  t: FixtureTree,
  name: string,
  vars: { TYPE?: string; NAME?: string },
  home: string,
  stdin: string,
): Out {
  if (HAS_TASK) {
    const args = ["-d", t.root, `REPO_DIR=${t.root}`, name];
    if (vars.TYPE !== undefined) args.push(`TYPE=${vars.TYPE}`);
    if (vars.NAME !== undefined) args.push(`NAME=${vars.NAME}`);
    return runIn(t, "task", args, home, stdin);
  }
  const line = taskfileCmds(t.resolve("Taskfile.yml"), name)
    .map((c) =>
      c
        .replaceAll("{{.REPO_DIR}}", t.root)
        .replaceAll("{{.TYPE}}", vars.TYPE ?? "")
        .replaceAll("{{.NAME}}", vars.NAME ?? ""),
    )
    .join("\n");
  return runIn(t, "bash", ["-c", `set -e\n${line}`], home, stdin);
}
