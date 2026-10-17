// governance-suite-markdown-links.test.ts — Replaces scripts/tests/test-check-markdown-links.sh
// (Tests 1-3, one fixture repository built once in `before`). The entry reads the working-tree
// files named by argument; the child cwd is the fixture. Stdout and stderr are asserted (the
// Bash suite discarded them).

import assert from "node:assert/strict";
import path from "node:path";
import { before, describe, it } from "node:test";
import { commitAll, newRepo, runIn, writeRel } from "./lib/governance-git-fixture.ts";
import { REPO } from "./lib/governance-sandbox.ts";

const ENTRY = path.join(REPO, "scripts", "check-markdown-links.ts");
const SPACED = "sub/folder/file with spaces.md";

const VALID = [
  "# Valid Links",
  "- [Target](target.md)",
  "- [Guide](docs/guide.md)",
  "- [With Fragment](target.md#section)",
  "- [Percent Encoded](sub/folder/file%20with%20spaces.md)",
  "- [Absolute](https://example.com)",
  "- [Mailto](mailto:user@example.com)",
  "- [Anchor](#top)",
  "- [Templated](${VARIABLE}/path)",
  "- [GitHub Issue](../../../../issues/80)",
  "",
].join("\n");

const BROKEN = "# Broken Link\n- [Non-existent](non_existent_file.md)\n";
const CODE =
  "# Code Blocks and Spans\n`[ignored](non_existent_inline.md)`\n\n" +
  "```markdown\n[ignored](non_existent_fenced.md)\n```\n";

describe("check-markdown-links (Tests 1-3)", () => {
  let repo = "";
  before(() => {
    repo = newRepo("main", "governance-md-links-");
    for (const rel of ["target.md", "docs/guide.md", SPACED]) writeRel(repo, rel, "");
    writeRel(repo, "valid.md", VALID);
    writeRel(repo, "broken.md", BROKEN);
    writeRel(repo, "code.md", CODE);
    commitAll(repo, "fixture");
  });

  it("Test 1: valid relative, encoded, absolute, templated and issue links pass", () => {
    const res = runIn(ENTRY, repo, {}, ["valid.md"]);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.ok(res.stdout.includes("All relative Markdown links resolved cleanly."), res.stdout);
  });

  it("Test 2: a broken link fails and the FAIL line names the file and the target", () => {
    const res = runIn(ENTRY, repo, {}, ["broken.md"]);
    assert.equal(res.status, 1, res.stdout + res.stderr);
    const line = res.stdout.split("\n").find((l) => l.startsWith("FAIL: "));
    assert.ok(line?.includes("broken.md"), res.stdout);
    assert.ok(line?.includes("non_existent_file.md"), res.stdout);
  });

  it("Test 3: links inside a code span and a fenced block are ignored", () => {
    const res = runIn(ENTRY, repo, {}, ["code.md"]);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.ok(res.stdout.includes("All relative Markdown links resolved cleanly."), res.stdout);
  });
});
