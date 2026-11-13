// agent-script-citations.test.ts — scripts/check-agent-script-citations.ts and its library (issue #1863,
// extending spec 0289). Includes the parity test against the bundled lint-skill.ts scanner.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

import { findCitations } from "../lib/governance/agent-script-citations.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const ENTRY = path.join(REPO, "scripts", "check-agent-script-citations.ts");
const LINT = path.join(REPO, "artifacts", "core", "skills", "pr-reviewer", "scripts", "lint-skill.ts");
const AGENT_FIXTURES = path.join(import.meta.dirname, "fixtures", "agent-script-citations");
const SKILL_FIXTURES = path.join(import.meta.dirname, "fixtures", "skill-scripts-citations");

function node(script: string, args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: REPO,
    encoding: "utf8",
    env: { ...process.env, BASE_REF: "HEAD", ...env },
  });
}

/** A throwaway repository root holding one agent fixture as artifacts/core/agents/demo/. */
function withAgent<T>(fixture: string, fn: (root: string) => T): T {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-citations-"));
  try {
    const dest = path.join(root, "artifacts", "core", "agents", "demo");
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(path.join(AGENT_FIXTURES, fixture), dest, { recursive: true });
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const check = (fixture: string) =>
  withAgent(fixture, (root) => node(ENTRY, [], { CREWRIG_REPO_DIR: root }));

describe("check-agent-script-citations", () => {
  test("an unfenced citation fails naming file, line and path", () => {
    const res = check("unfenced");
    assert.equal(res.status, 1);
    assert.match(
      res.stdout,
      /^FAIL artifacts\/core\/agents\/demo\/AGENT\.md:11: unresolved script citation scripts\/missing-tool\.ts/m,
    );
  });

  test("a fenced citation passes", () => {
    const res = check("fenced");
    assert.equal(res.status, 0, res.stdout);
  });

  test("a skill-dir-qualified path is not a citation", () => {
    assert.equal(check("skill-relative").status, 0);
  });

  test("an agent ships no scripts: a sibling scripts/ file does not resolve a citation", () => {
    const res = check("sibling-script");
    assert.equal(res.status, 1);
    assert.match(res.stdout, /scripts\/tool\.ts/);
  });

  test("an unterminated fence fails", () => {
    const res = check("unterminated");
    assert.equal(res.status, 1);
    assert.match(res.stdout, /unterminated crewrig-repo-only fence/);
  });

  test("a '..' segment is never resolved, even by a resolver that accepts everything", () => {
    const f = findCitations("see `scripts/../x.ts`\n", {
      skipFrontmatter: false,
      resolves: () => true,
    });
    assert.equal(f.length, 1);
  });

  test("every agent body in the repository passes", () => {
    const res = node(ENTRY, []);
    assert.equal(res.status, 0, res.stdout);
    assert.match(res.stdout, /^OK: /);
  });
});

describe("parity with the bundled lint-skill.ts scanner", () => {
  const fixtures = fs
    .readdirSync(SKILL_FIXTURES)
    .filter((n) => fs.existsSync(path.join(SKILL_FIXTURES, n, "SKILL.md")))
    .sort();

  test("the fixtures cover the skill cases", () => {
    assert.ok(fixtures.length >= 10, fixtures.join(","));
  });

  for (const name of fixtures) {
    test(`same findings on skill fixture ${name}`, () => {
      const dir = path.join(SKILL_FIXTURES, name);
      const refDir = path.join(dir, "references");
      const files = ["SKILL.md"].concat(
        fs.existsSync(refDir) ? fs.readdirSync(refDir).sort().map((f) => `references/${f}`) : [],
      );
      const resolves = (cited: string): boolean => {
        try {
          return fs.statSync(path.join(dir, cited)).isFile();
        } catch {
          return false;
        }
      };
      const norm = files.flatMap((rel) =>
        findCitations(fs.readFileSync(path.join(dir, rel), "latin1"), {
          skipFrontmatter: rel === "SKILL.md",
          resolves,
        }).map((f) =>
          `${rel}:${f.line}: ${f.message}`.replace(/ \(not in a crewrig-repo-only fence\)$/, ""),
        ),
      );
      const res = node(LINT, [path.join(dir, "SKILL.md")]);
      const theirs = res.stdout
        .split("\n")
        .filter((l) => /unresolved script citation|crewrig-repo-only/.test(l))
        .map((l) => l.slice(dir.length + 1).replace(/ \(not in .*$/, ""));
      assert.deepEqual(norm, theirs);
    });
  }
});

describe("no unresolvable path in the ticket's artifacts (delta R18)", () => {
  const bodies = (kind: "skills" | "agents", file: string): string[] => {
    const out: string[] = [];
    for (const layer of ["core", "library"]) {
      const dir = path.join(REPO, "artifacts", layer, kind);
      if (!fs.existsSync(dir)) continue;
      for (const name of fs.readdirSync(dir).sort()) {
        const f = path.join(dir, name, file);
        if (fs.existsSync(f)) out.push(f);
      }
    }
    return out;
  };

  test("no skill or agent body cites an artifacts/<layer>/skills/<name>/scripts/ source-tree path", () => {
    const re = /artifacts\/[a-z]+\/skills\/[A-Za-z0-9_-]+\/scripts\//;
    const hits = [...bodies("skills", "SKILL.md"), ...bodies("agents", "AGENT.md")].filter((f) =>
      re.test(fs.readFileSync(f, "utf8")),
    );
    assert.deepEqual(hits, []);
  });

  test("docs/plan-format.md cites the repository-root and the bundled comment-size check", () => {
    const doc = fs.readFileSync(path.join(REPO, "docs", "plan-format.md"), "utf8");
    assert.match(doc, /node scripts\/check-comment-size\.ts/);
    assert.match(doc, /`pr-reviewer` skill bundles the same\s+check/);
  });
});
