// Replaces scripts/tests/test-build-docs-index.sh (spec 0265, row J2): the end-to-end exit-code cases
// of `node scripts/build-docs-index.ts` in a throwaway tree. The rule-by-rule messages, ordering,
// escaping and CRLF behaviour are pinned in docs-index.test.ts; the stderr text is deliberately not
// pinned here beyond the tokens that name the offending page.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, test } from "node:test";

import { childEnv, entryTree, runEntry } from "./lib/docs-index-entry-tree.ts";
import { SKIP_POSIX } from "./lib/worktree-fixtures.ts";

const META = (block: string, h1 = "Alpha"): string =>
  `# ${h1}\n\n<!-- crewrig-doc: ${block} -->\n\nBody.\n`;
const PUB = (nav: string, title: string, section = "reference"): string =>
  META(`section=${section} nav_order=${nav} published=true title="${title}"`, title);
const indexOf = (root: string): string => path.join(root, "docs", "index.json");

describe("build-docs-index entry", () => {
  test("Case 1 — published pages only, nav_order sorted, --check passes on a fresh tree", () => {
    const root = entryTree({
      "docs/a.md": PUB("20", "Alpha"),
      "docs/b.md": PUB("10", "Beta"),
      "docs/c.md": META("published=false", "Gamma"),
    });
    assert.equal(runEntry(root).status, 0, "Case 1a — generate succeeds");
    const doc = JSON.parse(fs.readFileSync(indexOf(root), "utf8")) as {
      sections: { pages: { path: string }[] }[];
    };
    const paths = doc.sections.flatMap((s) => s.pages.map((p) => p.path));
    assert.deepEqual(
      paths,
      ["docs/b.md", "docs/a.md"],
      "Case 1b — published-only, nav_order sorted",
    );
    assert.equal(runEntry(root, "--check").status, 0, "Case 1c — --check passes on fresh tree");
  });

  test("Case 2 — regeneration is byte-identical", () => {
    const root = entryTree({ "docs/a.md": PUB("20", "Alpha"), "docs/b.md": PUB("10", "Beta") });
    assert.equal(runEntry(root).status, 0);
    const first = fs.readFileSync(indexOf(root));
    assert.equal(runEntry(root).status, 0);
    assert.ok(first.length > 0, "the index is not empty");
    assert.ok(first.equals(fs.readFileSync(indexOf(root))), "regeneration drifted");
  });

  test("Case 3 — --check detects drift", () => {
    const root = entryTree({ "docs/a.md": PUB("10", "Alpha") });
    assert.equal(runEntry(root).status, 0);
    fs.appendFileSync(indexOf(root), "drift\n");
    const res = runEntry(root, "--check");
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Drift/);
  });

  const lintCases: [string, string, Record<string, string>][] = [
    [
      "Case 4 — missing required field fails",
      "docs/a.md",
      {
        "docs/a.md": META('section=reference published=true title="Alpha"'),
      },
    ],
    [
      "Case 5 — unknown section fails",
      "docs/a.md",
      {
        "docs/a.md": META('section=nonsense nav_order=10 published=true title="Alpha"'),
      },
    ],
    ["Case 7 — missing metadata block fails", "docs/a.md", { "docs/a.md": "# Alpha\n\nBody.\n" }],
    [
      "Case 8 — forbidden '>' in value fails",
      "docs/a.md",
      {
        "docs/a.md": META('section=reference nav_order=1>0 published=true title="Alpha"'),
      },
    ],
  ];
  for (const [name, page, pages] of lintCases) {
    test(name, () => {
      const res = runEntry(entryTree(pages));
      assert.equal(res.status, 1);
      assert.notEqual(res.stderr.trim(), "", "stderr is not empty");
      assert.ok(res.stderr.includes(page), `stderr names ${page}`);
    });
  }

  test("Case 6 — orphan manifest entry fails", () => {
    const root = entryTree({ "docs/a.md": PUB("10", "Alpha") });
    assert.equal(runEntry(root).status, 0);
    const text = fs.readFileSync(indexOf(root), "utf8");
    assert.ok(text.includes('"docs/a.md"'), "the generated index names docs/a.md");
    fs.writeFileSync(indexOf(root), text.replaceAll('"docs/a.md"', '"docs/ghost.md"'));
    const res = runEntry(root, "--check");
    assert.equal(res.status, 1);
    assert.ok(res.stderr.includes("docs/ghost.md"), "stderr names the orphan");
  });

  test("Case 9 — a decoy block before the H1 is ignored; the real block wins", () => {
    const root = entryTree({
      "docs/real.md":
        '<!-- crewrig-doc: section=concepts nav_order=5 published=true title="DECOY" -->\n\n' +
        '# Real Page\n\n<!-- crewrig-doc: section=reference nav_order=30 published=true title="Real Page" -->\n\nBody.\n',
    });
    assert.equal(runEntry(root).status, 0, "Case 9a — generate succeeds with decoy before H1");
    const text = fs.readFileSync(indexOf(root), "utf8");
    const section = /"section":\s*"([a-z-]+)"/.exec(text)?.[1];
    assert.equal(section, "reference", "Case 9b — real block after H1 wins over pre-H1 decoy");
    assert.equal(text.includes("DECOY"), false, "Case 9c — pre-H1 decoy absent from index");
  });
  test(
    "the forwarding shim reaches the entry with the same exit status",
    { skip: SKIP_POSIX },
    () => {
      const root = entryTree({ "docs/a.md": PUB("10", "Alpha") });
      const run = (...args: string[]) =>
        spawnSync("bash", ["scripts/build-docs-index.sh", ...args], {
          cwd: root,
          env: childEnv(),
          encoding: "utf8",
        });
      assert.equal(run().status, 0);
      assert.equal(run("--check").status, 0);
      fs.appendFileSync(indexOf(root), "drift\n");
      assert.equal(run("--check").status, 1);
    },
  );
});
