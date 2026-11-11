// skill-script-citations.test.ts — the skill linter's script-citation check and the bundled
// comment-size check (spec 0289 R3, R8, R9, R11). Fixtures: fixtures/skill-scripts-citations/.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const REVIEWER_SCRIPTS = path.join(REPO, "artifacts", "core", "skills", "pr-reviewer", "scripts");
const LINT = path.join(REVIEWER_SCRIPTS, "lint-skill.ts");
const SIZE = path.join(REVIEWER_SCRIPTS, "check-comment-size.ts");
const FIXTURES = path.join(import.meta.dirname, "fixtures", "skill-scripts-citations");

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

function run(script: string, args: string[], opts: { input?: string; cwd?: string } = {}): Run {
  const res = spawnSync(process.execPath, [script, ...args], {
    cwd: opts.cwd ?? REPO,
    input: opts.input,
    encoding: "utf8",
    env: { ...process.env, BASE_REF: "HEAD" },
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

/** Only the citation and fence lines of the linter output (version/frontmatter legs excluded). */
function citationLines(out: string): string[] {
  return out.split("\n").filter((l) => /unresolved script citation|crewrig-repo-only/.test(l));
}

function lintFixture(name: string): { res: Run; lines: string[]; skill: string } {
  const skill = path.join(FIXTURES, name, "SKILL.md");
  const res = run(LINT, [skill]);
  return { res, lines: citationLines(res.stdout), skill };
}

describe("skill linter: script citations", () => {
  test("a citation that resolves inside the skill passes", () => {
    const { res, lines } = lintFixture("resolving");
    assert.deepEqual(lines, []);
    assert.equal(res.status, 0, res.stdout);
  });

  test("an unresolved unfenced citation fails naming file, line and path", () => {
    const { res, lines, skill } = lintFixture("unresolved");
    assert.equal(res.status, 1);
    assert.equal(lines.length, 1);
    assert.ok(
      lines[0]?.startsWith(`${skill}:13: unresolved script citation scripts/missing-tool.ts`),
    );
  });

  test("an unresolved fenced citation passes", () => {
    const { res, lines } = lintFixture("fenced");
    assert.deepEqual(lines, []);
    assert.equal(res.status, 0, res.stdout);
  });

  test("an unfenced citation in a references/ file fails, naming that file", () => {
    const { res, lines, skill } = lintFixture("references-unfenced");
    assert.equal(res.status, 1);
    const ref = path.join(path.dirname(skill), "references", "guide.md");
    assert.equal(lines.length, 1);
    assert.ok(lines[0]?.startsWith(`${ref}:3: unresolved script citation scripts/ghost.py`));
  });

  test("a fenced citation in a references/ file passes", () => {
    const { res, lines } = lintFixture("references-fenced");
    assert.deepEqual(lines, []);
    assert.equal(res.status, 0, res.stdout);
  });

  test("an unterminated fence fails", () => {
    const { res, lines } = lintFixture("unterminated");
    assert.equal(res.status, 1);
    assert.equal(lines.length, 1);
    assert.match(lines[0] ?? "", /:15: unterminated crewrig-repo-only fence/);
  });

  test("a stray end marker fails", () => {
    const { res, lines } = lintFixture("stray");
    assert.equal(res.status, 1);
    assert.match(lines.join("\n"), /stray crewrig-repo-only end marker/);
  });

  test("a nested start marker fails", () => {
    const { res, lines } = lintFixture("nested");
    assert.equal(res.status, 1);
    assert.match(lines.join("\n"), /nested crewrig-repo-only fence/);
  });

  test("yaml and yml code blocks are example content and are skipped", () => {
    const { res, lines } = lintFixture("yaml-example");
    assert.deepEqual(lines, []);
    assert.equal(res.status, 0, res.stdout);
  });

  test("fence markers inside a code block are ignored", () => {
    const { res, lines } = lintFixture("markers-in-code");
    assert.deepEqual(lines, []);
    assert.equal(res.status, 0, res.stdout);
  });

  test("a citation inside a non-yaml code block is still checked", () => {
    const { res, lines } = lintFixture("code-block-citation");
    assert.equal(res.status, 1);
    assert.match(lines.join("\n"), /unresolved script citation scripts\/in-code\.ts/);
  });

  test("lookalike paths are not citations, and the frontmatter is ignored", () => {
    const { res, lines } = lintFixture("lookalikes");
    assert.deepEqual(lines, []);
    assert.equal(res.status, 0, res.stdout);
  });

  test("a skill copied alone (no repository around it) is checked the same", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "citations-"));
    try {
      const lintCopy = path.join(tmp, "lint-skill.ts");
      fs.copyFileSync(LINT, lintCopy);
      const skillDir = path.join(tmp, "skill");
      fs.cpSync(path.join(FIXTURES, "unresolved"), skillDir, { recursive: true });
      const res = run(lintCopy, [path.join(skillDir, "SKILL.md")], { cwd: tmp });
      assert.equal(res.status, 1);
      assert.match(citationLines(res.stdout).join("\n"), /scripts\/missing-tool\.ts/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("every core and library skill has no citation finding (R11)", () => {
    const skills: string[] = [];
    for (const layer of ["core", "library"]) {
      const dir = path.join(REPO, "artifacts", layer, "skills");
      for (const name of fs.readdirSync(dir).sort()) {
        const skill = path.join(dir, name, "SKILL.md");
        if (fs.existsSync(skill)) skills.push(skill);
      }
    }
    assert.ok(skills.length > 10);
    const res = run(LINT, skills);
    assert.deepEqual(citationLines(res.stdout), []);
  });
});

describe("bundled comment-size check (copied alone)", () => {
  const body = (n: number): string => "x".repeat(n);

  function copied<T>(fn: (script: string, cwd: string) => T): T {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "comment-size-"));
    try {
      const script = path.join(tmp, "check-comment-size.ts");
      fs.copyFileSync(SIZE, script);
      return fn(script, tmp);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  test("a 20000-byte body fails reporting the 12288-byte budget", () => {
    copied((script, cwd) => {
      const file = path.join(cwd, "c.md");
      fs.writeFileSync(file, body(20000));
      const res = run(script, [file], { cwd });
      assert.equal(res.status, 1);
      assert.match(res.stderr, /ERROR: comment is 20000 bytes — over the 12288-byte budget\./);
    });
  });

  test("exactly 12288 bytes passes and 12289 fails", () => {
    copied((script, cwd) => {
      const ok = run(script, ["-"], { cwd, input: body(12288) });
      assert.equal(ok.status, 0);
      assert.equal(ok.stdout, "OK: 12288 bytes (budget: 12288 bytes)\n");
      const over = run(script, ["-"], { cwd, input: body(12289) });
      assert.equal(over.status, 1);
      assert.match(over.stderr, /12289 bytes/);
    });
  });

  test("the bundled file has no import", () => {
    const text = fs.readFileSync(SIZE, "utf8");
    assert.doesNotMatch(text, /^\s*import\s/m);
  });
});
