// taskfile-tree-parse.ts — types, errors and per-file parsing of the Taskfile tree (spec 0278 R10).
//
// The parts of the loader that look at one file at a time: the tree's types and TaskfileTreeError,
// the include parser (string and object forms, directory paths, extra keys recorded) and the
// key-line scan that slices one task's YAML text under `tasks:`. scripts/lib/taskfile-tree.ts
// re-exports the public types and the error; consumers import from there, not from here.

import { statSync } from "node:fs";
import path from "node:path";

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
  /** The raw `dir:` value when the include declares one (spec 0278 delta-02 R32), else undefined. */
  dir?: unknown;
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

export const ROOT_FILE = "Taskfile.yml";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function toPosix(p: string): string {
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
export function sliceTaskSource(text: string, localName: string): string {
  const lines = text.split("\n");
  const tasksAt = lines.findIndex((l) => /^tasks:\s*(#.*)?$/.test(l));
  if (tasksAt < 0) {
    return "";
  }
  const keyPattern = new RegExp(
    `^(\\s+)(?:${escapeRegExp(localName)}|"${escapeRegExp(localName)}"|'${escapeRegExp(localName)}'):(?:\\s|$)`,
  );
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

export function parseIncludes(
  repoDir: string,
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
    let dir: unknown;
    if (isRecord(value)) {
      target = value["taskfile"];
      flatten = value["flatten"] === true;
      optional = value["optional"] === true;
      dir = value["dir"];
      extraKeys = Object.keys(value).filter(
        (k) => !["taskfile", "flatten", "optional"].includes(k),
      );
    }
    if (typeof target !== "string" || target === "") {
      throw new TaskfileTreeError(
        "invalid-include",
        fromRel,
        `include '${key}' has no taskfile path`,
      );
    }
    let abs = path.resolve(path.dirname(fromAbs), target);
    if (isDirectory(abs)) {
      abs = path.join(abs, ROOT_FILE);
    }
    const record: IncludeRecord = {
      key,
      file: toPosix(path.relative(repoDir, abs)),
      flatten,
      optional,
      extraKeys,
      ...(dir === undefined ? {} : { dir }),
    };
    out.push({ record, abs });
  }
  return out;
}
