// skill-evals-schema.test.ts — validator of evals/evals.json (spec 0290 R1-R6, R25).

import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { formatViolation, validateEvals } from "../lib/skill-evals/schema.ts";
import { evalsJson, makeRepo, skillRel, writeSkill } from "./lib/skill-evals-fixtures.ts";

function ctxFor(root: string, name: string) {
  return {
    file: `${skillRel(name)}/evals/evals.json`,
    skillDir: path.join(root, skillRel(name)),
    skillName: name,
  };
}

test("a valid file passes and carries probes", () => {
  const repo = makeRepo();
  try {
    writeSkill(repo, "demo");
    const r = validateEvals(evalsJson("demo"), ctxFor(repo.root, "demo"));
    assert.deepEqual(r.violations, []);
    assert.equal(r.evals?.evals.length, 1);
    assert.equal(r.evals?.trigger_probes.length, 1);
  } finally {
    repo.cleanup();
  }
});

test("two evals with id 1 and a wrong skill_name report both violations with file and JSON path", () => {
  const repo = makeRepo();
  try {
    writeSkill(repo, "demo");
    const doc = JSON.parse(evalsJson("other")) as { evals: Record<string, unknown>[] };
    doc.evals.push({ ...doc.evals[0] });
    const r = validateEvals(JSON.stringify(doc), ctxFor(repo.root, "demo"));
    const lines = r.violations.map(formatViolation);
    assert.ok(
      lines.some((l) => l.includes("evals.json: $.skill_name: R6")),
      lines.join("\n"),
    );
    assert.ok(
      lines.some((l) => l.includes("$.evals[1].id: R3") && l.includes("duplicate")),
      lines.join("\n"),
    );
    assert.equal(r.violations.length, 2);
    assert.equal(r.evals, undefined);
  } finally {
    repo.cleanup();
  }
});

test("rules R2-R5: shape, fields, checks and probes", () => {
  const repo = makeRepo();
  try {
    writeSkill(repo, "demo");
    const c = ctxFor(repo.root, "demo");
    const bad = (doc: unknown) =>
      validateEvals(typeof doc === "string" ? doc : JSON.stringify(doc), c).violations.map(
        (v) => `${v.path} ${v.rule}`,
      );
    assert.deepEqual(bad("{not json"), ["$ R6"]);
    assert.deepEqual(bad([]), ["$ R2"]);
    assert.ok(bad({ skill_name: "demo", evals: [], extra: 1 }).includes("$.extra R2"));
    assert.ok(bad({ skill_name: "demo", evals: [] }).includes("$.evals R2"));
    const one = (e: Record<string, unknown>) => ({
      skill_name: "demo",
      evals: [{ id: 1, prompt: "p", expected_output: "o", files: [], expectations: ["e"], ...e }],
    });
    assert.ok(bad(one({ id: 0 })).includes("$.evals[0].id R3"));
    assert.ok(bad(one({ prompt: "" })).includes("$.evals[0].prompt R3"));
    assert.ok(bad(one({ files: ["evals/files/missing.txt"] })).includes("$.evals[0].files[0] R3"));
    assert.ok(bad(one({ files: ["../outside.txt"] })).includes("$.evals[0].files[0] R3"));
    assert.ok(bad(one({ expectations: [""] })).includes("$.evals[0].expectations[0] R3"));
    assert.ok(bad(one({ expectations: [] })).includes("$.evals[0] R3"));
    assert.ok(bad(one({ checks: [{ type: "bogus" }] })).includes("$.evals[0].checks[0].type R4"));
    assert.ok(
      bad(one({ checks: [{ type: "file_exists", path: "../x" }] })).includes(
        "$.evals[0].checks[0].path R4",
      ),
    );
    assert.ok(
      bad(one({ checks: [{ type: "file_contains", path: "a", pattern: "(" }] })).includes(
        "$.evals[0].checks[0].pattern R4",
      ),
    );
    assert.ok(
      bad(one({ checks: [{ type: "exit_code", script: "references/x.sh" }] })).includes(
        "$.evals[0].checks[0].script R4",
      ),
    );
    assert.ok(
      bad(
        one({ checks: [{ type: "exit_code", script: "scripts/run.sh", expected: 1.5 }] }),
      ).includes("$.evals[0].checks[0].expected R4"),
    );
    assert.deepEqual(
      bad(
        one({
          expectations: [],
          checks: [{ type: "exit_code", script: "scripts/run.sh", args: ["a"], expected: 3 }],
        }),
      ),
      [],
    );
    assert.ok(
      bad({ ...one({}), trigger_probes: [{ query: "", should_trigger: "yes" }] }).includes(
        "$.trigger_probes[0].query R5",
      ),
    );
    assert.ok(
      bad({ ...one({}), trigger_probes: [{ query: "q", should_trigger: "yes" }] }).includes(
        "$.trigger_probes[0].should_trigger R5",
      ),
    );
  } finally {
    repo.cleanup();
  }
});

test("two files entries with the same base name are invalid", () => {
  const repo = makeRepo();
  try {
    writeSkill(repo, "demo", { "evals/files/sub/in.txt": "x\n" });
    const doc = JSON.parse(evalsJson("demo")) as { evals: { files: string[] }[] };
    doc.evals[0]!.files = ["evals/files/in.txt", "evals/files/sub/in.txt"];
    const r = validateEvals(JSON.stringify(doc), ctxFor(repo.root, "demo"));
    assert.ok(
      r.violations.some((v) => v.path === "$.evals[0].files[1]" && v.message.includes("repeats")),
    );
  } finally {
    repo.cleanup();
  }
});
