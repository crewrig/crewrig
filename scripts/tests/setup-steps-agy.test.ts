// setup-steps-agy.test.ts — the registered steps of steps-agy.ts: migrate-superseded,
// system-context-file, legacy-context-cleanup and the mcp-prepare delegation, against the goldens
// antigravity-superseded-migration, legacy-gemini-md-* of antigravity and gemini.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { agySteps } from "../lib/setup/steps-agy.ts";
import { descriptor, run, sandbox, useSandbox } from "./setup-flow-fixtures.ts";
import { exists, golden, printed, put, read, slice } from "./setup-steps-agy-fixtures.ts";

useSandbox();

const MARK = "<!-- crewrig-section: 00_SOUL.md -->";
const SKILL = (body: string): string =>
  `---\nname: pin-skill\nmetadata:\n  provenance:\n    canonical: https://example.test/x\n---\n${body}\n`;

describe("migrate-superseded", () => {
  test("removes a framework component left at the superseded placement (golden antigravity-superseded-migration)", async () => {
    put("artifacts/library/skills/pin-skill/SKILL.md", SKILL("body"));
    put(".gemini/antigravity-cli/skills/pin-skill/SKILL.md", SKILL("old"));
    const result = await run(descriptor(["migrate-superseded"], "antigravity"), agySteps);
    const want = slice(
      golden("antigravity", "antigravity-superseded-migration", "stdout.golden"),
      "Migrating components left",
      "  Session recording disabled",
    );
    assert.equal(printed(result.out), want);
    assert.equal(result.status, 0);
    assert.equal(exists(".gemini/antigravity-cli/skills/pin-skill"), false);
  });

  test("announces and prints the blank line when nothing is left", async () => {
    put("artifacts/library/skills/pin-skill/SKILL.md", SKILL("body"));
    const result = await run(descriptor(["migrate-superseded"], "antigravity"), agySteps);
    assert.match(result.out, /^Migrating components left at the superseded placement\.\.\.\n/);
    assert.equal(result.out.endsWith("\n\n"), true);
  });
});

describe("system-context-file", () => {
  const agyRun = (): ReturnType<typeof run> =>
    run(descriptor(["system-context-file"], "antigravity"), agySteps);
  const home = ".gemini/antigravity-cli";

  test("concatenates the context files in order with the section headers, tmp then rename", async () => {
    put(`${home}/50_USER_TEAM.md`, "team\n");
    put(`${home}/00_SOUL.md`, "soul\n");
    put(`${home}/notes.md`, "ignored\n");
    put(`${home}/7_BAD.md`, "ignored\n");
    const result = await agyRun();
    const target = path.join(sandbox.tmp, ".gemini/config/AGENTS.md");
    assert.equal(
      read(".gemini/config/AGENTS.md"),
      `${MARK}\n\nsoul\n\n<!-- crewrig-section: 50_USER_TEAM.md -->\n\nteam\n\n`,
    );
    assert.equal(exists(".gemini/config/AGENTS.md.tmp"), false);
    assert.equal(result.out, `\nGenerating ${target}...\n  Generated: ${target} (8 lines)\n\n`);
  });

  test("prints the shell's line and writes nothing when no context file exists", async () => {
    fs.mkdirSync(path.join(sandbox.tmp, home), { recursive: true });
    const result = await agyRun();
    const target = path.join(sandbox.tmp, ".gemini/config/AGENTS.md");
    assert.equal(
      result.out,
      `\nGenerating ${target}...\n  No context files found in ${path.join(sandbox.tmp, home)} — ${target} not written.\n\n`,
    );
    assert.equal(exists(".gemini/config/AGENTS.md"), false);
  });

  test("records the line count in the flow state", async () => {
    put(`${home}/00_SOUL.md`, "a\nb\n");
    let lines = -1;
    await run(descriptor(["system-context-file", "summary"], "antigravity"), {
      ...agySteps,
      summary: async ({ state }) => void (lines = state.agentsMdLines),
    });
    assert.equal(lines, 5);
  });

  test("removes a marked legacy GEMINI.md and prints the notice and a blank (golden legacy-gemini-md-with-marker)", async () => {
    put(`${home}/00_SOUL.md`, "soul\n");
    put(".gemini/GEMINI.md", `${MARK}\n\nlegacy\n`);
    const result = await agyRun();
    const want = slice(
      golden("antigravity", "legacy-gemini-md-with-marker", "stdout.golden"),
      "  Removed superseded context file",
      "====",
    );
    assert.equal(result.out.endsWith(want), true);
    assert.equal(exists(".gemini/GEMINI.md"), false);
  });

  test("keeps an unmarked legacy GEMINI.md (golden legacy-gemini-md-without-marker)", async () => {
    put(`${home}/00_SOUL.md`, "soul\n");
    put(".gemini/GEMINI.md", "operator-owned notes\n");
    const result = await agyRun();
    assert.doesNotMatch(result.out, /Removed superseded/);
    assert.equal(read(".gemini/GEMINI.md"), "operator-owned notes\n");
    assert.match(
      golden("antigravity", "legacy-gemini-md-without-marker", "stdout.golden"),
      /Generated: .*AGENTS\.md \(\d+ lines\)\n\n====/,
    );
  });

  test("an unwritable AGENTS.md directory fails closed with one Error line and exit 1", async () => {
    put(`${home}/00_SOUL.md`, "soul\n");
    put(".gemini/config", "a file, not a directory\n");
    const result = await agyRun();
    assert.equal(result.status, 1);
    assert.match(result.err, /^Error: cannot write .*AGENTS\.md: .+\n$/);
  });
});

describe("legacy-context-cleanup", () => {
  test("gemini: removes a marked GEMINI.md with no trailing blank (golden legacy-gemini-md-marker)", async () => {
    put(".gemini/GEMINI.md", `${MARK}\n\nlegacy\n`);
    const result = await run(descriptor(["legacy-context-cleanup"], "gemini"), agySteps);
    const want = golden("gemini", "legacy-gemini-md-marker", "stdout.golden")
      .split("\n")
      .find((l) => l.startsWith("  Removed superseded context file"));
    assert.equal(result.out, `${want}\n`);
    assert.equal(exists(".gemini/GEMINI.md"), false);
  });

  test("gemini: keeps an unmarked GEMINI.md and prints nothing (golden legacy-gemini-md-no-marker)", async () => {
    put(".gemini/GEMINI.md", "mine\n");
    const result = await run(descriptor(["legacy-context-cleanup"], "gemini"), agySteps);
    assert.equal(result.out, "");
    assert.equal(read(".gemini/GEMINI.md"), "mine\n");
  });

  test("gemini: no file, no output; antigravity: the notice is followed by a blank line", async () => {
    assert.equal((await run(descriptor(["legacy-context-cleanup"], "gemini"), agySteps)).out, "");
    put(".gemini/GEMINI.md", `${MARK}\nx\n`);
    const agy = await run(descriptor(["legacy-context-cleanup"], "antigravity"), agySteps);
    assert.match(agy.out, /^ {2}Removed superseded context file: .*GEMINI\.md\n\n$/);
  });
});

describe("mcp-prepare", () => {
  test("delegates to prepare() of mcp-agy-step.ts, and fails loudly while that module is absent", async () => {
    if (fs.existsSync(new URL("../lib/setup/mcp-agy-step.ts", import.meta.url))) return;
    await assert.rejects(
      run(descriptor(["mcp-prepare"], "antigravity"), agySteps),
      /Cannot find module|mcp-agy-step/,
    );
  });
});
