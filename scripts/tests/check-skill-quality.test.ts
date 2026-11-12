// check-skill-quality.test.ts — spec 0293 R3, R7 to R10, R12, R18, R20: severity and every
// rule of the skill linter, against throwaway repository roots (CREWRIG_REPO_DIR).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

import {
  evalsJson,
  front,
  parsed,
  probes,
  protectedFiles,
  root,
  rules,
  run,
} from "./lib/skill-quality-fixture.ts";

describe("severity (R18)", () => {
  test("a compliant protected skill passes", () => {
    const res = run(root(protectedFiles));
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /0 error\(s\), 0 warning\(s\)/);
  });

  test("a protected skill without a Use when clause is an error and exits 1", () => {
    const dir = root({
      ...protectedFiles,
      "SKILL.md": `${front({ description: '"Does a thing for a team."' })}\nBody.\n`,
    });
    const res = run(dir);
    assert.equal(res.status, 1);
    assert.match(res.stdout, /ERROR .*SKILL\.md \[description-use-when\]/);
  });

  test("the same defect on an unprotected skill is a warning and exits 0; --strict makes it exit 1", () => {
    const dir = root({
      "SKILL.md": `${front({ description: '"Does a thing for a team."' })}\nBody.\n`,
    });
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
    const dir = root({
      "SKILL.md": `${front({ description: JSON.stringify(`Use when x. ${"a".repeat(1100)}`) })}\nBody.\n`,
    });
    assert.equal(rules(dir).get("description-length"), "error");
    assert.equal(run(dir).status, 1);
  });
});

