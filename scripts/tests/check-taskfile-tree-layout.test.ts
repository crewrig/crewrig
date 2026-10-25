// Tests for scripts/check-taskfile-tree.ts and scripts/lib/governance/taskfile-tree-guard.ts,
// part 1: layout checks (a)-(d) (spec 0278 R13, R15). Trees are staged in mkdtemp directories by
// scripts/tests/lib/taskfile-tree-guard-fixtures.ts. Part 2 is check-taskfile-tree-contract.test.ts.

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { ROOT_READER_ALLOW } from "../lib/governance/taskfile-tree-guard.ts";
import { LINT, ROOT, cleanup, findings, split } from "./lib/taskfile-tree-guard-fixtures.ts";

after(cleanup);

describe("check-taskfile-tree checks (a)-(d)", () => {
  it("passes a clean split-shaped tree", () => {
    assert.deepEqual(findings(split()), []);
  });

  it("(a) fails an unincluded taskfiles/foo.yml", () => {
    const out = findings({ ...split(), "taskfiles/foo.yml": `version: '3.54'\ntasks: {}\n` });
    assert.deepEqual(out, ["taskfiles/foo.yml is not reachable from the root includes"]);
  });

  it("(a) fails an orphan taskfiles/ci/foo.yml, recursively (spec 0278 R25)", () => {
    const out = findings({ ...split(), "taskfiles/ci/foo.yml": `version: '3.54'\ntasks: {}\n` });
    assert.deepEqual(out, ["taskfiles/ci/foo.yml is not reachable from the root includes"]);
  });

  it("(b) fails a test source under scripts/tests/ reading the root file", () => {
    const out = findings({
      ...split(),
      "scripts/tests/reader.test.ts": 'readFileSync(path.join(repo, "Taskfile.yml"), "utf8");\n',
    });
    assert.equal(out.length, 1);
    assert.match(
      out[0] ?? "",
      /^scripts\/tests\/reader\.test\.ts:1: reads the root Taskfile directly/,
    );
  });

  it("(b) matches the single-quote and backtick forms", () => {
    const out = findings({
      ...split(),
      "scripts/a.ts": "read('Taskfile.yml');\n",
      "scripts/b.js": "read(`Taskfile.yml`);\n",
    });
    assert.deepEqual(
      out.map((f) => f.split(":")[0]),
      ["scripts/a.ts", "scripts/b.js"],
    );
  });

  it("(b) skips comment lines and unquoted mentions", () => {
    const out = findings({
      ...split(),
      "scripts/c.ts": [
        '// reads "Taskfile.yml" in a comment',
        '/* "Taskfile.yml" */',
        ' * "Taskfile.yml" in a block comment',
        "const note = Taskfile.yml.length;",
        "",
      ].join("\n"),
    });
    assert.deepEqual(out, []);
  });

  it("(b) honours the allow-list, every entry with a reason", () => {
    const allowed = [...ROOT_READER_ALLOW.keys()];
    assert.ok(allowed.length > 0);
    for (const [file, reason] of ROOT_READER_ALLOW) {
      assert.match(reason, /\S/, file);
    }
    const tree = split();
    for (const file of allowed) {
      tree[file] = 'const root = "Taskfile.yml";\n';
    }
    assert.deepEqual(findings(tree), []);
  });

  it("(c) fails a task other than default in the root", () => {
    const out = findings({
      ...split(),
      "Taskfile.yml": `${ROOT}  stray:\n    cmds:\n      - echo stray\n`,
    });
    assert.deepEqual(out, [
      "Taskfile.yml defines task 'stray'; the root may only define 'default'",
    ]);
  });

  it("(d) fails a version string differing from '3.54'", () => {
    const out = findings({ ...split(), "taskfiles/lint.yml": LINT.replace("'3.54'", "'3.38'") });
    assert.deepEqual(out, ["taskfiles/lint.yml: version '3.38' differs from '3.54'"]);
  });

  it("(d) fails an unquoted 3.54 float and a root version '3'", () => {
    const float = findings({ ...split(), "taskfiles/lint.yml": LINT.replace("'3.54'", "3.54") });
    assert.deepEqual(float, ["taskfiles/lint.yml: version 3.54 (number) differs from '3.54'"]);
    const root = findings({ ...split(), "Taskfile.yml": ROOT.replace("'3.54'", "'3'") });
    assert.deepEqual(root, ["Taskfile.yml: version '3' differs from '3.54'"]);
  });

  it("reports every finding, not just the first", () => {
    const out = findings({
      ...split(),
      "taskfiles/foo.yml": `version: '3.54'\ntasks: {}\n`,
      "taskfiles/lint.yml": LINT.replace("'3.54'", "'3'"),
    });
    assert.equal(out.length, 2);
  });
});
