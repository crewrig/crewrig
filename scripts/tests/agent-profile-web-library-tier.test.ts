// agent-profile-web-library-tier.test.ts — spec 0307 R18: the eleven web and SEO agents and the four web
// skills live under artifacts/library/, not under artifacts/core/, not in the four committed project
// trees, and carry a MINOR-bumped metadata.provenance.version against origin/main.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { REPO } from "./lib/build-fixture-tree.ts";

const AGENTS = [
  "accessibility-auditor",
  "accessibility-tester",
  "astro-developer",
  "copywriter",
  "designer",
  "frontend-developer",
  "regression-sentinel",
  "scenario-author",
  "seo-specialist",
  "visual-regression-tester",
  "web-conformity-checker",
];
const SKILLS = ["astro", "copywriting", "frontend", "web-tester"];
const TREES = [".claude", ".gemini", ".github", ".agents"];
const BASE_REF = "origin/main";

const exists = (rel: string): boolean => fs.existsSync(path.join(REPO, rel));
const versionOf = (text: string): string | undefined =>
  /^\s+version: "(\d+\.\d+\.\d+)"/m.exec(text)?.[1];
const cmp = (a: string, b: string): number => {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
};
const gitShow = (rel: string): string | undefined => {
  try {
    return execFileSync("git", ["show", `${BASE_REF}:${rel}`], {
      cwd: REPO,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return undefined;
  }
};
const refAvailable = (): boolean => {
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", BASE_REF], {
      cwd: REPO,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
};

const COMPONENTS = [
  ...AGENTS.map((n) => ({ kind: "agents", file: "AGENT.md", name: n })),
  ...SKILLS.map((n) => ({ kind: "skills", file: "SKILL.md", name: n })),
];

describe("spec 0307 R18 — web components live in the library tier", () => {
  test("the fifteen sources are under artifacts/library and absent from artifacts/core", () => {
    for (const c of COMPONENTS) {
      assert.ok(exists(`artifacts/library/${c.kind}/${c.name}/${c.file}`), `${c.name} in library`);
      assert.equal(exists(`artifacts/core/${c.kind}/${c.name}`), false, `${c.name} not in core`);
    }
  });

  test("core keeps 11 agents and 13 skills", () => {
    const dirs = (rel: string): string[] =>
      fs
        .readdirSync(path.join(REPO, rel), { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    assert.equal(dirs("artifacts/core/agents").length, 11);
    assert.equal(dirs("artifacts/core/skills").length, 13);
  });

  test("the fifteen names are absent from the four committed project trees", () => {
    for (const tree of TREES) {
      for (const n of AGENTS)
        assert.equal(exists(`${tree}/agents/${n}.md`), false, `${tree}/agents/${n}.md`);
      for (const n of SKILLS)
        assert.equal(exists(`${tree}/skills/${n}`), false, `${tree}/skills/${n}`);
    }
  });

  test(`each library source's version is strictly greater than its core version on ${BASE_REF}`, (t) => {
    if (!refAvailable()) {
      t.skip(`named skip: base-ref-unavailable (${BASE_REF} cannot be resolved)`);
      return;
    }
    let compared = 0;
    for (const c of COMPONENTS) {
      const now = versionOf(
        fs.readFileSync(path.join(REPO, `artifacts/library/${c.kind}/${c.name}/${c.file}`), "utf8"),
      );
      assert.ok(now, `${c.name} carries a metadata.provenance.version`);
      const base = gitShow(`artifacts/core/${c.kind}/${c.name}/${c.file}`);
      if (base === undefined) continue; // already moved on the base: nothing left to bump against
      const was = versionOf(base);
      assert.ok(was, `${c.name} base version`);
      assert.ok(cmp(now, was) > 0, `${c.name}: ${now} must exceed ${was}`);
      compared++;
    }
    t.diagnostic(`compared ${compared} of ${COMPONENTS.length} against ${BASE_REF}`);
  });
});
