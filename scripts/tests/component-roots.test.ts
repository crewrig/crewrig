// component-roots.test.ts — unit suite for scripts/lib/component-roots.ts (spec 0255, row F2).
//
// Written from reading scripts/lib/component-resolve.sh (the oracle): tier order, the
// candidate order of one root, the code-unit order of a listing, and the exact report.
// The Linux-only conformance against the shell lives in component-twins-conformance.test.ts.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import {
  COMPONENT_OVERLAY_TIERS,
  enumerateComponentsInRoots,
  readLines,
  reportUnresolved,
  resolveComponentInRoots,
  setArtifactRoots,
  setStagingRoots,
} from "../lib/component-roots.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "component-roots-test-"));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** A fresh repository root with each `rel` created: a trailing `/` makes a directory. */
function repo(...rels: string[]): string {
  const root = fs.mkdtempSync(path.join(tmp, "r"));
  for (const rel of rels) {
    const target = path.join(root, rel);
    if (rel.endsWith("/")) fs.mkdirSync(target, { recursive: true });
    else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, "x");
    }
  }
  return root;
}

function report(name: string, type: string, roots: string[]): string {
  const chunks: string[] = [];
  reportUnresolved(name, type, roots, (text) => chunks.push(text));
  assert.equal(chunks.length, 1, "a report is written once");
  return chunks[0] ?? "";
}

describe("COMPONENT_OVERLAY_TIERS", () => {
  test("serves library, community, org in order, never core", () => {
    assert.deepEqual([...COMPONENT_OVERLAY_TIERS], ["library", "community", "org"]);
  });
});

describe("setStagingRoots and setArtifactRoots", () => {
  test("staging roots: one per tier, in tier order, present or not", () => {
    assert.deepEqual(setStagingRoots("/r", ".claude/skills"), [
      "/r/dist/library/.claude/skills",
      "/r/dist/community/.claude/skills",
      "/r/dist/org/.claude/skills",
    ]);
  });

  test("artifact roots: authoring sources of the same three tiers", () => {
    assert.deepEqual(setArtifactRoots("/r", "policies"), [
      "/r/artifacts/library/policies",
      "/r/artifacts/community/policies",
      "/r/artifacts/org/policies",
    ]);
  });

  test("an empty repository directory fails loudly instead of rooting at /", () => {
    assert.throws(() => setStagingRoots("", "x"), /repository directory/);
    assert.throws(() => setArtifactRoots("", "x"), /repository directory/);
  });
});

describe("readLines", () => {
  test("keeps non-empty lines in order, with their whitespace", () => {
    assert.deepEqual(readLines("a\n\n b \nc"), ["a", " b ", "c"]);
  });

  test("empty text and blank lines yield nothing", () => {
    assert.deepEqual(readLines(""), []);
    assert.deepEqual(readLines("\n\n"), []);
  });
});

describe("resolveComponentInRoots", () => {
  test("a name found in two roots yields both, in root order", () => {
    const r = repo("dist/library/s/foo/SKILL.md", "dist/org/s/foo/SKILL.md");
    const roots = ["library", "community", "org"].map((t) => path.join(r, "dist", t, "s"));
    assert.deepEqual(resolveComponentInRoots("foo", roots), [
      path.join(r, "dist/library/s/foo"),
      path.join(r, "dist/org/s/foo"),
    ]);
  });

  test("within one root the first candidate wins: bare name, .md, .toml, .json", () => {
    const r = repo("a/n", "a/n.md", "b/n.md", "b/n.toml", "c/n.toml", "c/n.json", "d/n.json");
    const roots = ["a", "b", "c", "d"].map((d) => path.join(r, d));
    assert.deepEqual(resolveComponentInRoots("n", roots), [
      path.join(r, "a/n"),
      path.join(r, "b/n.md"),
      path.join(r, "c/n.toml"),
      path.join(r, "d/n.json"),
    ]);
  });

  test("an absent root is skipped and a miss is the empty list", () => {
    const r = repo("a/other");
    assert.deepEqual(resolveComponentInRoots("n", [path.join(r, "gone"), path.join(r, "a")]), []);
  });

  test("a dangling link is not a candidate", () => {
    const r = repo("a/");
    fs.symlinkSync(path.join(r, "nowhere"), path.join(r, "a/n"));
    assert.deepEqual(resolveComponentInRoots("n", [path.join(r, "a")]), []);
  });
});

