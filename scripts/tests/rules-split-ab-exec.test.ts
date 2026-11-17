// Tests of the executor's auth-mode fallback with a fake `claude` binary: no model call.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

import { AuthError, makeClaudeExecutor } from "../lib/rules-split-ab/exec.ts";
import { SCENARIOS } from "../lib/rules-split-ab/scenarios.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ab-exec-test-"));
const rule = path.join(tmp, "60-tools.md");
fs.writeFileSync(rule, "# tools\n");
const seen = path.join(tmp, "modes.log");
// Not logged in under a scratch HOME (the keychain is out of reach), logged in otherwise.
const claude = path.join(tmp, "claude");
fs.writeFileSync(
  claude,
  `#!/bin/sh
case "$HOME" in
  */ab-run-*) echo "scratch" >> '${seen}'
    echo '{"type":"result","subtype":"success","is_error":true,"result":"Not logged in · Please run /login","total_cost_usd":0}' ;;
  *) echo "real" >> '${seen}'
    echo '{"type":"result","subtype":"success","is_error":false,"result":"ok","total_cost_usd":0.01}' ;;
esac
`,
  { mode: 0o755 },
);
const scenario = SCENARIOS[3]!;
const req = { scenario, arm: "A" as const, runIndex: 1, attempt: 1, maxBudgetUsd: 0.6 };
const mk = (authHome?: "auto" | "scratch" | "real") =>
  makeClaudeExecutor({
    armRules: { A: [rule], B: [rule] },
    model: "m",
    outDir: fs.mkdtempSync(path.join(tmp, "out-")),
    claudeBin: claude,
    authHome,
  });
const modes = () => (fs.existsSync(seen) ? fs.readFileSync(seen, "utf8").trim().split("\n") : []);

describe("executor auth modes", () => {
  test("auto: a scratch-HOME auth failure falls back to the real HOME and stays there", async () => {
    fs.rmSync(seen, { force: true });
    const ex = mk();
    const r1 = await ex(req);
    assert.match(r1.transcript ?? "", /"result":"ok"/);
    await ex({ ...req, runIndex: 2 });
    assert.deepEqual(modes(), ["scratch", "real", "real"]);
  });

  test("scratch: an auth failure is an AuthError, with no fallback", async () => {
    fs.rmSync(seen, { force: true });
    await assert.rejects(mk("scratch")(req), AuthError);
    assert.deepEqual(modes(), ["scratch"]);
  });

  test("real: starts in the real-HOME mode directly", async () => {
    fs.rmSync(seen, { force: true });
    await mk("real")(req);
    assert.deepEqual(modes(), ["real"]);
  });
});
