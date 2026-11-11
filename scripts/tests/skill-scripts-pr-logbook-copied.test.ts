// skill-scripts-pr-logbook-copied.test.ts — the pr-logbook scripts run from a copy of the WHOLE
// skill directory placed outside the repository, under every package layout (spec 0292 R8, R16;
// plan v3 step 5, verdict v3-F4(b)): no Node warning on stderr, the bundled template found next
// to scripts/, and the bundled template equal to the fenced template of docs/pr-format.md.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import {
  FIXTURES,
  parseEnvelope,
  run,
  SKILL_DIR,
  tempDir,
} from "./lib/skill-scripts-pr-logbook-cli.ts";
import { type Layout, LAYOUT_PACKAGE } from "./lib/skill-scripts-observe.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const VALID = fs.readFileSync(path.join(FIXTURES, "valid-body.md"), "utf8");
const root = tempDir("pr-logbook-copied-");
after(() => fs.rmSync(root, { recursive: true, force: true }));

assert.ok(!root.startsWith(REPO), "the copies must live outside the repository");

const WARNING = /\bWarning\b|MODULE_TYPELESS_PACKAGE_JSON|ExperimentalWarning|DeprecationWarning/;

function copyOf(layout: Layout): string {
  const dir = path.join(root, layout, "pr-logbook");
  fs.mkdirSync(dir, { recursive: true });
  fs.cpSync(SKILL_DIR, dir, { recursive: true });
  const pkg = LAYOUT_PACKAGE[layout];
  if (pkg !== undefined) fs.writeFileSync(path.join(dir, "package.json"), pkg);
  return dir;
}

describe("pr-logbook scripts from a copy of the whole skill directory", () => {
  for (const layout of Object.keys(LAYOUT_PACKAGE) as Layout[]) {
    describe(`layout ${layout}`, () => {
      const dir = copyOf(layout);
      const work = path.join(root, layout, "work");
      fs.mkdirSync(work, { recursive: true });
      const specFile = path.join(work, "spec.md");
      fs.writeFileSync(specFile, "---\nstatus: approved\n---\n\nbody\n");

      test("lint-pr-body uses the template bundled in the copy, exits 0, no warning", () => {
        const r = run("lint-pr-body", ["--title", "Add a thing", "--body-file", "-", "--json"], {
          input: VALID,
          cwd: work,
          skillDir: dir,
        });
        assert.equal(r.status, 0, r.stdout + r.stderr);
        assert.doesNotMatch(r.stderr, WARNING);
        assert.equal(parseEnvelope(r).ok, true);
      });

      test("lint-pr-body reports a finding from the copy, exit 1, no warning", () => {
        const r = run("lint-pr-body", ["--title", "Add a thing.", "--body-file", "-"], {
          input: VALID,
          cwd: work,
          skillDir: dir,
        });
        assert.equal(r.status, 1);
        assert.doesNotMatch(r.stderr, WARNING);
      });

      test("resolve-logbook-target runs from the copy, no warning", () => {
        const r = run("resolve-logbook-target", ["--body-file", "-", "--json"], {
          input: "Fixes #12\ncloses #40\n",
          cwd: work,
          skillDir: dir,
        });
        assert.equal(r.status, 0, r.stdout + r.stderr);
        assert.doesNotMatch(r.stderr, WARNING);
        assert.deepEqual((parseEnvelope(r).data as { issues: number[] }).issues, [12, 40]);
      });

      test("flip-spec-status runs from the copy, no warning", () => {
        const r = run("flip-spec-status", [specFile, "--json"], { cwd: work, skillDir: dir });
        assert.equal(r.status, 0, r.stdout + r.stderr);
        assert.doesNotMatch(r.stderr, WARNING);
        assert.equal(fs.readFileSync(specFile, "utf8"), "---\nstatus: implemented\n---\n\nbody\n");
      });

      test("--help of each script is clean from the copy", () => {
        for (const s of ["lint-pr-body", "resolve-logbook-target", "flip-spec-status"] as const) {
          const r = run(s, ["--help"], { cwd: work, skillDir: dir });
          assert.equal(r.status, 0, s);
          assert.equal(r.stderr, "", s);
        }
      });
    });
  }
});

describe("bundled template", () => {
  test("assets/pr-body.template.md equals the fenced template of docs/pr-format.md", () => {
    const doc = fs.readFileSync(path.join(REPO, "docs", "pr-format.md"), "utf8");
    const m = /```markdown\n([\s\S]*?)\n```/.exec(doc);
    assert.ok(m, "docs/pr-format.md has no ```markdown fence");
    const asset = fs.readFileSync(path.join(SKILL_DIR, "assets", "pr-body.template.md"), "utf8");
    assert.equal(asset.replace(/\n$/, ""), m[1]);
  });
});
