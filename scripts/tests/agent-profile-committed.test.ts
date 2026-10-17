// agent-profile-committed.test.ts — the committed tree of the spec 0200 agent-profile migration.
// Replaces scripts/tests/test-agent-profile-migration.sh (part): T1, T2 (12 cells), T3, T7(a)-(d).
//
// Every case is decidable over the committed tree, read-only; nothing is built or written.
// The BASELINE below is authoritative IN THIS FILE (spec 0200 Decision 9): the published
// table is checked against it by agent-profile-baseline-doc.test.ts, never the reverse.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { REPO } from "./lib/build-fixture-tree.ts";
import { readFrontmatter } from "./lib/build-sandbox.ts";
import { yamlLib } from "./lib/yaml-lib.ts";

export const BASELINE = `accessibility-auditor medium
accessibility-tester medium
architect xhigh
astro-developer high
ci-configurator high
ci-debugger high
ci-parity high
copywriter medium
designer high
developer high
doc-writer medium
frontend-developer high
pr-logbook medium
pr-reviewer high
regression-sentinel medium
scenario-author medium
security high
seo-specialist medium
spec-author high
tester high
visual-regression-tester medium
web-conformity-checker medium`
  .split("\n")
  .map((line) => line.split(" ") as [string, string]);

const read = (rel: string): string => fs.readFileSync(path.join(REPO, rel), "utf8");
const frontOf = (rel: string): Record<string, unknown> => readFrontmatter(read(rel));
const has = (fm: Record<string, unknown>, key: string): boolean => Object.hasOwn(fm, key);
const GUIDANCE = "Run this agent on the";

type Rung = { name: string; claude: string; gemini: string; antigravity: string };
const RUNGS: Rung[] = [
  {
    name: "doc-writer",
    claude: "haiku",
    gemini: "gemini-3.5-flash",
    antigravity: "gemini-3.8-flash-medium",
  },
  {
    name: "developer",
    claude: "sonnet",
    gemini: "gemini-3.1-pro-preview",
    antigravity: "gemini-3.1-pro-high",
  },
  {
    name: "architect",
    claude: "opus",
    gemini: "gemini-3.1-pro-preview",
    antigravity: "gemini-3.1-pro-high",
  },
];

describe("T1 — R36: component-drift's --check command is still wired", () => {
  test("T1 committed::component-drift wiring carries the --check invocation", () => {
    const doc = yamlLib.load(read("ci/ci-capabilities.yml")) as {
      capabilities: { id: string; command?: unknown }[];
    };
    const cap = doc.capabilities.find((c) => c.id === "component-drift");
    assert.ok(cap !== undefined, "capability component-drift exists");
    const commands = (cap.command ?? []) as string[];
    assert.ok(Array.isArray(commands) && commands.length > 0, "command list is non-empty");
    // Either form satisfies the wiring (spec 0250 R26); the flags stay literal.
    const form =
      /(bash scripts\/build-components\.sh|node scripts\/build-components\.ts) --target all --check/;
    assert.ok(
      commands.some((c) => form.test(c)),
      commands.join("\n"),
    );
  });
});

describe("T2 — R14,R16,R17,R18: one real committed source per rung, all four targets", () => {
  for (const r of RUNGS) {
    test(`T2 committed::rung ${r.name} claude: ${r.claude} guidance, no model/effort`, () => {
      const fm = frontOf(`.claude/agents/${r.name}.md`);
      assert.ok(
        String(fm.description).includes(`${GUIDANCE} ${r.claude} model.`),
        String(fm.description),
      );
      assert.equal(has(fm, "model"), false);
      assert.equal(has(fm, "effort"), false);
    });
    test(`T2 committed::rung ${r.name} gemini: model ${r.gemini}, no guidance`, () => {
      const fm = frontOf(`.gemini/agents/${r.name}.md`);
      assert.equal(fm.model, r.gemini);
      assert.ok(!String(fm.description).includes(GUIDANCE), String(fm.description));
    });
    test(`T2 committed::rung ${r.name} antigravity: ${r.antigravity} guidance, no model`, () => {
      const fm = frontOf(`.agents/agents/${r.name}/AGENT.md`);
      assert.ok(
        String(fm.description).includes(`${GUIDANCE} ${r.antigravity} model.`),
        String(fm.description),
      );
      assert.equal(has(fm, "model"), false);
    });
    test(`T2 committed::rung ${r.name} copilot: no model/effort, no guidance`, () => {
      const fm = frontOf(`.github/agents/${r.name}.md`);
      assert.equal(has(fm, "model"), false);
      assert.equal(has(fm, "effort"), false);
      assert.ok(!String(fm.description).includes(GUIDANCE), String(fm.description));
    });
  }
});

describe("T3 — R15: no effort: frontmatter field on any of the four agent trees", () => {
  test("T3 committed::no effort frontmatter in the four trees", () => {
    const walk = (dir: string): string[] =>
      fs
        .readdirSync(dir, { withFileTypes: true })
        .flatMap((e) =>
          e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
        );
    const hits: string[] = [];
    for (const tree of [".claude/agents", ".gemini/agents", ".github/agents", ".agents/agents"]) {
      const files = walk(path.join(REPO, tree));
      assert.ok(files.length > 0, `${tree} holds at least one agent`);
      hits.push(...files.filter((f) => /^effort:/m.test(fs.readFileSync(f, "utf8"))));
    }
    assert.deepEqual(hits, []);
  });
});

describe("T7 — R1,R2,R4: the 22-row baseline, checked four ways over the sources", () => {
  const core = (name: string): string => `artifacts/core/agents/${name}/AGENT.md`;
  const rungOf = (name: string): unknown =>
    (frontOf(core(name)).metadata as { model?: { intelligence?: unknown } } | undefined)?.model
      ?.intelligence;

  test("T7(a) baseline::name set equals artifacts/core/agents listing (22)", () => {
    const actual = fs
      .readdirSync(path.join(REPO, "artifacts/core/agents"), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    assert.equal(actual.length, 22);
    assert.deepEqual(BASELINE.map(([n]) => n).sort(), actual);
  });

  test("T7(b) baseline::rung per source equals the baseline rung", () => {
    const bad = BASELINE.filter(([n, rung]) => rungOf(n) !== rung).map(
      ([n, rung]) => `${n}: expected ${rung}, got ${String(rungOf(n))}`,
    );
    assert.deepEqual(bad, []);
  });

  test("T7(c) baseline::metadata.model shape and count (23 sources)", () => {
    const files = ["core", "library"].flatMap((tier) => {
      const dir = path.join(REPO, `artifacts/${tier}/agents`);
      return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => `artifacts/${tier}/agents/${e.name}/AGENT.md`);
    });
    assert.equal(files.length, 23);
    const bad: string[] = [];
    for (const f of files) {
      const meta = (frontOf(f).metadata ?? {}) as Record<string, unknown>;
      if (!has(meta, "model")) continue;
      const keys = Object.keys(meta.model as object).join(",");
      if (keys !== "intelligence") bad.push(`${f}: keys ${keys}`);
    }
    assert.deepEqual(bad, []);
  });

  test("T7(d) baseline::rung multiset is medium x10, high x11, xhigh x1, other 0", () => {
    const counts: Record<string, number> = {};
    for (const [n] of BASELINE) {
      const got = String(rungOf(n));
      const key = ["medium", "high", "xhigh"].includes(got) ? got : "other";
      counts[key] = (counts[key] ?? 0) + 1;
    }
    assert.deepEqual(counts, { medium: 10, high: 11, xhigh: 1 });
  });
});
