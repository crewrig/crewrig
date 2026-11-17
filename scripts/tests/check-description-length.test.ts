// check-description-length.test.ts — spec 0293 R2 (amending spec 0269 R11): the 1,024-character description cap,
// end to end against a throwaway repository root (CREWRIG_REPO_DIR).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { REPO } from "./lib/build-fixture-tree.ts";

const ENTRY = path.join(REPO, "scripts", "check-description-length.ts");
const roots: string[] = [];

function rootWith(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "desc-len-"));
  roots.push(dir);
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}
after(() => {
  for (const dir of roots) fs.rmSync(dir, { recursive: true, force: true });
});

const skill = (description: string): string =>
  `---\nname: x\ndescription: ${description}\n---\n\nbody\n`;

function run(dir: string) {
  return spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", ENTRY], {
    encoding: "utf8",
    env: { ...process.env, CREWRIG_REPO_DIR: dir },
  });
}

describe("check-description-length", () => {
  test("exactly 1024 characters passes", () => {
    const res = run(rootWith({ "artifacts/core/skills/x/SKILL.md": skill("a".repeat(1024)) }));
    assert.equal(res.status, 0, res.stdout + res.stderr);
  });

  test("1025 characters fails on a source and names file and length", () => {
    const res = run(rootWith({ "artifacts/core/skills/x/SKILL.md": skill("a".repeat(1025)) }));
    assert.equal(res.status, 1);
    assert.match(
      res.stdout,
      /FAIL artifacts\/core\/skills\/x\/SKILL\.md — description 1025 chars \(max 1024\)/,
    );
  });

  test("a folded multi-line description is measured as the parsed string", () => {
    const folded = `>-\n  ${"word ".repeat(210)}`;
    const res = run(rootWith({ "artifacts/core/agents/y/AGENT.md": skill(folded) }));
    assert.equal(res.status, 1);
    assert.match(res.stdout, /AGENT\.md — description 1049 chars/);
  });

  test("a compiled output over the cap fails whatever its source says", () => {
    const res = run(
      rootWith({
        "artifacts/core/skills/x/SKILL.md": skill("short"),
        ".claude/skills/x/SKILL.md": skill("b".repeat(1100)),
        ".gemini/agents/x.md": skill("c".repeat(1100)),
      }),
    );
    assert.equal(res.status, 1);
    assert.match(res.stdout, /FAIL \.claude\/skills\/x\/SKILL\.md/);
    assert.match(res.stdout, /FAIL \.gemini\/agents\/x\.md/);
  });

  test("over-cap .agents/agents/x.md fails (spec 0053 delta-01 R22)", () => {
    const res = run(
      rootWith({
        "artifacts/core/skills/x/SKILL.md": skill("short"),
        ".agents/agents/x.md": skill("d".repeat(1100)),
      }),
    );
    assert.equal(res.status, 1);
    assert.match(res.stdout, /FAIL \.agents\/agents\/x\.md/);
  });

  test("the real tree is within the cap", () => {
    const res = run(REPO);
    assert.equal(res.status, 0, res.stdout + res.stderr);
  });
});
