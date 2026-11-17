// build-components-shared-references.test.ts — spec 0293 R11: a shared reference a skill body
// cites is copied, byte for byte, into every built output of the skill; nothing is copied for
// an uncited topic; the `shared-` prefix is reserved; an orphan copy is drift; a cited topic
// with no source fails the build in write and check mode.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createFixtureTree } from "./lib/build-fixture-tree.ts";
import { CONFIG, skill } from "./fixtures/build-components/entry-kit.ts";

// Carriage returns and a relative link: a link rewrite or a line-ending fold would change them.
const SHARED =
  "# Friction\r\n\r\nSee [doc](../../../../docs/x.md).\r\n<!-- provenance: keep -->\r\n";
const OUTPUTS = [".gemini", ".claude", ".github", ".agents"].map((d) => `${d}/skills/x/references`);

function tree(body: string) {
  const t = createFixtureTree();
  t.config(CONFIG);
  t.artifact("core/shared/references/friction-reporting.md", SHARED);
  t.artifact("core/skills/x/SKILL.md", skill("x", body));
  return t;
}

describe("shared references at build time (R11)", () => {
  test("a cited topic is copied byte-identically into the four outputs", () => {
    const t = tree("Report friction: `references/shared-friction-reporting.md`.\n");
    const res = t.run([]);
    assert.equal(res.status, 0, res.stderr + res.stdout);
    for (const dir of OUTPUTS)
      assert.equal(t.read(`${dir}/shared-friction-reporting.md`), SHARED, dir);
  });

  test("an uncited topic gets no copy, and the build with the source present still passes", () => {
    const t = tree("No citation here.\n");
    assert.equal(t.run([]).status, 0);
    for (const dir of OUTPUTS) assert.equal(t.exists(`${dir}/shared-friction-reporting.md`), false);
  });

  test("a cited topic whose source is missing fails, in write and in check mode", () => {
    const t = tree("Cite `references/shared-missing-topic.md`.\n");
    for (const args of [[], ["--check"]]) {
      const res = t.run(args);
      assert.equal(res.status, 1, args.join(" "));
      assert.match(res.stderr, /shared-missing-topic\.md/);
    }
  });

  test("a skill source holding a shared- reference of its own fails", () => {
    const t = tree("Body.\n");
    t.artifact("core/skills/x/references/shared-own.md", "own\n");
    const res = t.run([]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /shared- prefix is reserved/);
  });

  test("--check reports a missing, a differing and an orphan copy; a write build repairs them", () => {
    const t = tree("Cite `references/shared-friction-reporting.md`.\n");
    assert.equal(t.run([]).status, 0);
    t.write(".claude/skills/x/references/shared-friction-reporting.md", "edited\n");
    t.remove(".gemini/skills/x/references/shared-friction-reporting.md");
    t.write(".github/skills/x/references/shared-gone.md", "orphan\n");
    const drift = t.run(["--check"]);
    assert.equal(drift.status, 1, drift.stdout + drift.stderr);
    assert.match(
      drift.stdout,
      /\.claude\/skills\/x\/references\/shared-friction-reporting\.md differs/,
    );
    assert.match(
      drift.stdout,
      /\.gemini\/skills\/x\/references\/shared-friction-reporting\.md does not exist/,
    );
    assert.match(drift.stdout, /shared-gone\.md is a shared reference the skill no longer cites/);
    assert.equal(t.run([]).status, 0);
    assert.equal(t.exists(".github/skills/x/references/shared-gone.md"), false);
    assert.equal(t.run(["--check"]).status, 0);
  });

  test("a citation inside a yaml fence or a placeholder path does not count", () => {
    const t = tree(
      "```yaml\nx: references/shared-friction-reporting.md\n```\nAnd `references/shared-<topic>.md`.\n",
    );
    assert.equal(t.run([]).status, 0);
    for (const dir of OUTPUTS) assert.equal(t.exists(`${dir}/shared-friction-reporting.md`), false);
  });
});
