// build-components-hardening-names-e2e.test.ts — requirement 35 of spec 0250 delta 01 through the
// entry, in a fixture tree: a component named with a parent segment or a control character is
// refused in every kind, tier and mode, before anything is written, compared or created for it, and
// cannot forge a workflow command; an ordinary name is not touched. Every run has its repository
// root two directories below a container the suite owns and its own `TMPDIR`, so a write that
// leaves the output root is seen there. Units: build-components-hardening-names.test.ts.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  createSandbox,
  namedSource,
  sourcePath,
} from "./fixtures/build-components/hardening-kit.ts";
import type { Kind, Sandbox } from "./fixtures/build-components/hardening-kit.ts";
import { createFixtureTree } from "./lib/build-fixture-tree.ts";
import type { RunResult } from "./lib/build-fixture-tree.ts";

const tree = createFixtureTree();
/** Printed paths are native on win32 (spec 0250 R33(d)); the Windows proof is scripts/tests/lib/windows-build-proof.ts. */
const SKIP =
  process.platform === "win32" ? "skipped: printed paths use the native separator" : false;
const MARKER = "pwned-marker";
/** Four parents from `<root>/.claude/skills`: lands in the container, outside the repository root. */
const ESCAPE = `../../../../${MARKER}`;
const KINDS: readonly Kind[] = ["skill", "agent", "command"];
const TIERS = ["core", "overlay"] as const;
const REFUSED = "is not allowed (control character or '..' path segment).";

/** The directory of the source `evil` of `kind` in `tier`, as the build prints it. */
const shown = (box: Sandbox, tier: string, kind: Kind): string =>
  `${box.repo}/${sourcePath(tier, kind, "z-evil").replace("/SKILL.md", "//SKILL.md").replace("/AGENT.md", "//AGENT.md")}`;

/** A sandbox with a well-named component `a-good` (built first) and `z-evil` named `name`. */
function sandbox(tier: string, kind: Kind, name: string): Sandbox {
  const box = createSandbox(tree);
  box.seedMappings();
  box.write(sourcePath(tier, kind, "a-good"), namedSource("a-good"));
  box.write(sourcePath(tier, kind, "z-evil"), namedSource(name));
  return box;
}

const lines = (text: string): string[] => text.split("\n");

describe(
  "R35 a name with a `..` segment is refused and writes nothing outside the root",
  { skip: SKIP },
  () => {
    for (const kind of KINDS) {
      for (const tier of TIERS) {
        for (const check of [false, true]) {
          test(`${kind}, tier ${tier}, ${check ? "--check" : "build"}`, () => {
            const box = sandbox(tier, kind, ESCAPE);
            const before = { outside: box.outside(), inside: box.inside() };
            const run = box.run(check ? ["--check"] : []);
            assert.equal(run.status, 1, run.stdout + run.stderr);
            assert.ok(
              lines(run.stderr).includes(
                `Error: ${shown(box, tier, kind)}: the component name '${ESCAPE}' ${REFUSED}`,
              ),
              run.stderr,
            );
            assert.doesNotMatch(run.stdout, new RegExp(`Building ${kind}: .*${MARKER}`));
            assert.match(run.stdout, new RegExp(`^Building ${kind}: a-good$`, "m"));
            assert.deepEqual(box.find(MARKER), [], "nothing named like the escape anywhere");
            assert.deepEqual(box.outside(), before.outside, "the container is unchanged");
            assert.deepEqual(box.leftovers(), [], "the staging root is removed, nothing else made");
            if (check) assert.deepEqual(box.inside(), before.inside, "--check writes nothing");
            else
              assert.ok(
                box.inside().some((f) => f.includes("a-good")),
                "earlier files stay",
              );
          });
        }
      }
    }
  },
);

describe("R35 every spelling of a parent segment is refused", { skip: SKIP }, () => {
  for (const name of ["..", "a/../b", "..\\..\\x", "a\\..\\b", `x/../../../../${MARKER}`]) {
    test(JSON.stringify(name), () => {
      const box = sandbox("core", "skill", name);
      const before = box.outside();
      const run = box.run(["--target", "claude"]);
      assert.equal(run.status, 1, run.stdout + run.stderr);
      assert.match(run.stderr, /the component name '.*' is not allowed/);
      assert.deepEqual(box.outside(), before);
      assert.deepEqual(box.find(MARKER), []);
    });
  }
});

describe("R35 a name cannot forge a workflow command or act on the log", { skip: SKIP }, () => {
  const FORGED = "x\n::error title=Injected::forged annotation\n::add-mask::topsecret";
  const SHOWN = "x\\x0a::error title=Injected::forged annotation\\x0a::add-mask::topsecret";
  const streams = (run: RunResult): string[] => [...lines(run.stdout), ...lines(run.stderr)];

  for (const [tier, check] of [
    ["core", false],
    ["overlay", false],
    ["core", true],
    ["overlay", true],
  ] as const) {
    test(`tier ${tier}, ${check ? "--check" : "build"}: refused, one escaped Error line`, () => {
      const box = sandbox(tier, "skill", FORGED);
      const run = box.run(check ? ["--check"] : []);
      assert.equal(run.status, 1, run.stdout + run.stderr);
      const all = streams(run);
      assert.deepEqual(
        all.filter((l) => l.startsWith("::")),
        [],
        "no workflow command",
      );
      assert.deepEqual(
        all.filter((l) => /[\u0000-\u0008\u000b-\u001f\u007f]/.test(l)),
        [],
        "no raw control character in either stream",
      );
      assert.doesNotMatch(run.stdout + run.stderr, /\r|\u001b/);
      assert.deepEqual(
        lines(run.stderr).filter((l) => l.startsWith("Error:")),
        [`Error: ${shown(box, tier, "skill")}: the component name '${SHOWN}' ${REFUSED}`],
      );
      assert.deepEqual(box.leftovers(), []);
    });
  }

  test("the other control characters are shown escaped and nothing leaves the root", () => {
    const box = sandbox("core", "agent", "n\u0000\t\u007f\u001b[31m");
    const run = box.run(["--target", "claude"]);
    assert.equal(run.status, 1);
    assert.match(run.stderr, /the component name 'n\\x00\\x09\\x7f\\x1b\[31m' is not allowed/);
    assert.deepEqual(
      streams(run).filter((l) => /[\u0000-\u0008\u000b-\u001f\u007f]/.test(l)),
      [],
    );
  });
});

describe("R35 an ordinary name is not touched", { skip: SKIP }, () => {
  test("probe, my.skill, a..b, v2..3 and ns/tool are built under their own names", () => {
    const box = createSandbox(tree);
    const names = ["probe", "my.skill", "a..b", "v2..3", "ns/tool"];
    names.forEach((name, i) =>
      box.write(sourcePath("core", "skill", `dir${i}`), namedSource(name)),
    );
    const run = box.run(["--target", "claude"]);
    assert.equal(run.status, 0, run.stdout + run.stderr);
    for (const name of names)
      assert.match(run.stdout, new RegExp(`^Building skill: ${name.replace(/[.]/g, "\\.")}$`, "m"));
    assert.deepEqual(
      box.inside().filter((f) => f.startsWith(".claude/skills/")),
      names.map((n) => `.claude/skills/${n}/SKILL.md`).sort(),
    );
    assert.deepEqual(box.leftovers(), []);
  });
});
