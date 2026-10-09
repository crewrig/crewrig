// process-tree.ts — the parent table for the descendant test (spec 0252
// requirement 16; PLAN v3 D8 *Parent table*). Linux reads /proc/<pid>/stat;
// macOS and Windows parse what os-inspect.ts returns. This file spawns nothing.
//
// A table is a pid -> parent-pid map, or null when it could not be obtained
// (the owner verdict then says UNVERIFIABLE, never USURPED).

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { processTable } from "./os-inspect.ts";
import { parseProcessRows } from "./task-snapshot.ts";

export type ParentTable = ReadonlyMap<number, number>;

export interface TreeOptions {
  platform?: NodeJS.Platform;
  /** Root of the proc file system; a test points it at a fixture tree. */
  procRoot?: string;
}

/** `pid (comm) S ppid ...`: `comm` may hold spaces and parentheses, so cut at the LAST `)`. */
export function parseProcStat(text: string): { pid: number; ppid: number } | null {
  const close = text.lastIndexOf(")");
  const open = text.indexOf("(");
  if (open < 1 || close < open) return null;
  const pid = Number(text.slice(0, open).trim());
  const rest = text
    .slice(close + 1)
    .trim()
    .split(/\s+/);
  const ppid = Number(rest[1]);
  return Number.isInteger(pid) && Number.isInteger(ppid) && rest[1] !== undefined
    ? { pid, ppid }
    : null;
}

/** macOS `ps -axo pid=,ppid=`: two integers per line; any other line makes the table undeterminable. */
export function parsePsTable(text: string): ParentTable | null {
  const table = new Map<number, number>();
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const m = /^\s*([0-9]+)\s+([0-9]+)\s*$/.exec(line);
    if (m?.[1] === undefined || m[2] === undefined) return null;
    table.set(Number(m[1]), Number(m[2]));
  }
  return table.size === 0 ? null : table;
}

/** Windows: the `processes` array of the snapshot JSON. */
export function parseWindowsTable(stdout: string): ParentTable | null {
  let data: unknown;
  try {
    data = JSON.parse(stdout);
  } catch {
    return null;
  }
  const raw =
    typeof data === "object" && data !== null ? (data as { processes?: unknown }).processes : null;
  const rows = parseProcessRows(raw);
  return rows === null || rows.length === 0 ? null : new Map(rows.map((r) => [r.pid, r.ppid]));
}

function linuxTable(root: string): ParentTable | null {
  const table = new Map<number, number>();
  let names: string[];
  try {
    names = readdirSync(root).filter((n) => /^[0-9]+$/.test(n));
  } catch {
    return null;
  }
  for (const name of names) {
    try {
      const row = parseProcStat(readFileSync(join(root, name, "stat"), "utf8"));
      if (row !== null) table.set(row.pid, row.ppid);
    } catch {
      /* the process exited between the listing and the read */
    }
  }
  return table.size === 0 ? null : table;
}

/** The parent table of the running system, or null when it could not be obtained. */
export function parentTable(opts: TreeOptions = {}): ParentTable | null {
  const platform = opts.platform ?? process.platform;
  if (platform === "linux") return linuxTable(opts.procRoot ?? "/proc");
  if (platform !== "darwin" && platform !== "win32") return null;
  const r = processTable(platform);
  if (!r.ok) return null;
  return platform === "darwin" ? parsePsTable(r.stdout) : parseWindowsTable(r.stdout);
}

/** True when `ancestor` is a strict ancestor of `pid` in `table` (cycle-safe). */
export function hasAncestor(table: ParentTable, pid: number, ancestor: number): boolean {
  const seen = new Set<number>();
  for (
    let cur = table.get(pid);
    cur !== undefined && cur > 0 && !seen.has(cur);
    cur = table.get(cur)
  ) {
    if (cur === ancestor) return true;
    seen.add(cur);
  }
  return false;
}

/** Every strict descendant of `root`, ascending: the set `stop` snapshots before ending a task. */
export function descendants(table: ParentTable, root: number): number[] {
  return [...table.keys()]
    .filter((p) => p !== root && hasAncestor(table, p, root))
    .sort((a, b) => a - b);
}
