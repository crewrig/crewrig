// skill-scripts-doc-writer-copied.test.ts — the doc-writer scripts run from a copy of the WHOLE skill
// directory placed outside the repository, under every package layout (spec 0297 R8): no Node
// warning on stderr, and the bundled template found next to scripts/.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import {
  GOOD_ADR,
  parseEnvelope,
  run,
  SKILL_DIR,
  tempDir,
} from "./lib/skill-scripts-doc-writer-cli.ts";
import { type Layout, LAYOUT_PACKAGE } from "./lib/skill-scripts-observe.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const root = tempDir("doc-writer-copied-");
after(() => fs.rmSync(root, { recursive: true, force: true }));
assert.ok(!root.startsWith(REPO), "the copies must live outside the repository");

const WARNING = /\bWarning\b|MODULE_TYPELESS_PACKAGE_JSON|ExperimentalWarning|DeprecationWarning/;

describe("doc-writer scripts from a copy of the whole skill directory", () => {
  for (const layout of Object.keys(LAYOUT_PACKAGE) as Layout[]) {
    describe(`layout ${layout}`, () => {
      const dir = path.join(root, layout, "doc-writer");
      fs.mkdirSync(dir, { recursive: true });
      fs.cpSync(SKILL_DIR, dir, { recursive: true });
      const pkg = LAYOUT_PACKAGE[layout];
      if (pkg !== undefined) fs.writeFileSync(path.join(dir, "package.json"), pkg);
      const work = path.join(root, layout, "work");
      fs.mkdirSync(work, { recursive: true });

      test("new-adr uses the template bundled in the copy, exit 0, no warning", () => {
        const r = run("new-adr", ["--title", "Copy check", "--dir", "adr", "--json"], {
          cwd: work,
          skillDir: dir,
        });
        assert.equal(r.status, 0, r.stdout + r.stderr);
        assert.doesNotMatch(r.stderr, WARNING);
        assert.equal(parseEnvelope(r).data?.number, "0001");
        assert.match(
          fs.readFileSync(path.join(work, "adr", "0001-copy-check.md"), "utf8"),
          /^# ADR-0001: Copy check\n/,
        );
      });
      test("lint-adr runs from the copy, exit 0 on a good ADR, exit 1 on a finding, no warning", () => {
        const ok = run("lint-adr", ["-", "--json"], { cwd: work, skillDir: dir, input: GOOD_ADR });
        assert.equal(ok.status, 0, ok.stdout + ok.stderr);
        assert.doesNotMatch(ok.stderr, WARNING);
        const bad = run("lint-adr", ["-"], { cwd: work, skillDir: dir, input: "nothing" });
        assert.equal(bad.status, 1);
        assert.doesNotMatch(bad.stderr, WARNING);
      });
      test("--help of each script is clean from the copy", () => {
        for (const s of ["new-adr", "lint-adr"] as const) {
          const r = run(s, ["--help"], { cwd: work, skillDir: dir });
          assert.equal(r.status, 0, s);
          assert.equal(r.stderr, "", s);
        }
      });
    });
  }
});
