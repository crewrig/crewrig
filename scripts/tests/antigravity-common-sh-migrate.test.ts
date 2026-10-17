// antigravity-common-sh-migrate.test.ts — migrate_antigravity_superseded_components of
// scripts/lib/common.sh, run by sourcing the library (spec 0263 G6-G13 of
// test-antigravity-component-install.sh; the literal output lines the TypeScript twin tests do not pin).
// Retires with scripts/lib/common.sh (row J4): POSIX-only, the library is Bash.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import {
  runCommon,
  scratch,
  stageAgent,
  stageSkill,
  writeComponent,
} from "./lib/antigravity-fixtures.ts";
import { cleanupAll, SKIP_POSIX } from "./lib/worktree-fixtures.ts";

after(cleanupAll);

interface Place {
  readonly root: string;
  readonly lib: string;
  readonly sup: string;
}

function place(prefix: string): Place {
  const root = scratch(prefix);
  return { root, lib: path.join(root, "artifacts", "library"), sup: path.join(root, "superseded") };
}

function migrate(p: Place, kind = "all", ...names: string[]): ReturnType<typeof runCommon> {
  return runCommon("migrate_antigravity_superseded_components", [
    p.sup,
    path.join(p.root, "artifacts"),
    kind,
    ...names,
  ]);
}

const comp = (p: Place, rel: string, name: string, prov: boolean, body?: "canonical"): void =>
  writeComponent(path.join(p.sup, rel), name, prov, body);

