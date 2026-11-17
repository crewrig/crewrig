// agent-profile-build.test.ts — the build-driven cases of the spec 0200 migration to capability
// profiles: T4 (diagnostic stream over the 22 core sources), T5 (harness-curator, the profile-less
// witness) and R40 (an unregenerated profile edit reds `--check`).
// Replaces scripts/tests/test-agent-profile-migration.sh (part), spec 0265 P1.
//
// T4 and T5 read the WORKING TREE sources; R40 reads the git blobs of HEAD (frozen behaviour of the
// former `git archive HEAD`): an uncommitted profile edit is invisible to R40. Every build runs in a
// throwaway fixture root; the checkout is never written.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import {
  claudeGuardState,
  createFixtureTree,
  REPO,
  type FixtureTree,
} from "./lib/build-fixture-tree.ts";
import { baseEnv, copyFromHead, copyFromWorktree, readFrontmatter } from "./lib/build-sandbox.ts";

process.env.GIT_CONFIG_NOSYSTEM = "1";

const NOTE = /^model-note.*claude.*guard-withheld/;
const DROP = /^model-drop.*copilot.*metadata\.model\.intelligence.*unsupported-on-cli/;
// #1937: the reasoning rung is dropped on Gemini CLI and Copilot, and encoded in the Antigravity
// model name (substituted when no exact variant exists).
const REASONING_DROP =
  /^model-drop\t[^\t]+\t(gemini|copilot)\tmetadata\.model\.reasoning\t[^\t]+\tunsupported-on-cli$/;
const RUNG_NOTE =
  /^model-note\t[^\t]+\tantigravity\treasoning-rung-substituted\tdeclared=\S+ encoded=\S+$/;
const TOOLS_DROP =
  /^tools-drop\t[^\t]+\t(antigravity|copilot|gemini)\tmetadata\.tools\t[^\t]+\tno-equivalent-on-cli$/;
const GUIDANCE = "Run this agent on the";
const CONFIG = ["crewrig.config.toml", "model-mappings"];

const stderrLines = (text: string): string[] => text.split("\n").filter((l) => l !== "");
const build = (tree: FixtureTree, ...args: string[]) =>
  tree.run(["--target", "all", ...args], { env: baseEnv() });

/** Every regular file below `dir` (absolute paths); empty when `dir` is absent. */
function filesUnder(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? filesUnder(p) : [p];
  });
}

// Spec 0307: eleven of the 22 baseline agents live under artifacts/library/agents; the throwaway root
// is still seeded with all 22 sources.
const WEB_LIBRARY_AGENTS = [
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
].map((n) => `artifacts/library/agents/${n}`);