describe("enumerateComponentsInRoots", () => {
  test("lists every member of every present root in code-unit order, no dedupe", () => {
    const r = repo("a/alpha/SKILL.md", "a/Zed/SKILL.md", "a/z.md", "c/alpha/SKILL.md");
    const roots = [path.join(r, "a"), path.join(r, "missing"), path.join(r, "c")];
    assert.deepEqual(enumerateComponentsInRoots(roots), [
      { base: "Zed", path: path.join(r, "a/Zed") },
      { base: "alpha", path: path.join(r, "a/alpha") },
      { base: "z.md", path: path.join(r, "a/z.md") },
      { base: "alpha", path: path.join(r, "c/alpha") },
    ]);
  });

  test("skips .gitkeep and other hidden names, and a path has no trailing slash", () => {
    const r = repo("a/.gitkeep", "a/.hidden", "a/skill/SKILL.md");
    const entries = enumerateComponentsInRoots([path.join(r, "a")]);
    assert.deepEqual(entries, [{ base: "skill", path: path.join(r, "a/skill") }]);
    assert.ok(!(entries[0]?.path ?? "").endsWith("/"));
  });

  test("skips a dangling link and an empty root", () => {
    const r = repo("a/", "b/");
    fs.symlinkSync(path.join(r, "nowhere"), path.join(r, "a/dead"));
    assert.deepEqual(enumerateComponentsInRoots([path.join(r, "a"), path.join(r, "b")]), []);
  });

  test("a staged overlay is read through staging roots", () => {
    const r = repo("dist/org/.claude/skills/mine/SKILL.md", "dist/library/.claude/skills/");
    assert.deepEqual(enumerateComponentsInRoots(setStagingRoots(r, ".claude/skills")), [
      { base: "mine", path: `${r}/dist/org/.claude/skills/mine` },
    ]);
  });
});

describe("reportUnresolved", () => {
  test("names every root with its state and omits the build hint when one is present", () => {
    const r = repo("a/");
    const roots = [path.join(r, "a"), path.join(r, "gone")];
    assert.equal(
      report("foo", "skills", roots),
      "Error: no component named 'foo' of type 'skills' resolved in any served tier.\n" +
        "Locations examined, in resolution order:\n" +
        `  - ${roots[0]} (present)\n` +
        `  - ${roots[1]} (absent)\n`,
    );
  });

  test("blames a missing build only when no served root existed at all", () => {
    const roots = setArtifactRoots(repo(), "hooks");
    assert.equal(
      report("h", "hooks", roots),
      "Error: no component named 'h' of type 'hooks' resolved in any served tier.\n" +
        "Locations examined, in resolution order:\n" +
        roots.map((root) => `  - ${root} (absent)\n`).join("") +
        "No served tier of this type was available at all. Populate one, or run:\n" +
        "  bash scripts/build-components.sh\n",
    );
  });

  test("an empty root list still reports, with the build hint", () => {
    assert.match(
      report("n", "t", []),
      /^Error: .*\nLocations examined.*\nNo served tier .*\n {2}bash /,
    );
  });

  test("defaults to standard error and prints the name unescaped, as printf %s does", () => {
    const written: string[] = [];
    const original = process.stderr.write;
    process.stderr.write = ((chunk: string) => (written.push(String(chunk)), true)) as never;
    try {
      reportUnresolved("a\tb", "t", []);
    } finally {
      process.stderr.write = original;
    }
    assert.match(written.join(""), /named 'a\tb' of type/);
  });
});