describe("migrate_antigravity_superseded_components (sourced)", { skip: SKIP_POSIX }, () => {
  test("G6: the spec scenario: framework skills removed and named, the user directory untouched (R8/R9)", () => {
    const p = place("agy-g6-");
    stageSkill(p.lib, "harness-report");
    stageSkill(p.lib, "user-validate");
    comp(p, "skills/harness-report/SKILL.md", "harness-report", true);
    comp(p, "skills/user-validate/SKILL.md", "user-validate", true);
    comp(p, "skills/my-own-notes/SKILL.md", "my-own-notes", false);
    fs.writeFileSync(path.join(p.sup, "skills/my-own-notes/notes.txt"), "keep me\n");
    const read = (): string =>
      ["SKILL.md", "notes.txt"]
        .map((f) => fs.readFileSync(path.join(p.sup, "skills/my-own-notes", f), "utf8"))
        .join("");
    const before = read();
    const res = migrate(p);
    assert.equal(res.status, 0);
    assert.match(res.out, /Migrated away[\s\S]*harness-report/);
    assert.ok(!res.out.includes("my-own-notes"), res.out);
    assert.ok(!fs.existsSync(path.join(p.sup, "skills/harness-report")));
    assert.ok(!fs.existsSync(path.join(p.sup, "skills/user-validate")));
    assert.equal(read(), before);
  });

  test("G7: the predicate is a conjunction, each half discriminated separately", () => {
    const p = place("agy-g7-");
    stageSkill(p.lib, "tester");
    comp(p, "skills/tester/SKILL.md", "tester", false, "canonical");
    comp(p, "skills/retired-thing/SKILL.md", "retired-thing", true);
    const res = migrate(p);
    assert.ok(
      fs.existsSync(path.join(p.sup, "skills/tester")),
      "a body-only token is not provenance",
    );
    assert.ok(fs.existsSync(path.join(p.sup, "skills/retired-thing")));
    assert.ok(res.out.includes("retired-thing"), res.out);
    assert.ok(!res.out.includes("tester"), res.out);
  });

  test("G8: the served-name test is literal and whole-line", () => {
    const p = place("agy-g8-");
    stageSkill(p.lib, "axb");
    stageSkill(p.lib, "harness-report");
    stageAgent(p.lib, "axb-agent");
    comp(p, "skills/a.b/SKILL.md", "a.b", true);
    comp(p, "skills/harness/SKILL.md", "harness", true);
    comp(p, "agents/a.b-agent.md", "a.b-agent", true);
    comp(p, "skills/harness-report/SKILL.md", "harness-report", true);
    const res = migrate(p);
    assert.ok(fs.existsSync(path.join(p.sup, "skills/a.b")), "-F is load-bearing");
    assert.ok(fs.existsSync(path.join(p.sup, "skills/harness")), "-x is load-bearing");
    assert.ok(fs.existsSync(path.join(p.sup, "agents/a.b-agent.md")));
    assert.ok(!fs.existsSync(path.join(p.sup, "skills/harness-report")), "control");
    assert.ok(res.out.includes(`rm -rf ${p.sup}/skills/a.b`), res.out);
    assert.ok(res.out.includes(`rm -rf ${p.sup}/skills/harness`), res.out);
  });

  test("G9: flat agent files: removed, kept, and kept-and-named", () => {
    const p = place("agy-g9-");
    stageAgent(p.lib, "harness-curator");
    stageAgent(p.lib, "tester-agent");
    comp(p, "agents/harness-curator.md", "harness-curator", true);
    comp(p, "agents/tester-agent.md", "tester-agent", false, "canonical");
    comp(p, "agents/retired-agent.md", "retired-agent", true);
    const res = migrate(p);
    assert.ok(!fs.existsSync(path.join(p.sup, "agents/harness-curator.md")));
    assert.ok(fs.existsSync(path.join(p.sup, "agents/tester-agent.md")));
    assert.ok(fs.existsSync(path.join(p.sup, "agents/retired-agent.md")));
    assert.ok(res.out.includes("retired-agent"), res.out);
  });

  test("G10: org and community tier components are swept although only library is installed", () => {
    const p = place("agy-g10-");
    stageSkill(p.lib, "library-thing");
    stageSkill(path.join(p.root, "artifacts", "org"), "org-thing");
    stageSkill(path.join(p.root, "artifacts", "community"), "community-thing");
    comp(p, "skills/org-thing/SKILL.md", "org-thing", true);
    comp(p, "skills/community-thing/SKILL.md", "community-thing", true);
    migrate(p);
    assert.ok(!fs.existsSync(path.join(p.sup, "skills/org-thing")));
    assert.ok(!fs.existsSync(path.join(p.sup, "skills/community-thing")));
  });

  test("G11: the name is the frontmatter name, not the source directory name", () => {
    const p = place("agy-g11-");
    writeComponent(path.join(p.lib, "skills/some-source-dir/SKILL.md"), "declared-name", true);
    comp(p, "skills/declared-name/SKILL.md", "declared-name", true);
    comp(p, "skills/some-source-dir/SKILL.md", "some-source-dir", true);
    migrate(p);
    assert.ok(!fs.existsSync(path.join(p.sup, "skills/declared-name")));
    assert.ok(fs.existsSync(path.join(p.sup, "skills/some-source-dir")));
  });

  test("G12: an empty name set from present sources is an error, an empty catalogue is not", () => {
    const p = place("agy-g12-");
    fs.mkdirSync(path.join(p.lib, "skills/unreadable"), { recursive: true });
    fs.writeFileSync(path.join(p.lib, "skills/unreadable/SKILL.md"), "no frontmatter at all\n");
    comp(p, "skills/whatever/SKILL.md", "whatever", true);
    const res = migrate(p);
    assert.notEqual(res.status, 0);
    assert.ok(res.out.includes("refusing to run a migration"), res.out);
    const q = place("agy-g12b-");
    fs.mkdirSync(path.join(q.lib, "skills"), { recursive: true });
    fs.mkdirSync(path.join(q.sup, "skills"), { recursive: true });
    assert.equal(migrate(q).status, 0);
  });

  test("G13: a narrowed sweep removes only the names it is given", () => {
    const p = place("agy-g13-");
    stageSkill(p.lib, "one-skill");
    stageSkill(p.lib, "other-skill");
    comp(p, "skills/one-skill/SKILL.md", "one-skill", true);
    comp(p, "skills/other-skill/SKILL.md", "other-skill", true);
    migrate(p, "skills", "one-skill");
    assert.ok(!fs.existsSync(path.join(p.sup, "skills/one-skill")));
    assert.ok(fs.existsSync(path.join(p.sup, "skills/other-skill")));
  });
});
