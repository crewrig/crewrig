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

import { claudeGuardState, REPO } from "./lib/build-fixture-tree.ts";
import { readFrontmatter } from "./lib/build-sandbox.ts";
import { ciTaskCommands } from "./lib/ci-task-commands.ts";
import { yamlLib } from "./lib/yaml-lib.ts";
import { readReferenceText } from "./lib/ci-reference-fixtures.ts";

export const BASELINE = `architect xhigh
ci-configurator high
ci-debugger high
ci-parity high
developer high
doc-writer medium
pr-logbook medium
pr-reviewer high
security high
spec-author high
tester high`
  .split("\n")
  .map((line) => line.split(" ") as [string, string]);

const read = (rel: string): string => fs.readFileSync(path.join(REPO, rel), "utf8");
const frontOf = (rel: string): Record<string, unknown> => readFrontmatter(read(rel));
const has = (fm: Record<string, unknown>, key: string): boolean => Object.hasOwn(fm, key);
const GUIDANCE = "Run this agent on the";

// The core agents' profile grid is read from the AGENT.md sources (spec 0200 + #1937), never frozen
// here: each core source declares metadata.model.{intelligence,reasoning}. What stays literal is the
// mapping contract per rung: intelligence picks the model, reasoning becomes effort on Claude Code,
// is dropped on Gemini CLI and Copilot, and is substituted into the Antigravity model name.
const CLAUDE_MODEL: Record<string, string> = {
  medium: "haiku",
  high: "sonnet",
  xhigh: "opus",
};
const GEMINI_MODEL: Record<string, string> = {
  medium: "gemini-3.5-flash-lite",
  high: "gemini-4-hydrogen",
  xhigh: "gemini-4-argon",
};
const ANTIGRAVITY_FAMILY: Record<string, string> = {
  medium: "gemini-3.5-flash-lite",
  high: "gemini-4-hydrogen",
  xhigh: "gemini-4-argon",
};
// Antigravity encodes low, medium and high; an xhigh reasoning rung falls to the nearest lower, high.
const ANTIGRAVITY_RUNG: Record<string, string> = {
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "high",
};

type Profile = { intelligence: string; reasoning: string };
const coreNames = (): string[] =>
  fs
    .readdirSync(path.join(REPO, "artifacts/core/agents"), {
      withFileTypes: true,
    })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
const coreProfile = (name: string): Profile => {
  const model = (
    frontOf(`artifacts/core/agents/${name}/AGENT.md`).metadata as {
      model?: Partial<Profile>;
    }
  ).model;
  assert.ok(model?.intelligence && model.reasoning, `${name} declares intelligence and reasoning`);
  return { intelligence: model.intelligence, reasoning: model.reasoning };
};

describe("T1 — R36: component-drift's --check command is still wired", () => {
  test("T1 committed::component-drift wiring carries the --check invocation", () => {
    const doc = yamlLib.load(readReferenceText(REPO)) as {
      capabilities: { id: string; command?: unknown }[];
    };
    const cap = doc.capabilities.find((c) => c.id === "component-drift");
    assert.ok(cap !== undefined, "capability component-drift exists");
    const capCommands = (cap.command ?? []) as string[];
    assert.ok(Array.isArray(capCommands) && capCommands.length > 0, "command list is non-empty");
    // The capability delegates to its Taskfile task (spec 0283); the task body carries the command.
    const commands = capCommands.includes("task ci:component-drift")
      ? ciTaskCommands("component-drift")
      : capCommands;
    // Either form satisfies the wiring (spec 0250 R26); the flags stay literal.
    const form =
      /(bash scripts\/build-components\.sh|node (?:\{\{\.REPO_DIR\}\}\/)?scripts\/build-components\.ts) --target all --check/;
    assert.ok(
      commands.some((c) => form.test(c)),
      commands.join("\n"),
    );
  });
});

