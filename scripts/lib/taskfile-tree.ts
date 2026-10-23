// taskfile-tree.ts — include-aware reader of the Taskfile tree (spec 0278 R10).
//
// Reads the root Taskfile and follows `includes:` recursively: the string form
// (`key: ./taskfiles/x.yml`, a namespace of the same name) and the object form
// (`key: { taskfile, flatten, optional, ... }`), nested includes, and relative `taskfile:` paths.
// Every task comes back with its effective name, its defining file and its raw definition. It never
// spawns `task` and never returns a partial tree: an unreadable or unparsable file, an invalid
// include or a cycle throws a TaskfileTreeError.
//
// Usage: loadTaskfileTree(repoDir) -> TaskfileTree; taskfilePaths(repoDir) for the file list only.
// Effective names: a namespaced include prefixes `<key>:` (nested: `<parent>:<key>:`); a flattened
// include keeps the including file's namespace. Duplicate effective names are kept in `tasks`
// (Task's own "Found multiple tasks" error is the enforcement); `byName` keeps the first.

import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { load } from "js-yaml";
import {
  ROOT_FILE,
  TaskfileTreeError,
  isRecord,
  parseIncludes,
  sliceTaskSource,
  toPosix,
} from "./taskfile-tree-parse.ts";
import type { TaskEntry, TaskfileNode, TaskfileTree } from "./taskfile-tree-parse.ts";

export { TaskfileTreeError } from "./taskfile-tree-parse.ts";
export type {
  IncludeRecord,
  TaskEntry,
  TaskfileNode,
  TaskfileTree,
  TaskfileTreeErrorKind,
} from "./taskfile-tree-parse.ts";

interface LoadState {
  repoDir: string;
  nodes: TaskfileNode[];
  tasks: TaskEntry[];
}

function loadNode(state: LoadState, abs: string, namespace: string, stack: string[]): void {
  const rel = toPosix(path.relative(state.repoDir, abs));
  if (stack.includes(abs)) {
    throw new TaskfileTreeError(
      "cycle",
      rel,
      `include cycle: ${[...stack, abs].map((p) => toPosix(path.relative(state.repoDir, p))).join(" -> ")}`,
    );
  }
  let text: string;
  try {
    text = readFileSync(abs, "utf8");
  } catch (err) {
    throw new TaskfileTreeError(
      "unreadable",
      rel,
      err instanceof Error ? err.message : String(err),
    );
  }
  let doc: unknown;
  try {
    doc = load(text);
  } catch (err) {
    throw new TaskfileTreeError(
      "unparsable",
      rel,
      err instanceof Error ? err.message : String(err),
    );
  }
  if (!isRecord(doc)) {
    throw new TaskfileTreeError("unparsable", rel, "the document is not a mapping");
  }
  const includes = parseIncludes(state.repoDir, abs, rel, doc);
  state.nodes.push({
    file: rel,
    namespace,
    version: doc["version"],
    text,
    doc,
    includes: includes.map((i) => i.record),
  });
  const tasks = doc["tasks"];
  if (isRecord(tasks)) {
    for (const [localName, definition] of Object.entries(tasks)) {
      state.tasks.push({
        name: namespace === "" ? localName : `${namespace}:${localName}`,
        localName,
        namespace,
        file: rel,
        definition,
        source: sliceTaskSource(text, localName),
      });
    }
  }
  for (const { record, abs: childAbs } of includes) {
    const childNamespace = record.flatten
      ? namespace
      : namespace === ""
        ? record.key
        : `${namespace}:${record.key}`;
    if (record.optional && !isFile(childAbs)) {
      continue;
    }
    loadNode(state, childAbs, childNamespace, [...stack, abs]);
  }
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Load the whole tree below `rootFile` (default `Taskfile.yml`) of `repoDir`. */
export function loadTaskfileTree(repoDir: string, rootFile: string = ROOT_FILE): TaskfileTree {
  const state: LoadState = { repoDir: path.resolve(repoDir), nodes: [], tasks: [] };
  loadNode(state, path.resolve(state.repoDir, rootFile), "", []);
  const byName = new Map<string, TaskEntry>();
  for (const task of state.tasks) {
    if (!byName.has(task.name)) {
      byName.set(task.name, task);
    }
  }
  const files = [...new Set(state.nodes.map((n) => n.file))];
  return {
    root: toPosix(path.relative(state.repoDir, path.resolve(state.repoDir, rootFile))),
    files,
    nodes: state.nodes,
    tasks: state.tasks,
    byName,
  };
}

/** Every Taskfile path of the tree, repo-relative and POSIX, root first. */
export function taskfilePaths(repoDir: string): string[] {
  return loadTaskfileTree(repoDir).files;
}

/**
 * Resolve a task reference written in `fromFile` (spec 0278 R20). A leading `:` anchors at the root;
 * otherwise the name is relative to the namespace of the file, which is the full global name in the
 * root and in flattened files.
 */
export function resolveTaskRef(
  tree: TaskfileTree,
  fromFile: string,
  ref: string,
): TaskEntry | undefined {
  if (ref.startsWith(":")) {
    return tree.byName.get(ref.slice(1));
  }
  const node = tree.nodes.find((n) => n.file === fromFile);
  const namespace = node?.namespace ?? "";
  return tree.byName.get(namespace === "" ? ref : `${namespace}:${ref}`);
}

function cmdText(item: unknown): string | undefined {
  if (typeof item === "string") {
    return item;
  }
  if (isRecord(item) && typeof item["cmd"] === "string") {
    return item["cmd"];
  }
  return undefined;
}

/**
 * Every shell command of one task, verbatim and in order: a single `cmd:` or the string and `{cmd}`
 * items of `cmds:`. Task calls (`{task: ...}`) and other items are skipped. An unknown task yields [].
 */
export function taskCmds(tree: TaskfileTree, name: string): string[] {
  const definition = tree.byName.get(name)?.definition;
  if (!isRecord(definition)) {
    return [];
  }
  const single = cmdText(definition["cmd"]);
  if (single !== undefined) {
    return [single];
  }
  const cmds = definition["cmds"];
  if (!Array.isArray(cmds)) {
    return [];
  }
  return cmds.flatMap((item) => {
    const text = cmdText(item);
    return text === undefined ? [] : [text];
  });
}
