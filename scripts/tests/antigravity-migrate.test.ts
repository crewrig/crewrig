// antigravity-migrate.test.ts — tests of scripts/lib/antigravity-migrate.ts,
// the twin of `migrate_antigravity_superseded_components` (spec 0255). Fixtures
// mirror write_component/stage_skill of test-antigravity-component-install.sh.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { migrateAntigravitySupersededComponents } from "../lib/antigravity-migrate.ts";

let work: string;
let n = 0;

before(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), "agy-migrate-"));
});
after(() => {
  fs.rmSync(work, { recursive: true, force: true });
});

/** A fresh `{ artifacts, superseded }` sandbox pair. */
function sandbox(): { artifacts: string; superseded: string } {
  const root = path.join(work, `s${(n += 1)}`);
  return { artifacts: path.join(root, "artifacts"), superseded: path.join(root, "superseded") };
}

/** Mirror of write_component: `body: "canonical"` puts an INDENTED provenance block in the body. */
function writeComponent(marker: string, name: string, prov: boolean, body = "plain"): void {
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  const lines = ["---", `name: ${name}`, `description: "Fixture component ${name}."`];
  if (prov) {
    lines.push(
      "metadata:",
      "  provenance:",
      '    canonical: "https://github.com/crewrig/crewrig"',
      '    feedback: "https://github.com/crewrig/crewrig"',
      '    version: "1.0.0"',
    );
  }
  lines.push("---", "", `# ${name}`, "", "Fixture body.");
  if (body === "canonical") {
    lines.push(
      "",
      "A user's own notes, quoting what a framework block looks like:",
      "",
      "    metadata:",
      "      provenance:",
      '        canonical: "https://github.com/some-user/their-own-thing"',
      "",
    );
  }
  fs.writeFileSync(marker, `${lines.join("\n")}\n`);
}

const stageSkill = (root: string, tier: string, name: string): void =>
  writeComponent(path.join(root, tier, "skills", name, "SKILL.md"), name, true);

function run(
  s: { artifacts: string; superseded: string },
  kind: string,
  names: string[] = [],
): { status: number; removed: number; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const r = migrateAntigravitySupersededComponents(s.superseded, s.artifacts, kind, names, {
    out: (l) => out.push(l),
    err: (l) => err.push(l),
  });
  return { ...r, out, err };
}