describe("T4 — R21: diagnostic stream of a plain build, 22-source throwaway root", () => {
  const tree = createFixtureTree();
  const sources = copyFromWorktree(tree, [
    "artifacts/core/agents",
    ...WEB_LIBRARY_AGENTS,
    ...CONFIG,
  ]).filter((f) => f.endsWith("/AGENT.md"));
  const built = build(tree);

  // The stream is composed, not a constant (spec 0291 R7): 22 copilot model-drop lines, one
  // guard-withheld note per agent only while the committed guard is `withheld`, and one
  // tools-drop line per declaring source and per CLI that cannot carry a declared class (spec 0291
  // R13, R29, issue #2020): the count follows the declarations, it is not pinned to a literal.
  const declaring = sources.filter((f) => {
    const meta = (readFrontmatter(tree.read(f)).metadata ?? {}) as Record<string, unknown>;
    return Object.hasOwn(meta, "tools");
  });
  // Spec 0291 R13, R29, delta 03 R42: one antigravity line per source declaring `skill`, one copilot line when it declares
  // `skill` or `message`, one gemini line when it declares `agent` or `message`.
  // #1937: each source declaring a reasoning rung gets one gemini and one copilot reasoning drop,
  // and an antigravity substitution note when the rung is one Antigravity does not encode (#2040:
  // every rung has -low, -medium and -high variants, so only xhigh and max are substituted).
  const reasoningOf = (f: string): string | undefined =>
    (
      (readFrontmatter(tree.read(f)).metadata ?? {}) as {
        model?: { reasoning?: string };
      }
    ).model?.reasoning;
  const reasoned = sources.filter((f) => reasoningOf(f) !== undefined);
  const wantRungNotes = reasoned.filter((f) => {
    const r = reasoningOf(f);
    return r === "xhigh" || r === "max";
  }).length;
  const wantToolsDrops = declaring.reduce((n, f) => {
    const meta = (readFrontmatter(tree.read(f)).metadata ?? {}) as {
      tools?: string[];
    };
    const classes = meta.tools ?? [];
    const copilot = classes.some((c) => c === "skill" || c === "message") ? 1 : 0;
    const gemini = classes.some((c) => c === "agent" || c === "message") ? 1 : 0;
    const antigravity = classes.includes("skill") ? 1 : 0;
    return n + antigravity + copilot + gemini;
  }, 0);
  test("T4 — a plain build over the 22-source root emits 22 model-drop, the reasoning drops and rung notes the sources imply, the guard notes the committed state implies, and one tools-drop per declaring source", () => {
    assert.equal(sources.length, 22, "the root is seeded with all 22 core AGENT.md");
    assert.equal(built.status, 0, built.stderr);
    const lines = stderrLines(built.stderr);
    const notes = lines.filter((l) => NOTE.test(l));
    const drops = lines.filter((l) => DROP.test(l));
    const toolsDrops = lines.filter((l) => TOOLS_DROP.test(l));
    const reasoningDrops = lines.filter((l) => REASONING_DROP.test(l));
    const rungNotes = lines.filter((l) => RUNG_NOTE.test(l));
    const other = lines.filter(
      (l) =>
        !NOTE.test(l) &&
        !DROP.test(l) &&
        !TOOLS_DROP.test(l) &&
        !REASONING_DROP.test(l) &&
        !RUNG_NOTE.test(l),
    );
    const wantNotes = claudeGuardState() === "withheld" ? 22 : 0;
    assert.deepEqual(
      {
        total: lines.length,
        notes: notes.length,
        drops: drops.length,
        tools: toolsDrops.length,
        reasoningDrops: reasoningDrops.length,
        rungNotes: rungNotes.length,
        other,
      },
      {
        total: 22 + wantNotes + wantToolsDrops + 2 * reasoned.length + wantRungNotes,
        notes: wantNotes,
        drops: 22,
        tools: wantToolsDrops,
        reasoningDrops: 2 * reasoned.length,
        rungNotes: wantRungNotes,
        other: [],
      },
    );
  });

  test("T4 — the Antigravity tools-drop count is the 10 agents declaring skill (delta 03 R42, measured 2026-11-15)", () => {
    const agy = stderrLines(built.stderr).filter(
      (l) => TOOLS_DROP.test(l) && /\tantigravity\t/.test(l),
    );
    assert.equal(agy.length, 10);
    assert.ok(agy.every((l) => l.endsWith("\tskill\tno-equivalent-on-cli")));
  });

  test("T4 — no compiled output contains a note or a drop record", () => {
    const compiled = [".claude", ".gemini", ".github", ".agents"].flatMap((d) =>
      filesUnder(tree.resolve(d)),
    );
    assert.ok(compiled.length > 0, "the build produced compiled outputs");
    const hits = compiled.filter((f) => /model-note|model-drop/.test(fs.readFileSync(f, "utf8")));
    assert.deepEqual(hits, []);
  });
});

describe("R5 — spec 0291: an organisation re-withholds the guard", () => {
  const tree = createFixtureTree();
  const sources = copyFromWorktree(tree, [
    "artifacts/core/agents",
    ...WEB_LIBRARY_AGENTS,
    ...CONFIG,
  ]).filter((f) => f.endsWith("/AGENT.md"));
  // a replaced guard term is a whole node, so the override carries every required key
  tree.write(
    "model-mappings/claude.org.yml",
    [
      "target: claude",
      "guard:",
      "  state: withheld",
      "  terms:",
      "    - id: copilot-reader-fails-on-unserved-model",
      "      statement: A Copilot reader of .claude/agents/ fails on a model it cannot serve.",
      "      holds: true",
      "      evidence: Observed on the adopter's bring-your-own-key provider.",
      "      grounds:",
      "        - declares: holds",
      "          assumption: Observed on the adopter's bring-your-own-key provider.",
      "",
    ].join("\n"),
  );
  const built = build(tree);
  // security and seo-specialist gain `tools` and pr-reviewer loses `claude:` (spec 0291 R18-R20)
  const EDITED = new Set(["security", "seo-specialist", "pr-reviewer"]);
  // Spec 0307: the eleven moved agents are built into the gitignored dist/library staging root of the
  // throwaway tree, and only the core agents have a committed Claude file to compare with.
  const claudeFile = (name: string, f: string): string =>
    f.includes("/library/agents/")
      ? `dist/library/.claude/agents/${name}.md`
      : `.claude/agents/${name}.md`;
  const coreNames = sources
    .filter((f) => f.startsWith("artifacts/core/"))
    .map((f) => path.basename(path.dirname(f)));

  const reasoningOf = (f: string): string | undefined =>
    (
      (readFrontmatter(tree.read(f)).metadata ?? {}) as {
        model?: { reasoning?: string };
      }
    ).model?.reasoning;

  test("R5 — every Claude file has no model: key, keeps the sentence, carries its source's effort, and 22 guard-withheld notes are emitted", () => {
    assert.equal(built.status, 0, built.stderr);
    assert.equal(
      stderrLines(built.stderr).filter((l) => NOTE.test(l)).length,
      22,
      "one guard-withheld note per agent",
    );
    for (const f of sources) {
      const name = path.basename(path.dirname(f));
      const fm = readFrontmatter(tree.read(claudeFile(name, f)));
      assert.equal(Object.hasOwn(fm, "model"), false, `${name} has no model key`);
      // the model sentence stays; a declared reasoning rung adds its own sentence and the effort key
      assert.match(
        String(fm.description),
        /Run this agent on the \S+ model\.( Give its work \S+ reasoning effort\.)?$/,
        name,
      );
      assert.equal(fm.effort, reasoningOf(f), `${name} effort follows the source reasoning rung`);
    }
  });

  test("R5 — each of the 9 unedited committed core Claude files is the committed file with model: removed and the sentence restored", () => {
    const unedited = coreNames.filter((n) => !EDITED.has(n));
    assert.equal(unedited.length, 9);
    for (const name of unedited) {
      const committed = fs.readFileSync(path.join(REPO, `.claude/agents/${name}.md`), "utf8");
      const model = /^model: (\S+)$/m.exec(committed)?.[1];
      // under a committed `withheld` guard the committed file already is the pre-change form;
      // under `directed` the reasoning sentence is gone, so rebuild it from the `effort:` key
      const effort = /^effort: (\S+)$/m.exec(committed)?.[1];
      const preChange =
        model === undefined
          ? committed
          : committed
              .replace(/^model: \S+\n/m, "")
              .replace(
                /^(description: "(?:[^"\\]|\\.)*?)"/m,
                (_m, head: string) =>
                  `${head} Run this agent on the ${model} model.` +
                  `${effort === undefined ? "" : ` Give its work ${effort} reasoning effort.`}"`,
              );
      assert.equal(tree.read(`.claude/agents/${name}.md`), preChange, name);
    }
  });
});

