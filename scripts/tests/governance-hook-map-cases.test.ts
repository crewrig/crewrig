// governance-hook-map-cases.test.ts — Replaces scripts/tests/test-check-extension-hook-map.sh
// (cases 1, 2, 4, 5, 6, 7; cases 0 and 3 stay in governance-check-extension-hook-map.test.ts).
// Spec 0265 (row J2): a sandbox copy of the entry, scripts/lib, package.json and the doc is
// mutated in memory; never the repository tree. Output is stdout + stderr concatenated.
// The Bash-side mutations of extension-hooks.sh are dropped: the TypeScript check reads
// scripts/lib/extension/hooks-vocab.ts, and the tolerance clause for the twin is gone.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { copyTracked, makeSandbox, runEntry } from "./lib/governance-sandbox.ts";

const DOC = path.join("docs", "extension-hook-events.md");
const VOCAB = path.join("scripts", "lib", "extension", "hooks-vocab.ts");
const TARGETS = path.join("scripts", "lib", "extension-targets.json");

/** A sandbox with the check, its lib closure and the doc; `mutate` edits a file in place. */
function sandbox(mutate: (edit: (rel: string, from: string | RegExp, to: string) => void) => void) {
  const root = makeSandbox("hook-map-");
  copyTracked(root, ["scripts/check-extension-hook-map.ts", "scripts/lib", "package.json", DOC]);
  mutate((rel, from, to) => {
    const file = path.join(root, rel);
    const before = fs.readFileSync(file, "utf8");
    const after = before.replace(from, to);
    assert.notEqual(after, before, `mutation of ${rel} changed nothing`);
    fs.writeFileSync(file, after);
  });
  const r = runEntry(path.join(root, "scripts", "check-extension-hook-map.ts"), { cwd: root });
  return { status: r.status, out: r.stdout + r.stderr };
}

/** Edit one top-level key of the descriptor JSON, re-serialised. */
function descriptor(root: string, target: string, field: string, value: string): void {
  const file = path.join(root, TARGETS);
  const json = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, Record<string, unknown>>;
  json[target][field] = value;
  fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
}

function withDescriptor(target: string, field: string, value: string) {
  const root = makeSandbox("hook-map-");
  copyTracked(root, ["scripts/check-extension-hook-map.ts", "scripts/lib", "package.json", DOC]);
  descriptor(root, target, field, value);
  const r = runEntry(path.join(root, "scripts", "check-extension-hook-map.ts"), { cwd: root });
  return { status: r.status, out: r.stdout + r.stderr };
}

describe("check-extension-hook-map.ts mutation cases", () => {
  test("Case 1 — a table-only mutation fails, naming the disagreeing cell", () => {
    const r = sandbox((edit) =>
      edit(DOC, "| `PreToolUse` | `PreToolUse` |", "| `PreToolUse` | `WrongEvent` |"),
    );
    assert.notEqual(r.status, 0);
    assert.ok(r.out.includes("PreToolUse"), r.out);
    assert.ok(r.out.includes("claude"), r.out);
  });

  test("Case 2 — a translator-only mutation fails, naming the disagreeing cell", () => {
    const r = sandbox((edit) =>
      edit(VOCAB, 'claude: { PreToolUse: "PreToolUse",', 'claude: { PreToolUse: "WrongEvent",'),
    );
    assert.notEqual(r.status, 0);
    assert.ok(r.out.includes("PreToolUse"), r.out);
    assert.ok(r.out.includes("claude"), r.out);
  });

  test("Case 4 — a translator-only new event with no table row fails, naming the event", () => {
    const r = sandbox((edit) =>
      edit(
        VOCAB,
        '["PreToolUse", "UserPromptSubmit"]',
        '["PreToolUse", "UserPromptSubmit", "NeverInTheTable"]',
      ),
    );
    assert.notEqual(r.status, 0);
    assert.ok(r.out.includes("NeverInTheTable"), r.out);
  });

  test("Case 5 — a descriptor-only mutation (hook file) fails the reconciliation arm", () => {
    const r = withDescriptor("antigravity", "hookFile", "somewhere-else.json");
    assert.notEqual(r.status, 0);
    assert.ok(r.out.includes("reconciliation"), r.out);
  });

  test("Case 6 — a descriptor-only mutation (time unit) fails the reconciliation arm", () => {
    const r = withDescriptor("antigravity", "timeUnit", "minutes");
    assert.notEqual(r.status, 0);
    assert.ok(r.out.includes("reconciliation"), r.out);
    assert.match(r.out, /time unit/i);
  });

  test("Case 7 — a descriptor-only mutation (root token) fails the reconciliation arm too", () => {
    const r = withDescriptor("claude", "rootToken", "${SOMETHING_ELSE}");
    assert.notEqual(r.status, 0);
    assert.ok(r.out.includes("reconciliation"), r.out);
    assert.match(r.out, /extension-root form/i);
  });
});
