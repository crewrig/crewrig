// governance-agent-layout-cases.test.ts — Replaces scripts/tests/test-check-claude-agent-layout.sh
// (cases a, d, g, h, i; b, c, e, f stay in governance-check-claude-agent-layout.test.ts).
// Spec 0265 (row J2): black-box on scripts/check-claude-agent-layout.ts with
// CREWRIG_REPO_DIR pointed at a sandbox tree. Symlink offenders are POSIX-only.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { copyTracked, makeSandbox, REPO, runEntry } from "./lib/governance-sandbox.ts";

const ENTRY = path.join(REPO, "scripts", "check-claude-agent-layout.ts");
const OK_LINE = "OK: .claude/agents/ holds only flat *.md files.\n";
const POSIX = { skip: process.platform === "win32" };

/** A sandbox root whose `.claude/agents` is filled by `build`. */
function tree(build: (agents: string) => void): string {
  const root = makeSandbox("agent-layout-");
  const agents = path.join(root, ".claude", "agents");
  fs.mkdirSync(agents, { recursive: true });
  build(agents);
  return root;
}

const check = (root: string, entry = ENTRY) => runEntry(entry, { env: { CREWRIG_REPO_DIR: root } });
const write = (dir: string, rel: string, text = "content"): void => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};
/** Case d's fixture: a flat developer.md plus a re-created developer/AGENT.md. */
const nested = (): string =>
  tree((a) => {
    write(a, "developer.md");
    write(a, "developer/AGENT.md", "old");
  });

describe("check-claude-agent-layout.ts cases", () => {
  test("case-a: a flat-only fixture is clean (exit 0, the OK line)", () => {
    const r = check(
      tree((a) => {
        write(a, "developer.md");
        write(a, "architect.md");
      }),
    );
    assert.deepEqual([r.status, r.stdout, r.stderr], [0, OK_LINE, ""]);
  });

  test("case-d: a re-created nested directory names the directory and the file", () => {
    const r = check(nested());
    assert.notEqual(r.status, 0);
    assert.ok(r.stderr.includes(".claude/agents/developer"), r.stderr);
    assert.ok(r.stderr.includes(".claude/agents/developer/AGENT.md"), r.stderr);
  });

  test("case-g: three offenders at once are all named", POSIX, () => {
    const r = check(
      tree((a) => {
        write(a, "developer.md");
        write(a, "nested-dir/AGENT.md", "x");
        write(a, "bad.txt", "x");
        fs.symlinkSync("bad.txt", path.join(a, "link.md"));
      }),
    );
    assert.notEqual(r.status, 0);
    for (const name of ["nested-dir", "bad.txt", "link.md"]) {
      assert.ok(r.stderr.includes(`.claude/agents/${name}`), `${name}: ${r.stderr}`);
    }
  });

  test("case-h: the real repository tree is clean (criterion A4)", () => {
    const r = check(REPO);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });

  test("case-i: a mutant of the TypeScript twin accepts the nested fixture the shipped guard rejects", () => {
    const module = "scripts/lib/governance/agent-layout.ts";
    const original = fs.readFileSync(path.join(REPO, module), "utf8");
    const mutated = original.replace(
      "if (legal) continue;",
      "if (legal) continue;\n    if (followsToDirectory(entry)) continue;",
    );
    assert.notEqual(mutated, original, "the mutation must change the module");

    const box = makeSandbox("agent-layout-mutant-");
    copyTracked(box, [
      "scripts/check-claude-agent-layout.ts",
      "scripts/lib/governance",
      "scripts/lib/node-floor-guard.js",
      "package.json",
    ]);
    fs.writeFileSync(path.join(box, module), mutated);

    const root = nested();
    assert.notEqual(check(root).status, 0, "the shipped guard rejects the nested fixture");
    const mutant = check(root, path.join(box, "scripts", "check-claude-agent-layout.ts"));
    assert.equal(mutant.status, 0, mutant.stderr);
  });
});
