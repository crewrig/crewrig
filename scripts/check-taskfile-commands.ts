// check-taskfile-commands.ts — the Taskfile tree (root and every included file) names no POSIX-only command (spec 0266 R13).
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-taskfile-commands.ts
// Override the repository root with CREWRIG_REPO_DIR (default: the parent of scripts/).
//
// A task entry (cmds, cmd, preconditions, status, sh vars) that names bash, sh, a `.sh` path, jq,
// yq, awk, sed, grep, mktemp, curl, ln, lsof, ss, `test` or `command -v` fails, unless
// scripts/lib/taskfile-command-exemptions.json lists that task+command with its owning row and
// issue. An exemption that no longer matches a Taskfile command is stale and fails too, so every
// deletion PR shrinks the list; the final removal row empties it and deletes the file.
// Exit: 0 clean, 1 violations or stale/invalid exemptions (stderr), 2 unreadable input.

import { readFileSync } from "node:fs";
import path from "node:path";
import { findForbiddenInTree } from "./lib/taskfile-commands.ts";
import { loadTaskfileTree, TaskfileTreeError } from "./lib/taskfile-tree.ts";
import { parseExemptions } from "./lib/taskfile-command-exemption-file.ts";

const envDir = process.env["CREWRIG_REPO_DIR"];
const repoDir =
  envDir !== undefined && envDir !== "" ? envDir : path.resolve(import.meta.dirname, "..");

function read(file: string): string | undefined {
  try {
    return readFileSync(path.join(repoDir, file), "utf8");
  } catch {
    process.stderr.write(`check-taskfile-commands: cannot read ${file}\n`);
    return undefined;
  }
}

function loadTree(): ReturnType<typeof loadTaskfileTree> | undefined {
  try {
    return loadTaskfileTree(repoDir);
  } catch (err) {
    if (err instanceof TaskfileTreeError) {
      process.stderr.write(`check-taskfile-commands: ${err.message}\n`);
      return undefined;
    }
    throw err;
  }
}

const tree = loadTree();
const exemptionText = read("scripts/lib/taskfile-command-exemptions.json");
if (tree === undefined || exemptionText === undefined) {
  process.exitCode = 2;
} else {
  const { entries, problems } = parseExemptions(exemptionText);
  const found = findForbiddenInTree(tree);
  const key = (task: string, command: string): string => `${task}\u0000${command}`;
  const exempt = new Set(entries.map((e) => key(e.task, e.command)));
  const used = new Set(found.map((f) => key(f.task, f.command)));
  for (const f of found.filter((x) => !exempt.has(key(x.task, x.command)))) {
    problems.push(`task '${f.task}' uses forbidden command '${f.command}' (not exempted)`);
  }
  for (const e of entries.filter((x) => !used.has(key(x.task, x.command)))) {
    problems.push(
      `stale exemption: task '${e.task}' no longer uses '${e.command}' (owner ${e.owner}, ${e.issue}); remove it`,
    );
  }
  if (problems.length > 0) {
    process.stderr.write(
      `check-taskfile-commands: FAILED\n${problems.map((p) => `  - ${p}`).join("\n")}\n`,
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(`check-taskfile-commands: OK (${entries.length} exemption(s))\n`);
  }
}
