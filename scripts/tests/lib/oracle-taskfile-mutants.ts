// oracle-taskfile-mutants.ts — the Taskfile mutants of the case-20 (R19) mutation property
// for the `cmds:` form (spec 0255 delta-03). The entry `install-workspace` of a scratch
// copy is first rewritten into the two-command form (floor guard, then the entry's own
// command), then one mutant is applied on top. Idempotent: an entry already written as
// `cmds:` keeps its last command as "the entry's own command".

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const ENTRY = "install-workspace";
export const GUARD_CMD = "node {{.REPO_DIR}}/scripts/lib/node-floor-guard.js";
export const R19 = "r19: all twelve";

export interface TaskfileMutant {
  readonly id: string;
  /** The commands the entry carries, given its own command; null leaves the entry out. */
  readonly commands: (own: string) => readonly string[];
  readonly rename?: string;
  /** Lowercase substring the R19 detail must carry: which guard caught the mutant. */
  readonly detail: string;
}

export const TASKFILE_MUTANTS: readonly TaskfileMutant[] = [
  {
    id: "T1 second command removed",
    commands: () => [GUARD_CMD],
    detail: "no longer drives",
  },
  {
    id: "T2 first command fails",
    commands: (own) => ['node -e "process.exit(3)"', own],
    detail: "exited 3",
  },
  {
    id: "T3 script named in neither spelling",
    commands: (own) => [
      GUARD_CMD,
      own.replace(/install-workspace\.(sh|ts)/, "install-workspace-x.$1"),
    ],
    detail: "no longer drives",
  },
  {
    id: "T4 entry absent (extraction yields no command)",
    commands: (own) => [GUARD_CMD, own],
    rename: `${ENTRY}-gone`,
    detail: "no such entry point",
  },
];

/** Rewrite the entry as `cmds:` (the baseline when `mutant` is null), then apply `mutant`. */
export function rewriteEntry(taskfile: string, mutant: TaskfileMutant | null): string {
  const lines = taskfile.split("\n");
  const start = lines.indexOf(`  ${ENTRY}:`);
  if (start < 0) throw new Error(`Taskfile entry ${ENTRY} not found`);
  let end = start + 1;
  while (end < lines.length && !/^  [A-Za-z]/.test(lines[end] ?? "")) end++;
  const block = lines.slice(start, end);
  const single = block.findIndex((l) => l.startsWith("    cmd:"));
  const list = block.findIndex((l) => l.startsWith("    cmds:"));
  let own: string | undefined;
  let head: string[];
  let tail: string[];
  if (single >= 0) {
    own = block[single]?.replace(/^ {4}cmd:\s*/, "");
    head = block.slice(0, single);
    tail = block.slice(single + 1);
  } else if (list >= 0) {
    const items = block.map((l, i) => (/^ {6}- /.test(l) ? i : -1)).filter((i) => i >= 0);
    const last = items[items.length - 1] ?? list;
    own = block[last]?.replace(/^ {6}- /, "");
    head = block.slice(0, list);
    tail = block.slice(last + 1);
  } else {
    throw new Error(`entry ${ENTRY} has no command`);
  }
  if (own === undefined) throw new Error(`entry ${ENTRY} has no command`);
  const cmds = mutant === null ? [GUARD_CMD, own] : mutant.commands(own);
  const rebuilt = [...head, "    cmds:", ...cmds.map((c) => `      - ${c}`), ...tail];
  if (mutant?.rename !== undefined) rebuilt[0] = `  ${mutant.rename}:`;
  return [...lines.slice(0, start), ...rebuilt, ...lines.slice(end)].join("\n");
}

/** A directory of symlinks to every executable on PATH except go-task, to force the fallback runner. */
export function tasklessPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oracle-taskless-"));
  for (const bin of (process.env.PATH ?? "").split(path.delimiter)) {
    let names: string[] = [];
    try {
      names = fs.readdirSync(bin);
    } catch {
      continue;
    }
    for (const name of names) {
      if (name === "task" || fs.existsSync(path.join(dir, name))) continue;
      try {
        fs.symlinkSync(path.join(bin, name), path.join(dir, name));
      } catch {
        // unreadable or racing entry: the suite reports a missing tool loudly
      }
    }
  }
  return dir;
}
