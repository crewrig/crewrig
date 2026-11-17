// skill-scripts-spec-author-copied.test.ts — scaffold-spec.ts runs from a copy of the WHOLE skill
// directory placed outside the repository, under every package layout (spec 0294 R10): no Node
// warning on stderr, and the same behaviour as the repository copy.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import {
  fakeRepo,
  parseEnvelope,
  run,
  SKILL_DIR,
  tempDir,
} from "./lib/skill-scripts-spec-author-cli.ts";
import { type Layout, LAYOUT_PACKAGE } from "./lib/skill-scripts-observe.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const root = tempDir("spec-author-copied-");
after(() => fs.rmSync(root, { recursive: true, force: true }));
assert.ok(!root.startsWith(REPO), "the copies must live outside the repository");

const WARNING = /\bWarning\b|MODULE_TYPELESS_PACKAGE_JSON|ExperimentalWarning|DeprecationWarning/;

describe("scaffold-spec from a copy of the whole skill directory", () => {
  for (const layout of Object.keys(LAYOUT_PACKAGE) as Layout[]) {
    describe(`layout ${layout}`, () => {
      const dir = path.join(root, layout, "spec-author");
      fs.mkdirSync(dir, { recursive: true });
      fs.cpSync(SKILL_DIR, dir, { recursive: true });
      const pkg = LAYOUT_PACKAGE[layout];
      if (pkg !== undefined) fs.writeFileSync(path.join(dir, "package.json"), pkg);

      test("writes the skeleton from the copy, exit 0, no warning", () => {
        const r = fakeRepo(root, `work-${layout}`);
        r.reserve("0600");
        const res = run(
          ["--issue", "9", "--slug", "demo", "--complexity", "small", "--mode", "AUTO", "--json"],
          { cwd: r.dir, skillDir: dir },
        );
        assert.equal(res.status, 0, res.stdout + res.stderr);
        assert.doesNotMatch(res.stderr, WARNING);
        assert.equal(parseEnvelope(res).data?.id, "0600");
        assert.ok(fs.existsSync(path.join(r.dir, "specs", "0600-demo.md")));
      });

      test("--help is clean from the copy", () => {
        const res = run(["--help"], { cwd: root, skillDir: dir });
        assert.equal(res.status, 0);
        assert.equal(res.stderr, "");
      });
    });
  }
});
