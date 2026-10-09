// antigravity-staging.ts — the temporary directory `mempalace mine` needs for the Antigravity
// history file (spec 0253 R15): `mine` takes a directory, the history is a single file, so the
// file is hard-linked (copied when the link crosses a device) into a fresh directory.
// The shell's `trap cleanup EXIT` becomes the caller's `finally { staged.dispose(); }`.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface StagedHistory {
  /** The directory to hand to `mine`; holds `history.jsonl`. */
  readonly dir: string;
  /** Remove the directory recursively; idempotent. */
  dispose(): void;
}

/** Create `<tmpdir>/tmp.<random>/history.jsonl` for `file`, by hard link or, failing that, a copy. */
export function stageHistoryFile(file: string): StagedHistory {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tmp."));
  const dispose = (): void => {
    fs.rmSync(dir, { recursive: true, force: true });
  };
  const target = path.join(dir, "history.jsonl");
  try {
    try {
      fs.linkSync(file, target);
    } catch {
      fs.copyFileSync(file, target);
    }
  } catch (error) {
    dispose();
    throw error;
  }
  return { dir, dispose };
}
