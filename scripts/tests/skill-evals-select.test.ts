// skill-evals-select.test.ts — changed-skill selection (spec 0290 R17, R34, R25).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { findSkill, listSkills, selectChanged } from "../lib/skill-evals/select.ts";
import type { Selection } from "../lib/skill-evals/select.ts";
import { planSkill } from "../lib/skill-evals/budget.ts";
import { validateEvals } from "../lib/skill-evals/schema.ts";
import {
  commitAll,
  evalsJson,
  makeRepo,
  markOrigin,
  skillRel,
  writeSkill,
} from "./lib/skill-evals-fixtures.ts";
import type { Repo } from "./lib/skill-evals-fixtures.ts";

const names = (r: ReturnType<typeof selectChanged>): string[] =>
  "error" in r ? [`ERROR ${r.error}`] : r.selections.map((s) => s.skill.name).sort();

function twoSkills(f: (repo: Repo) => void): void {
  const repo = makeRepo();
  try {
    writeSkill(repo, "alpha");
    writeSkill(repo, "beta");
    commitAll(repo, "base");
    markOrigin(repo);
    f(repo);
  } finally {
    repo.cleanup();
  }
}

const plan = (sel: Selection, evalsCount = 1): number => {
  const doc = JSON.parse(evalsJson(sel.skill.name)) as { evals: unknown[] };
  while (doc.evals.length < evalsCount)
    doc.evals.push({ ...(doc.evals[0] as object), id: doc.evals.length + 1 });
  const v = validateEvals(JSON.stringify(doc), {
    file: "f",
    skillDir: sel.skill.dirAbs,
    skillName: sel.skill.name,
  });
  assert.ok(v.evals, JSON.stringify(v.violations));
  return planSkill(sel.skill.name, v.evals, !sel.isNew && !sel.installedEqual).executorRuns;
};

test("no change selects nothing; --changed says so through the empty selection", () => {
  twoSkills((repo) => assert.deepEqual(names(selectChanged(repo.root, "origin/main")), []));
});

test("an edited line of references/ selects that skill; a results.json-only change selects the other not", () => {
  twoSkills((repo) => {
    fs.appendFileSync(path.join(repo.root, skillRel("alpha"), "references", "ref.md"), "more\n");
    fs.writeFileSync(path.join(repo.root, skillRel("beta"), "evals", "results.json"), "{}\n");
    commitAll(repo, "change");
    assert.deepEqual(names(selectChanged(repo.root, "origin/main")), ["alpha"]);
  });
});

test("unhashed files and compiled mirrors select nothing", () => {
  twoSkills((repo) => {
    fs.writeFileSync(path.join(repo.root, skillRel("alpha"), "notes.md"), "n");
    fs.mkdirSync(path.join(repo.root, ".claude", "skills", "alpha"), { recursive: true });
    fs.writeFileSync(path.join(repo.root, ".claude", "skills", "alpha", "SKILL.md"), "mirror\n");
    commitAll(repo, "mirror only");
    assert.deepEqual(names(selectChanged(repo.root, "origin/main")), []);
    assert.deepEqual(
      listSkills(repo.root).map((s) => s.name),
      ["alpha", "beta"],
    );
  });
});

test("a scripts-only change plans 3 runs per eval; an evals-only change plans 2", () => {
  twoSkills((repo) => {
    fs.appendFileSync(path.join(repo.root, skillRel("alpha"), "scripts", "run.sh"), "echo x\n");
    fs.writeFileSync(
      path.join(repo.root, skillRel("beta"), "evals", "evals.json"),
      evalsJson("beta", { trigger_probes: [] }),
    );
    commitAll(repo, "change");
    const r = selectChanged(repo.root, "origin/main");
    assert.ok(!("error" in r));
    const by = (n: string) =>
      (r as { selections: Selection[] }).selections.find((s) => s.skill.name === n) as Selection;
    assert.equal(by("alpha").installedEqual, false);
    assert.equal(plan(by("alpha"), 2), 6);
    assert.equal(by("beta").installedEqual, true);
    assert.equal(plan(by("beta"), 2), 4);
  });
});

test("a skill new on the base branch is selected, planned at 2 runs per eval and marked new", () => {
  twoSkills((repo) => {
    writeSkill(repo, "gamma");
    commitAll(repo, "new skill");
    const r = selectChanged(repo.root, "origin/main");
    assert.deepEqual(names(r), ["gamma"]);
    const s = (r as { selections: Selection[] }).selections[0] as Selection;
    assert.equal(s.isNew, true);
    assert.equal(plan(s, 2), 4);
  });
});

test("a dirty (uncommitted, staged) edit selects the skill; an invalid skill is selected too", () => {
  twoSkills((repo) => {
    fs.appendFileSync(path.join(repo.root, skillRel("beta"), "SKILL.md"), "edit\n");
    repo.git("add", "-A");
    fs.writeFileSync(path.join(repo.root, skillRel("alpha"), "scripts", "new.sh"), "#!/bin/sh\n");
    const r = selectChanged(repo.root, "origin/main");
    assert.deepEqual(names(r), ["alpha", "beta"]);
    assert.equal(
      (r as { selections: Selection[] }).selections.find((s) => s.skill.name === "alpha")?.head
        .kind,
      "invalid",
    );
  });
});

test("findSkill: unknown name and a name present in two layers", () => {
  const repo = makeRepo();
  try {
    writeSkill(repo, "alpha");
    assert.deepEqual(findSkill(repo.root, "missing"), { error: "unknown skill: missing" });
    fs.mkdirSync(path.join(repo.root, "artifacts", "library", "skills", "alpha"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(repo.root, "artifacts", "library", "skills", "alpha", "SKILL.md"),
      "x\n",
    );
    const r = findSkill(repo.root, "alpha");
    assert.ok(
      "error" in r &&
        r.error.includes("artifacts/core/skills/alpha") &&
        r.error.includes("artifacts/library/skills/alpha"),
    );
  } finally {
    repo.cleanup();
  }
});