describe("T5 — R20,R5: harness-curator stays the tree's profile-less witness", () => {
  const tree = createFixtureTree();
  const [source] = copyFromWorktree(tree, ["artifacts/library/agents/harness-curator/AGENT.md"]);
  copyFromWorktree(tree, CONFIG);
  const built = build(tree);

  test("T5 — harness-curator's source declares no metadata.model and no metadata.claude", () => {
    assert.equal(source, "artifacts/library/agents/harness-curator/AGENT.md");
    const meta = (readFrontmatter(tree.read(source ?? "")).metadata ?? {}) as object;
    assert.equal(Object.hasOwn(meta, "model"), false);
    assert.equal(Object.hasOwn(meta, "claude"), false);
  });

  test("T5 — a build seeded with harness-curator alone emits 0 model-note/model-drop lines", () => {
    assert.equal(built.status, 0, built.stderr);
    assert.deepEqual(
      stderrLines(built.stderr).filter((l) => /model-note|model-drop/.test(l)),
      [],
    );
  });

  test("T5 — harness-curator's four compiled outputs carry no model:/effort: key and no guidance prose", () => {
    const outputs = [
      "dist/library/.claude/agents/harness-curator.md",
      "dist/library/.gemini/agents/harness-curator.md",
      "dist/library/.github/agents/harness-curator.md",
      "dist/library/.agents/agents/harness-curator.md",
    ];
    for (const out of outputs) {
      assert.ok(tree.exists(out), `${out} exists`);
      const fm = readFrontmatter(tree.read(out));
      assert.equal(Object.hasOwn(fm, "model"), false, `${out} has no model key`);
      assert.equal(Object.hasOwn(fm, "effort"), false, `${out} has no effort key`);
      assert.ok(!String(fm.description ?? "").includes(GUIDANCE), `${out} has no guidance prose`);
    }
  });
});

describe("R40 mutation — a profile edit without regenerating reds component-drift's --check", () => {
  const inGit = spawnSync("git", ["rev-parse", "--git-dir"], { cwd: REPO }).status === 0;
  if (!inGit && process.env.CI) assert.fail("R40 needs a git checkout under CI");

  test(
    "R40 — component-drift's --check reds on an unregenerated profile edit, naming .claude/.gemini/.agents but not .github",
    { skip: inGit ? false : "no git checkout: R40 reads the blobs of HEAD" },
    () => {
      const tree = createFixtureTree();
      copyFromHead(tree, ["artifacts", "model-mappings", "crewrig.config.toml"]);
      copyFromHead(tree, [".claude", ".gemini", ".github", ".agents"]);
      const rel = "artifacts/core/agents/developer/AGENT.md";
      const edited = tree.read(rel).replace(/^(\s+intelligence:).*$/m, "$1 medium");
      assert.notEqual(edited, tree.read(rel), "the profile edit changed the source");
      tree.write(rel, edited);
      const res = build(tree, "--check");
      const out = `${res.stdout}\n${res.stderr}`;
      assert.notEqual(res.status, 0, out);
      for (const re of [
        /[\\/]?\.claude[\\/]agents[\\/]developer\.md differs from source/,
        /[\\/]?\.gemini[\\/]agents[\\/]developer\.md differs from source/,
        /[\\/]?\.agents[\\/]agents[\\/]developer\.md differs from source/,
      ]) {
        assert.match(out, re);
      }
      assert.doesNotMatch(out, /\.github[\\/]agents[\\/]developer\.md differs from source/);
      tree.dispose();
    },
  );
});