describe("migrateAntigravitySupersededComponents", () => {
  test("removes a framework component, keeps a user directory byte-identical", () => {
    const s = sandbox();
    stageSkill(s.artifacts, "library", "harness-report");
    const fw = path.join(s.superseded, "skills", "harness-report");
    writeComponent(path.join(fw, "SKILL.md"), "harness-report", true);
    const user = path.join(s.superseded, "skills", "my-own-notes");
    writeComponent(path.join(user, "SKILL.md"), "my-own-notes", false);
    fs.writeFileSync(path.join(user, "notes.txt"), "keep me\n");
    const before = fs.readFileSync(path.join(user, "SKILL.md"), "utf8");
    const r = run(s, "all");
    assert.equal(r.status, 0);
    assert.equal(r.removed, 1);
    assert.equal(fs.existsSync(fw), false);
    assert.equal(fs.readFileSync(path.join(user, "SKILL.md"), "utf8"), before);
    assert.equal(fs.readFileSync(path.join(user, "notes.txt"), "utf8"), "keep me\n");
    assert.deepEqual(r.out, [
      `  Migrated away: ${fw} (superseded placement)`,
      `  Removed 1 framework component(s) from the superseded placement at ${s.superseded}.`,
    ]);
    assert.deepEqual(r.err, []);
  });

  test("served name without frontmatter provenance is kept and not reported", () => {
    const s = sandbox();
    stageSkill(s.artifacts, "library", "tester");
    const dir = path.join(s.superseded, "skills", "tester");
    writeComponent(path.join(dir, "SKILL.md"), "tester", false, "canonical");
    const r = run(s, "all");
    assert.equal(fs.existsSync(dir), true);
    assert.deepEqual([r.out, r.err, r.removed], [[], [], 0]);
  });

  test("provenance without a served name is reported, not removed (residue block)", () => {
    const s = sandbox();
    stageSkill(s.artifacts, "library", "tester");
    const dir = path.join(s.superseded, "skills", "retired-thing");
    writeComponent(path.join(dir, "SKILL.md"), "retired-thing", true);
    const r = run(s, "all");
    assert.equal(fs.existsSync(dir), true);
    assert.deepEqual(r.out, []);
    assert.deepEqual(r.err, [
      "  The following carry framework provenance but match no served component",
      "  name. They were NOT removed — check them, then remove by hand:",
      `    rm -rf ${dir}`,
    ]);
  });

  test("flat agent files: removed, residue and stripped-extension fallback name", () => {
    const s = sandbox();
    writeComponent(
      path.join(s.artifacts, "library", "agents", "tester-agent", "AGENT.md"),
      "tester-agent",
      true,
    );
    const dest = path.join(s.superseded, "agents");
    writeComponent(path.join(dest, "tester-agent.md"), "tester-agent", true);
    writeComponent(path.join(dest, "retired-agent.md"), "retired-agent", true);
    fs.writeFileSync(path.join(dest, "notes.txt"), "not a component");
    const r = run(s, "agents");
    assert.equal(fs.existsSync(path.join(dest, "tester-agent.md")), false);
    assert.equal(fs.existsSync(path.join(dest, "retired-agent.md")), true);
    assert.equal(fs.existsSync(path.join(dest, "notes.txt")), true);
    assert.equal(r.err[2], `    rm -rf ${path.join(dest, "retired-agent.md")}`);
  });

  test("a served name is a literal, not a pattern (a.b vs axb)", () => {
    const s = sandbox();
    stageSkill(s.artifacts, "library", "axb");
    const dir = path.join(s.superseded, "skills", "a.b");
    writeComponent(path.join(dir, "SKILL.md"), "a.b", true);
    run(s, "all");
    assert.equal(fs.existsSync(dir), true);
  });

  test("org and community tiers are served unconditionally", () => {
    const s = sandbox();
    for (const tier of ["library", "org", "community"])
      stageSkill(s.artifacts, tier, `${tier}-thing`);
    for (const tier of ["library", "org", "community"]) {
      writeComponent(
        path.join(s.superseded, "skills", `${tier}-thing`, "SKILL.md"),
        `${tier}-thing`,
        true,
      );
    }
    assert.equal(run(s, "all").removed, 3);
  });

  test("the declared name wins over the directory name", () => {
    const s = sandbox();
    writeComponent(
      path.join(s.artifacts, "library", "skills", "src-dir", "SKILL.md"),
      "declared-name",
      true,
    );
    const kept = path.join(s.superseded, "skills", "src-dir");
    const gone = path.join(s.superseded, "skills", "declared-name");
    writeComponent(path.join(gone, "SKILL.md"), "declared-name", true);
    writeComponent(path.join(kept, "SKILL.md"), "src-dir", true);
    run(s, "all");
    assert.equal(fs.existsSync(gone), false);
    assert.equal(fs.existsSync(kept), true);
  });

  test("explicit names narrow the sweep to the placed names", () => {
    const s = sandbox();
    for (const name of ["one-skill", "other-skill"]) {
      stageSkill(s.artifacts, "library", name);
      writeComponent(path.join(s.superseded, "skills", name, "SKILL.md"), name, true);
    }
    const r = run(s, "skills", ["one-skill"]);
    assert.equal(fs.existsSync(path.join(s.superseded, "skills", "one-skill")), false);
    assert.equal(fs.existsSync(path.join(s.superseded, "skills", "other-skill")), true);
    // Not served by name, so the narrowed run reports the other one as residue.
    assert.deepEqual(r.err.slice(2), [
      `    rm -rf ${path.join(s.superseded, "skills", "other-skill")}`,
    ]);
  });

  test("explicit names skip the sources entirely (no empty-set error)", () => {
    const s = sandbox();
    fs.mkdirSync(path.join(s.artifacts, "library", "skills", "unreadable"), { recursive: true });
    fs.writeFileSync(
      path.join(s.artifacts, "library", "skills", "unreadable", "SKILL.md"),
      "no frontmatter\n",
    );
    const r = run(s, "skills", ["x"]);
    assert.equal(r.status, 0);
  });

  test("no names: every served name is the fallback", () => {
    const s = sandbox();
    for (const name of ["a-skill", "b-skill"]) {
      stageSkill(s.artifacts, "library", name);
      writeComponent(path.join(s.superseded, "skills", name, "SKILL.md"), name, true);
    }
    const r = run(s, "skills");
    assert.equal(r.removed, 2);
    assert.match(r.out[2] ?? "", /^ {2}Removed 2 framework component\(s\)/);
  });

  test("empty name set from present sources: status 1, three stderr lines, nothing removed", () => {
    const s = sandbox();
    fs.mkdirSync(path.join(s.artifacts, "library", "skills", "unreadable"), { recursive: true });
    fs.writeFileSync(
      path.join(s.artifacts, "library", "skills", "unreadable", "SKILL.md"),
      "no frontmatter\n",
    );
    const dir = path.join(s.superseded, "skills", "whatever");
    writeComponent(path.join(dir, "SKILL.md"), "whatever", true);
    const r = run(s, "all");
    assert.equal(r.status, 1);
    assert.deepEqual(r.err, [
      "  ERROR: read no skills name from 1 source director(ies) under",
      `         ${s.artifacts} — refusing to run a migration that would`,
      "         remove nothing and report success.",
    ]);
    assert.equal(fs.existsSync(dir), true);
    assert.deepEqual(r.out, []);
  });

  test("a catalogue with no component directories, or an absent superseded root, is a clean no-op", () => {
    const s = sandbox();
    fs.mkdirSync(path.join(s.artifacts, "library", "skills"), { recursive: true });
    const r = run(s, "all");
    assert.deepEqual([r.status, r.removed, r.out, r.err], [0, 0, [], []]);
    fs.mkdirSync(path.join(s.superseded, "skills"), { recursive: true });
    assert.equal(run(s, "all").status, 0);
  });

  test("a symlinked directory entry is never followed: reported incomplete, target kept", () => {
    const s = sandbox();
    stageSkill(s.artifacts, "library", "linked");
    const target = path.join(s.superseded, "target-dir");
    writeComponent(path.join(target, "SKILL.md"), "linked", true);
    fs.mkdirSync(path.join(s.superseded, "skills"), { recursive: true });
    const link = path.join(s.superseded, "skills", "linked");
    fs.symlinkSync(target, link, "dir");
    const r = run(s, "skills");
    assert.equal(fs.existsSync(path.join(target, "SKILL.md")), true);
    assert.equal(r.removed, 0);
    assert.equal(r.err[2], `    rm -rf ${link}`);
  });
});
