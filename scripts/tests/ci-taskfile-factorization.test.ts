// Spec 0278 R22 acceptance: the `js-yaml` precondition of the `ci` Taskfile files is written once
// per file as an anchor and reused by alias, never repeated literally, and the repeated node
// prefix lives in one file variable declared in taskfiles/ci.yml.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { REPO } from "./lib/governance-sandbox.ts";

const LITERAL = "check-tool-binaries.ts js-yaml";

/** `taskfiles/ci.yml` and every file under `taskfiles/ci/`, repo-relative POSIX paths. */
function ciFiles(): string[] {
  const out = ["taskfiles/ci.yml"];
  const dir = path.join(REPO, "taskfiles", "ci");
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir).sort()) {
      if (f.endsWith(".yml")) out.push(`taskfiles/ci/${f}`);
    }
  }
  return out;
}

describe("taskfiles/ci* factorization (spec 0278 R22)", () => {
  for (const rel of ciFiles()) {
    it(`${rel} writes the js-yaml precondition at most once and aliases it`, () => {
      const text = fs.readFileSync(path.join(REPO, rel), "utf8");
      assert.ok(
        text.split(LITERAL).length - 1 <= 1,
        `${rel} repeats the '${LITERAL}' precondition literally`,
      );
      const defs = text.match(/: &needs-js-yaml\b/g)?.length ?? 0;
      assert.ok(defs <= 1, `${rel} defines the anchor more than once`);
      if (text.includes(": *needs-js-yaml")) {
        assert.equal(defs, 1, `${rel} aliases an anchor it does not define`);
      }
    });
  }

  it("taskfiles/ci.yml declares NODE_SCRIPTS once, and its value ends in /scripts", () => {
    const text = fs.readFileSync(path.join(REPO, "taskfiles/ci.yml"), "utf8");
    const decls = text.match(/^ {2}NODE_SCRIPTS:.*$/gm) ?? [];
    assert.equal(decls.length, 1);
    assert.match(decls[0] ?? "", /\{\{\.REPO_DIR\}\}\/scripts"$/);
  });
});
