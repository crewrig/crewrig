// check-claude-agent-layout.test.ts — black-box edge cases of the TypeScript twin that the
// Bash suite (now governance-agent-layout-cases.test.ts) did not cover (spec 0259).
//
// Each case builds a throwaway tree and runs scripts/check-claude-agent-layout.ts with
// CREWRIG_REPO_DIR pointed at it. A symlink offender is POSIX-only and skipped on win32.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const CHECK = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "check-claude-agent-layout.ts",
);
const roots: string[] = [];
after(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

function fixture(build: (agents: string) => void): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agent-layout-")));
  roots.push(root);
  const agents = path.join(root, ".claude", "agents");
  fs.mkdirSync(agents, { recursive: true });
  build(agents);
  return root;
}

function run(root: string): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", CHECK], {
    env: { ...process.env, CREWRIG_REPO_DIR: root },
    encoding: "utf8",
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const OK_LINE = "OK: .claude/agents/ holds only flat *.md files.\n";

describe("check-claude-agent-layout.ts", () => {
  test("an empty agents directory is legal", () => {
    const r = run(fixture(() => {}));
    assert.deepEqual([r.status, r.stdout, r.stderr], [0, OK_LINE, ""]);
  });

  test("an absent directory prints the full absolute path", () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agent-layout-")));
    roots.push(root);
    const r = run(root);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, `OK: ${root}/.claude/agents is absent — nothing to check.\n`);
  });

  test("a regular non-.md file is the only offender", () => {
    const r = run(fixture((a) => fs.writeFileSync(path.join(a, "notes.txt"), "x")));
    assert.equal(r.status, 1);
    assert.equal(r.stdout, "");
    assert.match(
      r.stderr,
      /^\nFAILED: 1 offending entr\(y\/ies\) under \.claude\/agents:\n {2}- \.claude\/agents\/notes\.txt\n\n/,
    );
  });

  test("a nested directory names itself and every file beneath it, sorted by whole path", () => {
    const r = run(
      fixture((a) => {
        fs.mkdirSync(path.join(a, "a", "deep"), { recursive: true });
        fs.writeFileSync(path.join(a, "a", "deep", "z.md"), "x");
        fs.writeFileSync(path.join(a, "a", "b.md"), "x");
        fs.writeFileSync(path.join(a, "a", "a.txt"), "x");
        fs.writeFileSync(path.join(a, "ok.md"), "x");
      }),
    );
    assert.equal(r.status, 1);
    const lines = r.stderr.split("\n").filter((l) => l.startsWith("  - "));
    assert.deepEqual(lines, [
      "  - .claude/agents/a",
      "  - .claude/agents/a/a.txt",
      "  - .claude/agents/a/b.md",
      "  - .claude/agents/a/deep/z.md",
    ]);
  });

  test("an empty nested directory is itself an offender", () => {
    const r = run(fixture((a) => fs.mkdirSync(path.join(a, "empty"))));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /FAILED: 1 offending/);
  });

  test(
    "a symlink named *.md is an offender (POSIX only)",
    { skip: process.platform === "win32" },
    () => {
      const r = run(
        fixture((a) => {
          fs.writeFileSync(path.join(a, "real.md"), "x");
          fs.symlinkSync("real.md", path.join(a, "link.md"));
        }),
      );
      assert.equal(r.status, 1);
      assert.match(r.stderr, / {2}- \.claude\/agents\/link\.md\n/);
      assert.doesNotMatch(r.stderr, /real\.md/);
    },
  );

  test(
    "a symlinked agents directory is not descended into (find semantics, POSIX only)",
    { skip: process.platform === "win32" },
    () => {
      const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agent-layout-")));
      roots.push(root);
      fs.mkdirSync(path.join(root, "elsewhere"));
      fs.writeFileSync(path.join(root, "elsewhere", "bad.txt"), "x");
      fs.mkdirSync(path.join(root, ".claude"));
      fs.symlinkSync("../elsewhere", path.join(root, ".claude", "agents"));
      const r = run(root);
      assert.deepEqual([r.status, r.stdout], [0, OK_LINE]);
    },
  );
});
