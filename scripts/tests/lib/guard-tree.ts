// guard-tree.ts — a throwaway checkout for testing the guard entry (spec 0248
// R10, R11; plan verification duty 3), in the manner of hook-fixture-tree.ts.
//
// Copies `hooks/worktree-git-guard.ts` and every `.ts` file of `scripts/lib/`
// (the worktree-claim modules included) into a temporary directory that holds
// an empty `.git` and a root `package.json` with no `"type"` field. A test can
// then replace `scripts/lib/worktree-claim/claim-state.ts` with a marker stub,
// or delete it, and run the entry from that copy through its real file: what
// is asserted is what ships.

import fs from "node:fs";
import path from "node:path";

import { realTmp, REPO } from "./worktree-fixtures.ts";

export interface GuardTree {
  readonly root: string;
  /** The copied entry. */
  readonly entry: string;
  /** Absolute path of a file inside the tree. */
  file(...segments: string[]): string;
  cleanup(): void;
}

/**
 * A `claim-state.ts` stub: appends `loaded` to $MARKER when the module is
 * loaded and `called <ticket>` when `readClaimState` runs, then answers the
 * state named by $STUB_STATE (`claimed`, `unclaimed` or `undetermined`).
 */
export const MARKER_CLAIM_STATE = [
  'import fs from "node:fs";',
  'const marker = process.env["MARKER"] ?? "";',
  'fs.appendFileSync(marker, "loaded\\n");',
  "export function readClaimState(input: { ticket: string }): Record<string, string> {",
  '  fs.appendFileSync(marker, "called " + input.ticket + "\\n");',
  '  const state = process.env["STUB_STATE"] ?? "unclaimed";',
  '  if (state === "claimed") return { state, holder: "stub", since: "", operation: "" };',
  '  if (state === "undetermined") return { state, reason: "stub" };',
  '  return { state: "unclaimed" };',
  "}",
  "",
].join("\n");

function copyTs(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === "worktree-claim")
        copyTs(path.join(from, entry.name), path.join(to, entry.name));
    } else if (entry.name.endsWith(".ts")) {
      fs.copyFileSync(path.join(from, entry.name), path.join(to, entry.name));
    }
  }
}

export function makeGuardTree(options: { claimState?: string | null } = {}): GuardTree {
  const root = realTmp("crewrig-guard-tree-");
  fs.mkdirSync(path.join(root, ".git"));
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "fixture", private: true }),
  );
  fs.mkdirSync(path.join(root, "hooks"));
  fs.copyFileSync(
    path.join(REPO, "hooks", "worktree-git-guard.ts"),
    path.join(root, "hooks", "worktree-git-guard.ts"),
  );
  copyTs(path.join(REPO, "scripts", "lib"), path.join(root, "scripts", "lib"));
  const claimState = path.join(root, "scripts", "lib", "worktree-claim", "claim-state.ts");
  if (options.claimState === null) fs.rmSync(claimState, { force: true });
  else if (options.claimState !== undefined) fs.writeFileSync(claimState, options.claimState);
  return {
    root,
    entry: path.join(root, "hooks", "worktree-git-guard.ts"),
    file: (...segments) => path.join(root, ...segments),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}
