// governance-hook-tokens-cases.test.ts — Replaces scripts/tests/test-check-extension-hook-tokens.sh
// (cases 1, 2; case 0 and the broad form of 1 stay in governance-check-extension-hook-tokens.test.ts).
// Spec 0265 (row J2): a sandbox copy of the entry and scripts/lib carries one fixture extension
// whose resolver (hooks-resolve.ts) is deliberately broken per case; never the repository tree.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { copyTracked, makeSandbox, runEntry, stageNodeModules } from "./lib/governance-sandbox.ts";

const RESOLVE = path.join("scripts", "lib", "extension", "hooks-resolve.ts");

function run(command: string, from: string, to: string) {
  const root = makeSandbox("hook-tokens-");
  copyTracked(root, ["scripts/check-extension-hook-tokens.ts", "scripts/lib"]);
  stageNodeModules(root);
  for (const tier of ["core", "library", "org"]) {
    fs.mkdirSync(path.join(root, "extensions", tier), { recursive: true });
  }
  const ext = path.join(root, "extensions", "core", "tokenfix");
  fs.mkdirSync(ext, { recursive: true });
  fs.writeFileSync(
    path.join(ext, "extension.json"),
    JSON.stringify({
      name: "tokenfix",
      version: "0.0.1",
      description: "fixture",
      hooks: [{ id: "probe", event: "PreToolUse", command }],
    }),
  );
  const file = path.join(root, RESOLVE);
  const before = fs.readFileSync(file, "utf8");
  const after = before.replace(from, to);
  assert.notEqual(after, before, "mutation of hooks-resolve.ts changed nothing");
  fs.writeFileSync(file, after);
  const r = runEntry(path.join(root, "scripts", "check-extension-hook-tokens.ts"), { cwd: root });
  return { status: r.status, out: r.stdout + r.stderr };
}

describe("check-extension-hook-tokens.ts mutation cases", () => {
  test("Case 1 — a surviving neutral token fails the check, naming the file and the token", () => {
    // An early return of the command UNCHANGED for claude leaves the neutral token unresolved in
    // Claude's emitted hooks/hooks.json: a target that never got wired into the substitution.
    const r = run(
      "bash ${extensionRoot}/hooks/handler.sh",
      "const rootToken = table[target].rootToken;",
      'const rootToken = table[target].rootToken; if (target === "claude") return command;',
    );
    assert.notEqual(r.status, 0);
    assert.ok(r.out.includes("hooks/hooks.json"), r.out);
    assert.ok(r.out.includes("${extensionRoot}"), r.out);
  });

  test("Case 2 — first-occurrence substitution leaves a second token named as its own occurrence", () => {
    const r = run(
      "bash ${extensionRoot}/hooks/handler.sh --root=${extensionRoot}",
      "command.split(EXT_HOOKS_NEUTRAL_ROOT_TOKEN).join(rootToken)",
      "command.replace(EXT_HOOKS_NEUTRAL_ROOT_TOKEN, rootToken)",
    );
    const occurrences = r.out
      .split("\n")
      .filter((l) => l.includes("surviving neutral token occurrence")).length;
    assert.notEqual(r.status, 0);
    assert.ok(occurrences >= 2, `found ${occurrences} occurrence lines:\n${r.out}`);
  });
});
