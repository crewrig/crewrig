// check-taskfile-tree.ts — layout guard of the Taskfile tree (spec 0278 R13, R14).
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-taskfile-tree.ts
// Override the repository root with CREWRIG_REPO_DIR (default: the parent of scripts/).
//
// Checks: every taskfiles/*.yml is reachable from the root includes; no script outside the
// allow-list reads the root Taskfile directly; the root defines only `default`; every Taskfile
// declares version '3.39'; no included file uses TASKFILE_DIR; every `deps:` and `- task:`
// reference resolves from its file's namespace; no include sets dir, excludes or aliases; and the
// loader's task names equal `task --list-all --json` (a NOTICE on stderr when task is absent).
// Exit: 0 clean, 1 findings (stderr), 2 unreadable or unparsable tree.

import path from "node:path";
import { checkTaskfileTree } from "./lib/governance/taskfile-tree-guard.ts";
import { TaskfileTreeError } from "./lib/taskfile-tree.ts";

const envDir = process.env["CREWRIG_REPO_DIR"];
const repoDir =
  envDir !== undefined && envDir !== "" ? envDir : path.resolve(import.meta.dirname, "..");

try {
  const result = checkTaskfileTree(repoDir);
  for (const notice of result.notices) {
    process.stderr.write(`check-taskfile-tree: NOTICE ${notice}\n`);
  }
  if (result.findings.length > 0) {
    process.stderr.write(
      `check-taskfile-tree: FAILED\n${result.findings.map((f) => `  - ${f}`).join("\n")}\n`,
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(
      `check-taskfile-tree: OK (${result.taskCount} tasks, ${result.fileCount} files)\n`,
    );
  }
} catch (err) {
  if (err instanceof TaskfileTreeError) {
    process.stderr.write(`check-taskfile-tree: cannot load the tree: ${err.message}\n`);
    process.exitCode = 2;
  } else {
    throw err;
  }
}
