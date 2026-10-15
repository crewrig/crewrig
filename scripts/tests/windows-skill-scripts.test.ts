// windows-skill-scripts.test.ts — the cross-system proof of the eleven skill entries (spec 0258 R27,
// parent R17): the five github-actions entries, the two gitlab-ci entries and the four pr-reviewer
// entries each run from PowerShell and from `cmd.exe` on Windows, against a sandbox with stub wrapped
// tools written at test time and no `bash` on the child PATH. The `direct` leg runs the same assertions
// on any host (node itself, byte-exact output); the shell legs fold CRLF to LF and skip off Windows.
// The `windows-skill-scripts` job runs this file.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { defaultIsFile } from "../lib/worktree-claim/launch-windows.ts";
import type { Proof } from "./lib/windows-packaging-driver.ts";
import { resolveInterpreters, WIN } from "./lib/windows-proof-support.ts";
import { lintJson, textScans, wrapped } from "./lib/windows-skill-cases.ts";
import { lintSkill, noCarriageReturn, refusals } from "./lib/windows-skill-lint.ts";
import { makeBox } from "./lib/windows-skill-proof.ts";
import type { Ctx, Leg } from "./lib/windows-skill-proof.ts";

/** Run every case on one leg; the failures come back with their command, stdout and stderr. */
function runLeg(leg: Leg): string[] {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "windows-skill-")));
  try {
    const interpreters = resolveInterpreters({
      platform: process.platform,
      env: process.env,
      isFile: defaultIsFile,
    });
    console.log(`windows-skill-scripts: ${leg}: ${interpreters.notes.join("; ")}`);
    const proof: Proof = { interpreters, failures: [], landed: [], current: "setup" };
    const c: Ctx = { proof, leg, box: makeBox(root) };
    for (const cases of [textScans, wrapped, lintJson, lintSkill, refusals, noCarriageReturn])
      cases(c);
    return proof.failures;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe("windows skill scripts proof", () => {
  const legs: [Leg, string][] = [
    ["direct", "node runs each entry directly (any host)"],
    ["pwsh", "each entry runs from PowerShell"],
    ["cmd", "each entry runs from cmd.exe"],
  ];
  for (const [leg, title] of legs)
    it(title, { skip: leg !== "direct" && !WIN }, () => {
      const failures = runLeg(leg);
      assert.deepEqual(failures, [], failures.map((f, i) => `${i + 1}. ${f}`).join("\n"));
    });
});
