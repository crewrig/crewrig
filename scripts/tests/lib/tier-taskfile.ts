// Taskfile entry-point driver for the tier-resolution suite (spec 0119 R19, ported by spec 0263).

import { spawnSync } from "node:child_process";
import { loadTaskfileTree, taskCmds } from "../../lib/taskfile-tree.ts";
import type { FixtureTree } from "./build-fixture-tree.ts";
import { runIn } from "./tier-landing.ts";
import type { Out } from "./tier-fixtures.ts";

/** Whether the go-task runner is on PATH. */
export const HAS_TASK = spawnSync("task", ["--version"], { encoding: "utf8" }).status === 0;

/** Drive one entry by the go-task runner, else by its extracted commands in one `set -e` shell. */
export function driveTask(
  t: FixtureTree,
  name: string,
  vars: { TYPE?: string; NAME?: string },
  home: string,
  stdin: string,
): Out {
  if (HAS_TASK) {
    // Task applies CLI overrides of root vars only to root tasks, so REPO_DIR comes from PWD,
    // which runIn sets to the fixture root.
    const args = ["-d", t.root, name];
    if (vars.TYPE !== undefined) args.push(`TYPE=${vars.TYPE}`);
    if (vars.NAME !== undefined) args.push(`NAME=${vars.NAME}`);
    return runIn(t, "task", args, home, stdin);
  }
  const line = taskCmds(loadTaskfileTree(t.root), name)
    .map((c) =>
      c
        .replaceAll("{{.REPO_DIR}}", t.root)
        .replaceAll("{{.TYPE}}", vars.TYPE ?? "")
        .replaceAll("{{.NAME}}", vars.NAME ?? ""),
    )
    .join("\n");
  return runIn(t, "bash", ["-c", `set -e\n${line}`], home, stdin);
}
