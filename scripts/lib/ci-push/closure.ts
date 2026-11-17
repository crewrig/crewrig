// closure.ts — the Taskfile closure of the R6 wiring test (spec 0309 delta-02 R6, R7): which tests
// under scripts/tests/ and which check-*.ts scripts a command reaches, transitively over the
// `{task: ...}` calls, `deps:` and `task <name>` shell words of the Taskfile tree
// (scripts/lib/taskfile-tree.ts).
//
// Usage: closure(tree, texts) -> {tests, checks, tasks}; scanText(text) is the per-text scan.
// A `scripts/tests/*.test.ts` glob is not expanded: only literal file names are reached.

import { resolveTaskRef } from "../taskfile-tree.ts";
import type { TaskfileTree } from "../taskfile-tree.ts";

export interface Reach {
  tests: string[];
  checks: string[];
  tasks: string[];
}

const TASK_WORD = /(?:^|[\s;&|(])task\s+(?:-[-\w=]+\s+)*(:?[A-Za-z0-9_][A-Za-z0-9_:-]*)/g;
const TEST_FILE = /scripts\/tests\/([A-Za-z0-9_.\-/]+\.[cm]?[jt]s)/g;
const CHECK_FILE = /\b(check-[A-Za-z0-9_-]+\.[cm]?[jt]s)\b/g;

/** The task words, tests and check scripts a command text names. */
export function scanText(text: string): Reach {
  const pick = (re: RegExp, f: (m: RegExpMatchArray) => string): string[] =>
    [...text.matchAll(re)].map(f);
  return {
    tasks: pick(TASK_WORD, (m) => m[1] ?? ""),
    tests: pick(TEST_FILE, (m) => `scripts/tests/${m[1] ?? ""}`),
    checks: pick(CHECK_FILE, (m) => m[1] ?? ""),
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Texts and task references of one task definition. */
function taskContent(def: unknown): { texts: string[]; calls: string[] } {
  const out = { texts: [] as string[], calls: [] as string[] };
  if (!isRecord(def)) return out;
  const items: unknown[] = [];
  if (def["cmd"] !== undefined) items.push(def["cmd"]);
  if (Array.isArray(def["cmds"])) items.push(...(def["cmds"] as unknown[]));
  if (Array.isArray(def["deps"])) items.push(...(def["deps"] as unknown[]));
  for (const it of items) {
    if (typeof it === "string") out.texts.push(it);
    else if (isRecord(it)) {
      if (typeof it["cmd"] === "string") out.texts.push(it["cmd"]);
      if (typeof it["task"] === "string") out.calls.push(it["task"]);
    }
  }
  return out;
}

/** The closure of the given command texts over the Taskfile tree. */
export function closure(tree: TaskfileTree, texts: string[]): Reach {
  const tests = new Set<string>();
  const checks = new Set<string>();
  const seen = new Set<string>();
  const queue: { ref: string; from: string }[] = [];
  const visitText = (t: string, from: string): void => {
    const s = scanText(t);
    s.tests.forEach((x) => tests.add(x));
    s.checks.forEach((x) => checks.add(x));
    s.tasks.forEach((ref) => queue.push({ ref, from }));
  };
  texts.forEach((t) => visitText(t, tree.root));
  while (queue.length > 0) {
    const { ref, from } = queue.shift() as { ref: string; from: string };
    const entry = resolveTaskRef(tree, from, ref);
    if (entry === undefined || seen.has(entry.name)) continue;
    seen.add(entry.name);
    const c = taskContent(entry.definition);
    c.texts.forEach((t) => visitText(t, entry.file));
    c.calls.forEach((r) => queue.push({ ref: r, from: entry.file }));
  }
  return { tests: [...tests].sort(), checks: [...checks].sort(), tasks: [...seen].sort() };
}
