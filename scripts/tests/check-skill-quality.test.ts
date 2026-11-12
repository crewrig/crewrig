// check-skill-quality.test.ts — spec 0293 R3, R7 to R10, R12, R17, R18, R20, R21, R22: the
// skill linter end to end against throwaway repository roots (CREWRIG_REPO_DIR).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { REPO } from "./lib/build-fixture-tree.ts";

const ENTRY = path.join(REPO, "scripts", "check-skill-quality.ts");
const roots: string[] = [];
after(() => {
  for (const dir of roots) fs.rmSync(dir, { recursive: true, force: true });
});

const DESC = "Does a thing for a team. Use when a change needs the thing done, or when asked to thing. Not for other work.";
const front = (over: Record<string, string> = {}): string => {
  const f: Record<string, string> = {
    name: "x",
    description: JSON.stringify(DESC),
    compatibility: JSON.stringify("Requires Node.js 24."),
    ...over,
  };
  return `---\n${Object.entries(f).filter(([, v]) => v !== "").map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n`;
};
const probes = (n: number, positive: number) =>
  Array.from({ length: n }, (_, i) => ({ query: `q${i}`, should_trigger: i < positive }));
const evalsJson = (nEvals = 3, probe = probes(6, 3)): string =>
  JSON.stringify({
    skill_name: "x",
    evals: Array.from({ length: nEvals }, (_, i) => ({ id: i + 1, prompt: "p", expected_output: "o", files: [], expectations: ["e"] })),
    trigger_probes: probe,
  });

/** A root with one skill `x`; `files` are paths relative to the skill directory. */
function root(files: Record<string, string>, skillName = "x"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-quality-"));
  roots.push(dir);
  const all = { "SKILL.md": `${front()}\nBody.\n`, ...files };
  for (const [rel, text] of Object.entries(all)) {
    const p = path.join(dir, "artifacts", "core", "skills", skillName, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  }
  return dir;
}

function run(dir: string, args: string[] = []) {
  return spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", ENTRY, ...args], {
    encoding: "utf8",
    env: { ...process.env, CREWRIG_REPO_DIR: dir },
  });
}
const rules = (dir: string, args: string[] = []): Map<string, string> => {
  const res = run(dir, ["--json", ...args]);
  const m = new Map<string, string>();
  for (const f of JSON.parse(res.stdout).findings) m.set(f.rule, f.severity);
  return m;
};
const protectedFiles = { "evals/evals.json": evalsJson() };

describe("severity (R18)", () => {
  test("a compliant protected skill passes", () => {
    const res = run(root(protectedFiles));
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /0 error\(s\), 0 warning\(s\)/);
  });

  test("a protected skill without a Use when clause is an error and exits 1", () => {
    const dir = root({ ...protectedFiles, "SKILL.md": `${front({ description: '"Does a thing for a team."' })}\nBody.\n` });
    const res = run(dir);
    assert.equal(res.status, 1);
    assert.match(res.stdout, /ERROR .*SKILL\.md \[description-use-when\]/);
  });

  test("the same defect on an unprotected skill is a warning and exits 0; --strict makes it exit 1", () => {
    const dir = root({ "SKILL.md": `${front({ description: '"Does a thing for a team."' })}\nBody.\n` });
    assert.equal(rules(dir).get("description-use-when"), "warning");
    assert.equal(run(dir).status, 0);
    assert.equal(rules(dir, ["--strict"]).get("description-use-when"), "error");
    assert.equal(run(dir, ["--strict"]).status, 1);
  });

  test("missing evals is a warning even under the rules of a protected skill; invalid evals is an error", () => {
    assert.equal(rules(root({})).get("evals-missing"), "warning");
    const bad = rules(root({ "evals/evals.json": "{not json" }));
    assert.equal(bad.get("evals-invalid"), "error");
  });

  test("the description cap is an error even on an unprotected skill", () => {
    const dir = root({ "SKILL.md": `${front({ description: JSON.stringify(`Use when x. ${"a".repeat(1100)}`) })}\nBody.\n` });
    assert.equal(rules(dir).get("description-length"), "error");
    assert.equal(run(dir).status, 1);
  });
});