describe("T2 — R14,R16,R17,R18: every core source resolved on all four targets", () => {
  for (const name of coreNames()) {
    const { intelligence, reasoning } = coreProfile(name);
    const claude = CLAUDE_MODEL[intelligence] ?? "?";
    const antigravity = `${ANTIGRAVITY_FAMILY[intelligence]}-${ANTIGRAVITY_RUNG[reasoning]}`;
    // Spec 0291 R2: one carrier of the model at a time, decided by the committed guard state;
    // the reasoning rung is carried as effort on Claude Code, and by the description sentence only
    // when the guard is not directed (spec 0291 delta-02 R34).
    test(`T2 committed::${name} claude: ${claude} on the one carrier the guard directs, effort ${reasoning}, sentence iff not directed`, () => {
      const fm = frontOf(`.claude/agents/${name}.md`);
      const directed = claudeGuardState() === "directed";
      const desc = String(fm.description);
      assert.notEqual(claude, "?", `${intelligence} has a Claude model`);
      assert.equal(desc.includes(`${GUIDANCE} ${claude} model.`), !directed, desc);
      assert.equal(desc.includes(`Give its work ${reasoning} reasoning effort.`), !directed, desc);
      assert.equal(fm.model, directed ? claude : undefined);
      assert.equal(fm.effort, reasoning);
    });
    test(`T2 committed::${name} gemini: model ${GEMINI_MODEL[intelligence]}, reasoning dropped, no guidance`, () => {
      const fm = frontOf(`.gemini/agents/${name}.md`);
      assert.equal(fm.model, GEMINI_MODEL[intelligence]);
      assert.equal(has(fm, "effort"), false);
      assert.ok(!String(fm.description).includes(GUIDANCE), String(fm.description));
      assert.ok(!/reasoning effort/.test(String(fm.description)), String(fm.description));
    });
    test(`T2 committed::${name} antigravity: ${antigravity} guidance, no model`, () => {
      const fm = frontOf(`.agents/agents/${name}.md`);
      assert.ok(
        String(fm.description).includes(`${GUIDANCE} ${antigravity} model.`),
        String(fm.description),
      );
      assert.equal(has(fm, "model"), false);
      assert.equal(has(fm, "effort"), false);
    });
    test(`T2 committed::${name} copilot: no model/effort, no guidance`, () => {
      const fm = frontOf(`.github/agents/${name}.md`);
      assert.equal(has(fm, "model"), false);
      assert.equal(has(fm, "effort"), false);
      assert.ok(!String(fm.description).includes(GUIDANCE), String(fm.description));
      assert.ok(!/reasoning effort/.test(String(fm.description)), String(fm.description));
    });
  }
});

describe("T3 — R15: effort: only on Claude Code, equal to the source's reasoning rung", () => {
  const walk = (dir: string): string[] =>
    fs
      .readdirSync(dir, { withFileTypes: true })
      .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const efforts = (tree: string): Map<string, string | undefined> => {
    const files = walk(path.join(REPO, tree));
    assert.ok(files.length > 0, `${tree} holds at least one agent`);
    return new Map(
      files.map((f) => [
        path.basename(f, ".md"),
        readFrontmatter(fs.readFileSync(f, "utf8")).effort as string | undefined,
      ]),
    );
  };
  test("T3 committed::no effort frontmatter in the Gemini, Copilot and Antigravity trees", () => {
    const hits = [".gemini/agents", ".github/agents", ".agents/agents"].flatMap((tree) =>
      [...efforts(tree)].filter(([, v]) => v !== undefined).map(([n]) => `${tree}/${n}`),
    );
    assert.deepEqual(hits, []);
  });
  test("T3 committed::each Claude agent file carries effort equal to its source reasoning rung", () => {
    const got = efforts(".claude/agents");
    const bad = coreNames()
      .filter((n) => got.get(n) !== coreProfile(n).reasoning)
      .map((n) => `${n}: expected ${coreProfile(n).reasoning}, got ${String(got.get(n))}`);
    assert.deepEqual(bad, []);
  });
});