describe("rules (R3, R7 to R10, R12)", () => {
  const cases: [string, Record<string, string>, string][] = [
    ["name must equal the directory", { "SKILL.md": `${front({ name: "y" })}\nBody.\n` }, "name"],
    ["name format", { "SKILL.md": `${front({ name: "Bad_Name" })}\nBody.\n` }, "name"],
    [
      "a first-person description",
      {
        "SKILL.md": `${front({ description: JSON.stringify("I do a thing. Use when asked.") })}\nBody.\n`,
      },
      "description-person",
    ],
    [
      "a second-person description",
      {
        "SKILL.md": `${front({ description: JSON.stringify("Helps you. Use when asked.") })}\nBody.\n`,
      },
      "description-person",
    ],
    [
      "compatibility is required",
      { "SKILL.md": `${front({ compatibility: "" })}\nBody.\n` },
      "compatibility",
    ],
    ["a body over 500 lines", { "SKILL.md": `${front()}${"line\n".repeat(500)}` }, "body-length"],
    [
      "more than five emphasis words",
      { "SKILL.md": `${front()}${"You MUST. ".repeat(6)}\n` },
      "prompt-emphasis",
    ],
    ["a bare issue number", { "SKILL.md": `${front()}\nSee #1234 for why.\n` }, "prompt-citation"],
    [
      "a spec citation",
      { "SKILL.md": `${front()}\nPer spec 0080 this holds.\n` },
      "prompt-citation",
    ],
    [
      "a requirement citation",
      { "SKILL.md": `${front()}\nThis is R14 of it.\n` },
      "prompt-citation",
    ],
    [
      "a cited reference that is missing",
      { "SKILL.md": `${front()}\nRead \`references/missing.md\`.\n` },
      "citation-unresolved",
    ],
    [
      "a cited script that is missing",
      { "SKILL.md": `${front()}\nRun \`scripts/gone.ts\`.\n` },
      "citation-unresolved",
    ],
    [
      "a reference citing another reference",
      {
        "SKILL.md": `${front()}\nRead \`references/a.md\`.\n`,
        "references/a.md": "See `references/b.md`.\n",
        "references/b.md": "b\n",
      },
      "reference-depth",
    ],
    [
      "a long reference without a table of contents",
      {
        "SKILL.md": `${front()}\nRead \`references/a.md\`.\n`,
        "references/a.md": "# A\n" + "text\n".repeat(120),
      },
      "reference-toc",
    ],
    ["fewer than three evals", { "evals/evals.json": evalsJson(2) }, "evals-minimum"],
    ["fewer than five probes", { "evals/evals.json": evalsJson(3, probes(4, 2)) }, "evals-minimum"],
    ["lopsided probes", { "evals/evals.json": evalsJson(3, probes(6, 5)) }, "evals-minimum"],
    [
      "a script that does not answer --help",
      { "scripts/bad.ts": "process.exit(1);\n" },
      "script-help",
    ],
    [
      "a script that prints nothing on --help",
      { "scripts/mute.ts": "// nothing\n" },
      "script-help",
    ],
  ];
  for (const [title, files, rule] of cases)
    test(`${title} is reported as ${rule}`, () => {
      assert.ok(rules(root({ ...protectedFiles, ...files })).has(rule), title);
    });

  const passing: [string, Record<string, string>][] = [
    [
      "exactly five probes, two positive and three negative",
      { "evals/evals.json": evalsJson(3, probes(5, 2)) },
    ],
    [
      "a short number sign and a placeholder",
      { "SKILL.md": `${front()}\nExample: "Task #2 for #N".\n` },
    ],
    [
      "a citation inside a code span still resolves",
      {
        "SKILL.md": `${front()}\nRun \`scripts/ok.ts\`.\n`,
        "scripts/ok.ts": "console.log('usage: ok');\n",
      },
    ],
    ["a placeholder script path", { "SKILL.md": `${front()}\nRun \`scripts/<name>.ts\`.\n` }],
    [
      "a long reference with a table of contents",
      {
        "SKILL.md": `${front()}\nRead \`references/a.md\`.\n`,
        "references/a.md": "# A\n\n## Contents\n\n" + "text\n".repeat(120),
      },
    ],
    [
      "emphasis words inside a code fence",
      { "SKILL.md": `${front()}\n\`\`\`\n${"MUST ".repeat(9)}\n\`\`\`\n` },
    ],
    [
      "a runtime issue number in a yaml fence",
      { "SKILL.md": `${front()}\n\`\`\`yaml\nx: #12345\n\`\`\`\n` },
    ],
  ];
  for (const [title, files] of passing)
    test(`${title} passes`, () => {
      const res = run(root({ ...protectedFiles, ...files }));
      assert.equal(res.status, 0, res.stdout + res.stderr);
    });

  test("a shared reference citation resolves when its source exists and not otherwise (R12)", () => {
    const dir = root({
      ...protectedFiles,
      "SKILL.md": `${front()}\nSee \`references/shared-friction-reporting.md\`.\n`,
    });
    assert.ok(rules(dir).has("citation-unresolved"));
    const src = path.join(
      dir,
      "artifacts",
      "core",
      "shared",
      "references",
      "friction-reporting.md",
    );
    fs.mkdirSync(path.dirname(src), { recursive: true });
    fs.writeFileSync(src, "# Friction\n");
    assert.equal(run(dir).status, 0);
  });
});

describe("script-help-skipped (R10, plan review v2-F2)", () => {
  const py = { "scripts/tool.py": "print('usage')\n" };
  const noPython = { PATH: fs.mkdtempSync(path.join(os.tmpdir(), "no-python-")) };

  test("an interpreter that is not installed is an error on a protected skill, never exit 3", () => {
    const res = run(root({ ...protectedFiles, ...py }), ["--json"], noPython);
    assert.equal(res.status, 1);
    assert.equal(
      parsed(res.stdout).findings.find((f) => f.rule === "script-help-skipped")?.severity,
      "error",
    );
  });

  test("the same on an unprotected skill is a warning and exits 0", () => {
    const res = run(root(py), ["--json"], noPython);
    assert.equal(res.status, 0);
    assert.equal(
      parsed(res.stdout).findings.find((f) => f.rule === "script-help-skipped")?.severity,
      "warning",
    );
  });
});