describe("rules (R3, R7 to R10, R12)", () => {
  const cases: [string, Record<string, string>, string][] = [
    ["name must equal the directory", { "SKILL.md": `${front({ name: "y" })}\nBody.\n` }, "name"],
    ["name format", { "SKILL.md": `${front({ name: "Bad_Name" })}\nBody.\n` }, "name"],
    ["a first-person description", { "SKILL.md": `${front({ description: JSON.stringify("I do a thing. Use when asked.") })}\nBody.\n` }, "description-person"],
    ["a second-person description", { "SKILL.md": `${front({ description: JSON.stringify("Helps you. Use when asked.") })}\nBody.\n` }, "description-person"],
    ["compatibility is required", { "SKILL.md": `${front({ compatibility: "" })}\nBody.\n` }, "compatibility"],
    ["a body over 500 lines", { "SKILL.md": `${front()}${"line\n".repeat(500)}` }, "body-length"],
    ["more than five emphasis words", { "SKILL.md": `${front()}${"You MUST. ".repeat(6)}\n` }, "prompt-emphasis"],
    ["a bare issue number", { "SKILL.md": `${front()}\nSee #1234 for why.\n` }, "prompt-citation"],
    ["a spec citation", { "SKILL.md": `${front()}\nPer spec 0080 this holds.\n` }, "prompt-citation"],
    ["a requirement citation", { "SKILL.md": `${front()}\nThis is R14 of it.\n` }, "prompt-citation"],
    ["a cited reference that is missing", { "SKILL.md": `${front()}\nRead \`references/missing.md\`.\n` }, "citation-unresolved"],
    ["a cited script that is missing", { "SKILL.md": `${front()}\nRun \`scripts/gone.ts\`.\n` }, "citation-unresolved"],
    ["a reference citing another reference", { "SKILL.md": `${front()}\nRead \`references/a.md\`.\n`, "references/a.md": "See `references/b.md`.\n", "references/b.md": "b\n" }, "reference-depth"],
    ["a long reference without a table of contents", { "SKILL.md": `${front()}\nRead \`references/a.md\`.\n`, "references/a.md": "# A\n" + "text\n".repeat(120) }, "reference-toc"],
    ["fewer than three evals", { "evals/evals.json": evalsJson(2) }, "evals-minimum"],
    ["fewer than five probes", { "evals/evals.json": evalsJson(3, probes(4, 2)) }, "evals-minimum"],
    ["lopsided probes", { "evals/evals.json": evalsJson(3, probes(6, 5)) }, "evals-minimum"],
    ["a script that does not answer --help", { "scripts/bad.ts": "process.exit(1);\n" }, "script-help"],
    ["a script that prints nothing on --help", { "scripts/mute.ts": "// nothing\n" }, "script-help"],
  ];
  for (const [title, files, rule] of cases)
    test(`${title} is reported as ${rule}`, () => {
      assert.ok(rules(root({ ...protectedFiles, ...files })).has(rule), title);
    });

  const passing: [string, Record<string, string>][] = [
    ["exactly five probes, two positive and three negative", { "evals/evals.json": evalsJson(3, probes(5, 2)) }],
    ["a short number sign and a placeholder", { "SKILL.md": `${front()}\nExample: "Task #2 for #N".\n` }],
    ["a citation inside a code span still resolves", { "SKILL.md": `${front()}\nRun \`scripts/ok.ts\`.\n`, "scripts/ok.ts": "console.log('usage: ok');\n" }],
    ["a placeholder script path", { "SKILL.md": `${front()}\nRun \`scripts/<name>.ts\`.\n` }],
    ["a long reference with a table of contents", { "SKILL.md": `${front()}\nRead \`references/a.md\`.\n`, "references/a.md": "# A\n\n## Contents\n\n" + "text\n".repeat(120) }],
    ["emphasis words inside a code fence", { "SKILL.md": `${front()}\n\`\`\`\n${"MUST ".repeat(9)}\n\`\`\`\n` }],
    ["a runtime issue number in a yaml fence", { "SKILL.md": `${front()}\n\`\`\`yaml\nx: #12345\n\`\`\`\n` }],
  ];
  for (const [title, files] of passing)
    test(`${title} passes`, () => {
      const res = run(root({ ...protectedFiles, ...files }));
      assert.equal(res.status, 0, res.stdout + res.stderr);
    });

  test("a shared reference citation resolves when its source exists and not otherwise (R12)", () => {
    const dir = root({ ...protectedFiles, "SKILL.md": `${front()}\nSee \`references/shared-friction-reporting.md\`.\n` });
    assert.ok(rules(dir).has("citation-unresolved"));
    const src = path.join(dir, "artifacts", "core", "shared", "references", "friction-reporting.md");
    fs.mkdirSync(path.dirname(src), { recursive: true });
    fs.writeFileSync(src, "# Friction\n");
    assert.equal(run(dir).status, 0);
  });
});

describe("the script contract (R5, R17)", () => {
  test("--help prints the usage on stdout and exits 0", () => {
    const res = run(root({}), ["--help"]);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /Usage: check-skill-quality\.ts/);
  });

  test("--json prints one {ok, data, findings} object on stdout and human text on stderr", () => {
    const res = run(root({ "evals/evals.json": "{not json" }), ["--json"]);
    const out = JSON.parse(res.stdout) as { ok: boolean; data: { errors: number }; findings: { rule: string; message: string }[] };
    assert.equal(out.ok, false);
    assert.equal(res.status, 1);
    assert.ok(out.data.errors >= 1);
    assert.ok(out.findings.every((f) => f.rule !== "" && f.message !== ""));
    assert.match(res.stderr, /ERROR/);
  });

  test("an unknown option and an unknown skill exit 2, with ok false and no data under --json", () => {
    for (const args of [["--bogus"], ["nope"]]) {
      const res = run(root({}), [...args, "--json"]);
      assert.equal(res.status, 2, args.join(" "));
      const out = JSON.parse(res.stdout);
      assert.equal(out.ok, false);
      assert.equal(out.data, null);
      assert.equal(out.findings[0].rule, "usage");
    }
  });

  test("a repository root without artifacts/ exits 3 with a precondition finding", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "skill-quality-empty-"));
    roots.push(empty);
    const res = run(empty, ["--json"]);
    assert.equal(res.status, 3);
    assert.equal(JSON.parse(res.stdout).findings[0].rule, "precondition");
  });

  test("a named skill is the only one checked", () => {
    const dir = root({});
    const res = run(dir, ["x", "--json"]);
    assert.equal(JSON.parse(res.stdout).data.skills.length, 1);
  });
});

describe("the repository (R21, R22)", () => {
  test("every skill that ships evals produces no error, and no skill produces an error that is not protected", () => {
    const res = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", ENTRY, "--json"], { encoding: "utf8", cwd: REPO });
    const out = JSON.parse(res.stdout) as { findings: { severity: string; skill: string; rule: string; file: string }[]; data: { skills: { name: string; protected: boolean }[] } };
    assert.equal(res.status, 0, res.stderr);
    const prLogbook = out.data.skills.find((s) => s.name === "pr-logbook");
    assert.equal(prLogbook?.protected, true, "pr-logbook ships evals and is protected");
    assert.deepEqual(out.findings.filter((f) => f.severity === "error"), []);
  });
});
