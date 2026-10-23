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

export interface TaskEntry {
  /** Effective name, e.g. "e2e:build:base" or "setup:playwright-mcp". */
  name: string;
  /** The key in its defining file, e.g. "build:base". */
  localName: string;
  /** Namespace of the defining file: "" for the root and for flattened files. */
  namespace: string;
  /** Repo-relative POSIX path of the defining file. */
  file: string;
  /** The raw js-yaml value of the task. Primary view for consumers. */
  definition: unknown;
  /** YAML text slice of the task in `file` (key line to last body line). Fallback for text checks. */
  source: string;
}

export interface IncludeRecord {
  key: string;
  /** Repo-relative POSIX path of the included file. */
  file: string;
  flatten: boolean;
  optional: boolean;
  /** Include keys other than `taskfile`, `flatten` and `optional` (dir, excludes, aliases, ...). */
  extraKeys: string[];
}

export interface TaskfileNode {
  file: string;
  namespace: string;
  version: unknown;
  text: string;
  doc: Record<string, unknown>;
  includes: IncludeRecord[];
}

export interface TaskfileTree {
  /** Repo-relative path of the root file. */
  root: string;
  /** Every Taskfile of the tree, root first, without duplicates. */
  files: string[];
  nodes: TaskfileNode[];
  tasks: TaskEntry[];
  byName: ReadonlyMap<string, TaskEntry>;
}

export type TaskfileTreeErrorKind = "unreadable" | "unparsable" | "cycle" | "invalid-include";

export class TaskfileTreeError extends Error {
  readonly kind: TaskfileTreeErrorKind;
  readonly file: string;

  constructor(kind: TaskfileTreeErrorKind, file: string, detail: string) {
    super(`${kind}: ${file}: ${detail}`);
    this.name = "TaskfileTreeError";
    this.kind = kind;
    this.file = file;
  }
}

const ROOT_FILE = "Taskfile.yml";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The YAML text of one task under `tasks:`, found by a key-line scan (the one scanner of the tree). */
function sliceTaskSource(text: string, localName: string): string {
  const lines = text.split("\n");
  const tasksAt = lines.findIndex((l) => /^tasks:\s*(#.*)?$/.test(l));
  if (tasksAt < 0) {
    return "";
  }
  const keyPattern = new RegExp(`^(\\s+)(?:${escapeRegExp(localName)}|"${escapeRegExp(localName)}"|'${escapeRegExp(localName)}'):(?:\\s|$)`);
  let indent = -1;
  let start = -1;
  let end = lines.length;
  for (let i = tasksAt + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.trim() === "" || /^\s*#/.test(line)) {
      continue;
    }
    if (!/^\s/.test(line)) {
      end = i;
      break;
    }
    const lead = line.length - line.trimStart().length;
    if (indent < 0) {
      indent = lead;
    }
    if (lead !== indent) {
      continue;
    }
    if (start >= 0) {
      end = i;
      break;
    }
    if (keyPattern.test(line)) {
      start = i;
    }
  }
  if (start < 0) {
    return "";
  }
  let last = end - 1;
  while (last > start) {
    const line = lines[last] ?? "";
    if (line.trim() === "" || /^\s*#/.test(line)) {
      last--;
    } else {
      break;
    }
  }
  return lines.slice(start, last + 1).join("\n");
}

interface LoadState {
  repoDir: string;
  nodes: TaskfileNode[];
  tasks: TaskEntry[];
}

function parseIncludes(
  state: LoadState,
  fromAbs: string,
  fromRel: string,
  doc: Record<string, unknown>,
): { record: IncludeRecord; abs: string }[] {
  const raw = doc["includes"];
  if (raw === undefined || raw === null) {
    return [];
  }
  if (!isRecord(raw)) {
    throw new TaskfileTreeError("invalid-include", fromRel, "`includes` is not a mapping");
  }
  const out: { record: IncludeRecord; abs: string }[] = [];
  for (const [key, value] of Object.entries(raw)) {
    let target: unknown = value;
    let flatten = false;
    let optional = false;
    let extraKeys: string[] = [];
    if (isRecord(value)) {
      target = value["taskfile"];
      flatten = value["flatten"] === true;
      optional = value["optional"] === true;
      extraKeys = Object.keys(value).filter((k) => !["taskfile", "flatten", "optional"].includes(k));
    }
    if (typeof target !== "string" || target === "") {
      throw new TaskfileTreeError("invalid-include", fromRel, `include '${key}' has no taskfile path`);
    }
    let abs = path.resolve(path.dirname(fromAbs), target);
    if (isDirectory(abs)) {
      abs = path.join(abs, ROOT_FILE);
    }
    const record: IncludeRecord = {
      key,
      file: toPosix(path.relative(state.repoDir, abs)),
      flatten,
      optional,
      extraKeys,
    };
    out.push({ record, abs });
  }
  return out;
}

function loadNode(state: LoadState, abs: string, namespace: string, stack: string[]): void {
  const rel = toPosix(path.relative(state.repoDir, abs));
  if (stack.includes(abs)) {
    throw new TaskfileTreeError("cycle", rel, `include cycle: ${[...stack, abs].map((p) => toPosix(path.relative(state.repoDir, p))).join(" -> ")}`);
  }
  let text: string;
  try {
    text = readFileSync(abs, "utf8");
  } catch (err) {
    throw new TaskfileTreeError("unreadable", rel, err instanceof Error ? err.message : String(err));
  }
  let doc: unknown;
  try {
    doc = load(text);
  } catch (err) {
    throw new TaskfileTreeError("unparsable", rel, err instanceof Error ? err.message : String(err));
  }
  if (!isRecord(doc)) {
    throw new TaskfileTreeError("unparsable", rel, "the document is not a mapping");
  }
  const includes = parseIncludes(state, abs, rel, doc);
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