describe("T7 — R1,R2,R4: the 11-row baseline, checked over the sources", () => {
  // Spec 0313: the eleven web and SEO agents left CrewRig; the baseline holds the eleven core rows.
  const core = (name: string): string => `artifacts/core/agents/${name}/AGENT.md`;

  test("T7(a) baseline::name set equals the core listing (11)", () => {
    const actual = fs
      .readdirSync(path.join(REPO, "artifacts/core/agents"), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    assert.equal(actual.length, 11);
    assert.deepEqual(BASELINE.map(([n]) => n).sort(), actual);
  });

  // The BASELINE is the published spec 0200 migration table (checked by the baseline-doc test). The
  // core rows were re-profiled by #1937, so each core source is checked for a well-formed
  // intelligence + reasoning pair instead of a frozen rung.
  const RUNGS = ["low", "medium", "high", "xhigh"];

  test("T7(b) baseline::every core source declares an intelligence and a reasoning rung on the ladder", () => {
    assert.equal(BASELINE.length, 11);
    const bad = BASELINE.map(([n]) => n).filter((n) => {
      const m = (frontOf(core(n)).metadata as { model?: Record<string, unknown> }).model;
      return !RUNGS.includes(String(m?.intelligence)) || !RUNGS.includes(String(m?.reasoning));
    });
    assert.deepEqual(bad, []);
  });

  test("T7(c) baseline::metadata.model shape and count (12 sources)", () => {
    const files = ["core", "library"].flatMap((tier) => {
      const dir = path.join(REPO, `artifacts/${tier}/agents`);
      return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => `artifacts/${tier}/agents/${e.name}/AGENT.md`);
    });
    assert.equal(files.length, 12);
    const bad: string[] = [];
    for (const f of files) {
      const meta = (frontOf(f).metadata ?? {}) as Record<string, unknown>;
      if (!has(meta, "model")) continue;
      const keys = Object.keys(meta.model as object).join(",");
      const want = f.startsWith("artifacts/core/") ? "intelligence,reasoning" : "intelligence";
      if (keys !== want) bad.push(`${f}: keys ${keys}, expected ${want}`);
    }
    assert.deepEqual(bad, []);
  });
});

describe("T9 — #1937: the frozen oracle-agents fixture has not drifted from the 723ad8f baseline", () => {
  // The shell-oracle conformance cases read these eleven core sources, not the live ones (the live
  // profiles declare `reasoning`, which the frozen shell never knew). Closed list, baseline rungs.
  const dir = path.join(REPO, "scripts", "tests", "fixtures", "build-components", "oracle-agents");
  const names = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  const frozen = BASELINE.filter(([n]) => fs.existsSync(path.join(dir, n, "AGENT.md")));

  test("the fixture holds exactly the baseline rows that were core agents", () => {
    assert.equal(names.length, 11);
    assert.deepEqual(
      frozen.map(([n]) => n),
      names,
    );
  });
  test("each fixture source declares the baseline intelligence rung and no reasoning", () => {
    for (const [name, rung] of frozen) {
      const model = (
        readFrontmatter(fs.readFileSync(path.join(dir, name, "AGENT.md"), "utf8")).metadata as {
          model?: Record<string, unknown>;
        }
      ).model;
      assert.deepEqual(model, { intelligence: rung }, name);
    }
  });
});

describe("T8 — spec 0306 R9, R20: omitClaudeMd on the committed agent trees", () => {
  // The agent list comes from the committed sources, never from a literal count (plan v2 v1-F5).
  const core = fs
    .readdirSync(path.join(REPO, "artifacts/core/agents"), {
      withFileTypes: true,
    })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  test("T8 committed::there is at least one core agent source to check", () => {
    assert.ok(core.length > 0);
  });

  test("T8 committed::every .claude/agents/*.md carries omitClaudeMd: true in its frontmatter, once", () => {
    const bad = core.filter((name) => {
      const text = read(`.claude/agents/${name}.md`);
      const fmBlock = text.split("---\n")[1] ?? "";
      return fmBlock.split("\n").filter((l) => l === "omitClaudeMd: true").length !== 1;
    });
    assert.deepEqual(bad, []);
    for (const name of core)
      assert.strictEqual(frontOf(`.claude/agents/${name}.md`).omitClaudeMd, true, name);
  });

  test("T8 committed::no Gemini, Copilot or Antigravity agent file has an omitClaudeMd key", () => {
    const bad = ["gemini", "github", "agents"].flatMap((d) =>
      core.map((name) => `.${d}/agents/${name}.md`).filter((rel) => /omitClaudeMd/.test(read(rel))),
    );
    assert.deepEqual(bad, []);
  });
});
