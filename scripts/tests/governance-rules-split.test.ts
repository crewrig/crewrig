// governance-rules-split.test.ts — spec 0308 R2: the byte-for-byte split check of 60-tools.md.
// The library is exercised on a synthetic base; the CLI on a temporary git repository.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  checkRulesSplit,
  N_NEW,
  N_OLD,
  OBLIGATIONS_HEADING,
  OBLIGATIONS_MAX,
} from "./../lib/governance/rules-split.ts";

const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = path.join(SCRIPTS, "check-rules-split.ts");
const tmp = mkdtempSync(path.join(tmpdir(), "rules-split-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

const W1 =
  "- **Write**: User-controlled only — MUST ask the user before writing.\n  Never write without explicit consent.";
const W2 =
  "> **MCP-only access from the agent prompt.** Never use the CLI.\n>\n> **Carve-out.** See `docs/mempalace-bundled-scripts.md`.";
const stub = (name: string) =>
  `> Moved — \`${name}.md\`. Retrieve it via the protocol ${N_OLD} (direct read).`;
const sec = (heading: string, body: string) => `\n## ${heading}\n\n${body}\n\n---\n`;
const PRE = "# Tools\n\nIntro line.\n\n---\n";
const SECTIONS: Array<[string, string, boolean]> = [
  ["Retrieving the system-context store", "Retrieval text.", false],
  ["Memory Architecture — Three-Tier Model", `Tiers.\n\n${W1}`, true],
  ["Forge Access", "Forge text.", false],
  [
    "MemPalace — Agent Memory Protocol",
    `Palace.\n\n${W2}\n\n${stub("a")}\n\n${stub("b")}\n\n${stub("c")}`,
    true,
  ],
  ["Friction Reporting — Harness Feedback Loop", `Friction.\n\n${stub("f")}`, false],
  ["Sequential Thinking — Working Memory Protocol", "Think.", true],
  ["Second Brain — Obsidian Protocol", stub("o"), true],
  ["Memory Activation Summary", "Summary.", true],
  ["Idiomatic French", "French.", false],
];
const BASE = PRE + SECTIONS.map(([h, b]) => sec(h, b)).join("");
const P_TOOLS = "\nThe orchestrator memory protocol lives in `60-memory.md`.\n";
const OBLIGATIONS = `\n## ${OBLIGATIONS_HEADING}\n\nPointer to 60-memory.md.\n\n${W1}\n\n${W2}\n\n---\n`;
const P_MEM = "# Memory Protocol\n\nMoved verbatim from `60-tools.md`.\n";

function split(base: string): { tools: string; memory: string } {
  const swap = (s: string) => s.split(N_OLD).join(N_NEW);
  const kept = SECTIONS.filter((s) => !s[2])
    .map(([h, b]) => sec(h, b))
    .join("");
  const moved = SECTIONS.filter((s) => s[2])
    .map(([h, b]) => sec(h, swap(b)))
    .join("");
  void base;
  const pre = `# Tools\n\nIntro line.\n${P_TOOLS}\n---\n`;
  return { tools: injectObligations(pre + kept), memory: P_MEM + moved };
}

/** The obligations section sits right after the first kept section, as in the real file. */
function injectObligations(tools: string): string {
  const i = tools.indexOf("\n## Forge Access");
  return tools.slice(0, i) + OBLIGATIONS + tools.slice(i);
}

describe("checkRulesSplit (library)", () => {
  const good = split(BASE);
  it("passes on a faithful split", () => {
    assert.deepEqual(checkRulesSplit(BASE, good.tools, good.memory), []);
  });
  it("names the section of an edited byte", () => {
    const f = checkRulesSplit(BASE, good.tools, good.memory.replace("Think.", "Thunk."));
    assert.ok(
      f.some((l) => l.includes('FAIL section "Sequential Thinking')),
      f.join("\n"),
    );
  });
  it("names a dropped section", () => {
    const f = checkRulesSplit(
      BASE,
      good.tools,
      good.memory.replace(/\n## Memory Activation Summary[\s\S]*$/, ""),
    );
    assert.ok(
      f.some((l) => l.includes('FAIL section "Memory Activation Summary')),
      f.join("\n"),
    );
  });
  it("names a section left in the wrong file", () => {
    const tools = good.tools + sec("Memory Activation Summary", "Summary.");
    const f = checkRulesSplit(BASE, tools, good.memory);
    assert.ok(
      f.some((l) => l.includes('FAIL section "Memory Activation Summary')),
      f.join("\n"),
    );
  });
  it("fails when N is applied to the stub that stays in 60-tools.md", () => {
    const tools = good.tools.replace(N_OLD, N_NEW);
    const memory = good.memory.replace(N_NEW, N_OLD);
    assert.notEqual(checkRulesSplit(BASE, tools, memory).length, 0);
  });
  it("fails on an extra N occurrence", () => {
    const memory = good.memory.replace("Tiers.", `Tiers ${N_NEW}.`);
    assert.notEqual(checkRulesSplit(BASE, good.tools, memory).length, 0);
  });
  it("fails when a pointer exceeds 250 bytes", () => {
    const memory = good.memory.replace("verbatim", "verbatim " + "x".repeat(260));
    assert.ok(checkRulesSplit(BASE, good.tools, memory).some((l) => l.includes("250")));
  });
  it("fails when both pointers exceed 450 bytes", () => {
    const tools = good.tools.replace("memory protocol", "memory protocol " + "y".repeat(200));
    const memory = good.memory.replace("verbatim", "verbatim " + "x".repeat(200));
    assert.ok(checkRulesSplit(BASE, tools, memory).some((l) => l.includes("450")));
  });
  it("fails when the obligations section is missing", () => {
    const tools = good.tools.replace(OBLIGATIONS, "");
    const f = checkRulesSplit(BASE, tools, good.memory);
    assert.ok(
      f.some((l) => l.includes(`FAIL section "${OBLIGATIONS_HEADING}"`)),
      f.join("\n"),
    );
  });
  it("fails when the obligations section appears twice", () => {
    assert.notEqual(checkRulesSplit(BASE, injectObligations(good.tools), good.memory).length, 0);
  });
  it("fails when the W1 copy differs from the original in 60-memory.md", () => {
    const tools = good.tools.replace(
      "Never write without explicit consent.",
      "Never write without consent.",
    );
    const f = checkRulesSplit(BASE, tools, good.memory);
    assert.ok(
      f.some((l) => l.includes("W1 differs")),
      f.join("\n"),
    );
  });
  it("fails when the W2 copy differs from the original in 60-memory.md", () => {
    const tools = good.tools.replace("Never use the CLI.", "Use the CLI.");
    const f = checkRulesSplit(BASE, tools, good.memory);
    assert.ok(
      f.some((l) => l.includes("W2 differs")),
      f.join("\n"),
    );
  });
  it("fails when the obligations section exceeds its ceiling", () => {
    const big = OBLIGATIONS.replace("Pointer", "x".repeat(OBLIGATIONS_MAX) + " Pointer");
    const tools = good.tools.replace(OBLIGATIONS, big);
    assert.ok(
      checkRulesSplit(BASE, tools, good.memory).some((l) => l.includes(`${OBLIGATIONS_MAX} B`)),
    );
  });
  it("fails when 60-memory.md ends in a blank line after the last separator", () => {
    assert.notEqual(checkRulesSplit(BASE, good.tools, good.memory + "\n").length, 0);
  });
});

describe("check-rules-split CLI", () => {
  const git = (cwd: string, ...a: string[]) =>
    spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], {
      cwd,
      encoding: "utf8",
    });
  const repo = path.join(tmp, "repo");
  const dir = path.join(repo, "artifacts", "core", "rules");
  mkdirSync(dir, { recursive: true });
  git(repo, "init", "-q");
  writeFileSync(path.join(dir, "60-tools.md"), BASE);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "base");
  const run = (...a: string[]) =>
    spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", ENTRY, ...a], {
      cwd: repo,
      encoding: "utf8",
    });
  const good = split(BASE);
  it("exits 2 without --base", () => {
    assert.equal(run().status, 2);
  });
  it("exits 0 on a match", () => {
    writeFileSync(path.join(dir, "60-tools.md"), good.tools);
    writeFileSync(path.join(dir, "60-memory.md"), good.memory);
    const r = run("--base", "HEAD");
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });
  it("exits 1 naming the section on an edit", () => {
    writeFileSync(path.join(dir, "60-memory.md"), good.memory.replace("Think.", "Thunk."));
    const r = run("--base", "HEAD");
    assert.equal(r.status, 1);
    assert.match(r.stdout, /FAIL section "Sequential Thinking/);
  });
});

describe("real rules size ceiling (spec 0308 R6 and the #1990 owner decision)", () => {
  // Spec R6 ceiling 24,686 + 450 (pointers) + 8 (N) + 30 (title) = 25,174 B, plus the
  // obligations section, itself bounded by OBLIGATIONS_MAX: 25,174 + 1,600 = 26,774 B.
  const CEILING = 25_174 + OBLIGATIONS_MAX;
  it(`60-tools.md plus 60-memory.md stay within ${CEILING} B`, () => {
    const dir = path.resolve(SCRIPTS, "..", "artifacts", "core", "rules");
    const total = ["60-tools.md", "60-memory.md"]
      .map((f) => readFileSync(path.join(dir, f)).length)
      .reduce((a, b) => a + b, 0);
    assert.ok(total <= CEILING, `${total} B above ${CEILING} B`);
  });
});
