// docs-index.test.ts — the documentation index modules, run in process on temp trees (spec 0257
// R5-R8). The entry-level proof against the goldens lives in packaging-release-differential.test.ts.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { main } from "../lib/docs-index/main.ts";
import { docsRoot, memoryIo, page, published } from "./lib/docs-index-trees.ts";
import type { FileMap } from "./lib/docs-index-trees.ts";

interface Run {
  readonly code: number;
  readonly out: string[];
  readonly err: string[];
  readonly root: string;
}

async function run(files: FileMap, argv: readonly string[] = []): Promise<Run> {
  const root = docsRoot(files);
  return runIn(root, argv);
}

async function runIn(root: string, argv: readonly string[] = []): Promise<Run> {
  const { io, out, err } = memoryIo();
  const code = await main({ argv, repoRoot: root, io });
  return { code, out, err, root };
}

function indexOf(root: string): string {
  return fs.readFileSync(path.join(root, "docs", "index.json"), "utf8");
}

function pagesOf(text: string): { path: string; title: string; nav_order: number }[] {
  const parsed = JSON.parse(text) as {
    sections: { pages: { path: string; title: string; nav_order: number }[] }[];
  };
  return parsed.sections.flatMap((section) => section.pages);
}

function violations(result: Run): string[] {
  assert.equal(result.code, 1);
  assert.equal(result.err[0], "Documentation publication contract violations:");
  return result.err.slice(1).map((line) => line.replace(/^ {2}- /, ""));
}

describe("extraction", () => {
  test("the last crewrig-doc: marker on the line wins", async () => {
    const r = await run({
      "docs/a.md": [
        "# T",
        "<!-- crewrig-doc: published=false crewrig-doc: section=concepts nav_order=1 published=true title=X -->",
      ].join("\n"),
    });
    assert.equal(r.code, 0, r.err.join("\n"));
    assert.deepEqual(pagesOf(indexOf(r.root)), [{ path: "docs/a.md", title: "X", nav_order: 1 }]);
  });

  test("the payload is cut at the first -->", async () => {
    const r = await run({
      "docs/a.md":
        "# T\n<!-- crewrig-doc: section=concepts nav_order=1 published=true title=X --> trailing --> more\n",
    });
    assert.equal(r.code, 0, r.err.join("\n"));
  });

  test("a marker before the H1 is ignored and the block is the first line after it", async () => {
    const r = await run({
      "docs/a.md":
        "<!-- crewrig-doc: published=false -->\n# T\ntext\n<!-- crewrig-doc: section=concepts nav_order=2 published=true title=Y -->\n<!-- crewrig-doc: published=false -->\n",
    });
    assert.deepEqual(
      pagesOf(indexOf(r.root)).map((p) => p.title),
      ["Y"],
    );
  });

  test("a key with spaces before the = is an unknown key", async () => {
    const r = await run({ "docs/a.md": page("published = true") });
    assert.deepEqual(violations(r), ["docs/a.md: unknown metadata key 'published '"]);
  });

  test("quoted titles keep their spaces and bare tokens stop at whitespace", async () => {
    const r = await run({
      "docs/a.md": page('title="A  spaced title" section=concepts nav_order=1 published=true'),
    });
    assert.equal(pagesOf(indexOf(r.root))[0]?.title, "A  spaced title");
  });

  test("CRLF pages produce the rows of the LF pages", async () => {
    const lf = await run({
      "docs/a.md": published("concepts", "1", "One"),
      "docs/b.md": published("adoption", "2", "Two"),
    });
    const crlf = await run({
      "docs/a.md": published("concepts", "1", "One", "\r\n"),
      "docs/b.md": published("adoption", "2", "Two", "\r\n"),
    });
    assert.equal(indexOf(crlf.root), indexOf(lf.root));
  });
});

describe("rendering", () => {
  test("multi-digit and equal nav_order sort numerically, then by path bytes", async () => {
    const r = await run({
      "docs/ten.md": published("concepts", "10", "ten"),
      "docs/two.md": published("concepts", "2", "two"),
      "docs/b.md": published("concepts", "5", "b"),
      "docs/a/z.md": published("concepts", "5", "a-slash"),
      "docs/a.md": published("concepts", "5", "a-dot"),
      "docs/huge-b.md": published("concepts", "123456789012345678901234567891", "huge-b"),
      "docs/huge-a.md": published("concepts", "123456789012345678901234567890", "huge-a"),
    });
    assert.deepEqual(
      pagesOf(indexOf(r.root)).map((p) => p.title),
      ["two", "a-dot", "a-slash", "b", "ten", "huge-a", "huge-b"],
    );
  });

  test("sections follow the taxonomy order and appear only when non-empty", async () => {
    const r = await run({
      "docs/r.md": published("reference", "1", "r"),
      "docs/i.md": published("introduction", "1", "i"),
    });
    const sections = (JSON.parse(indexOf(r.root)) as { sections: { section: string }[] }).sections;
    assert.deepEqual(
      sections.map((s) => s.section),
      ["introduction", "reference"],
    );
  });

  test("the exact text: key order, indentation and one trailing line feed", async () => {
    const r = await run({ "docs/a.md": published("architecture-adr", "3", "Q") });
    assert.equal(
      indexOf(r.root),
      [
        "{",
        '  "version": 1,',
        '  "sections": [',
        "    {",
        '      "section": "architecture-adr",',
        '      "title": "Architecture & ADRs",',
        '      "pages": [',
        "        {",
        '          "title": "Q",',
        '          "path": "docs/a.md",',
        '          "nav_order": 3',
        "        }",
        "      ]",
        "    }",
        "  ]",
        "}",
        "",
      ].join("\n"),
    );
  });

  test("an empty row set keeps the blank line between the brackets", async () => {
    const r = await run({ "docs/a.md": page("published=false") });
    assert.equal(indexOf(r.root), '{\n  "version": 1,\n  "sections": [\n\n  ]\n}\n');
    assert.deepEqual(r.out, ["Wrote docs/index.json (0 published pages)."]);
  });

  test("the written file has LF only, even for CRLF pages", async () => {
    const r = await run({
      "docs/a.md": published("concepts", "1", "One", "\r\n"),
    });
    const bytes = fs.readFileSync(path.join(r.root, "docs", "index.json"));
    assert.ok(!bytes.includes(13));
    assert.equal(bytes.at(-1), 10);
    assert.notEqual(bytes.at(-2), 10);
  });

  test("backslashes in titles and paths are escaped", async () => {
    const r = await run({ "docs/a.md": published("concepts", "1", "back\\slash") });
    assert.equal(pagesOf(indexOf(r.root))[0]?.title, "back\\slash");
  });
});

describe("lint", () => {
  test("every rule reports its verbatim message, in file order", async () => {
    const r = await run({
      "docs/01-none.md": "# T\n\nbody\n",
      "docs/02-noeq.md": page("published"),
      "docs/03-unterminated.md": page('title="oops'),
      "docs/04-forbidden.md": page("title=a>b"),
      "docs/05-quote.md": page('title=a"b'),
      "docs/06-unknown.md": page("colour=red"),
      "docs/07-nopub.md": page("section=concepts"),
      "docs/08-badpub.md": page("published=yes"),
      "docs/09-missing.md": page("published=true"),
      "docs/10-badsection.md": page("published=true title=t section=nope nav_order=1"),
      "docs/11-badnav.md": page("published=true title=t section=concepts nav_order=-1"),
      "docs/12-emptynav.md": page("published=true title=t section=concepts nav_order="),
      "docs/13-unpublished.md": page("published=false bogus=1"),
    });
    assert.equal(fs.existsSync(path.join(r.root, "docs", "index.json")), false, "nothing written");
    assert.deepEqual(violations(r), [
      "docs/01-none.md: no crewrig-doc metadata block found",
      "docs/02-noeq.md: malformed metadata token (no '='): 'published'",
      "docs/03-unterminated.md: unterminated quoted value for key 'title'",
      "docs/04-forbidden.md: value for key 'title' contains a forbidden '\"' or '>' character",
      "docs/05-quote.md: value for key 'title' contains a forbidden '\"' or '>' character",
      "docs/06-unknown.md: unknown metadata key 'colour'",
      "docs/07-nopub.md: metadata block missing required field 'published'",
      "docs/08-badpub.md: 'published' must be 'true' or 'false', got 'yes'",
      "docs/09-missing.md: published page missing required field 'title'",
      "docs/09-missing.md: published page missing required field 'section'",
      "docs/09-missing.md: published page missing required field 'nav_order'",
      "docs/10-badsection.md: unknown section 'nope'",
      "docs/11-badnav.md: nav_order must be a non-negative integer, got '-1'",
      "docs/12-emptynav.md: nav_order must be a non-negative integer, got ''",
      "docs/13-unpublished.md: unknown metadata key 'bogus'",
    ]);
  });

  test("an orphan entry of the committed manifest is reported after the page errors", async () => {
    const r = await run({
      "docs/a.md": "# T\n",
      "docs/index.json": '{"path": "docs/a.md",\n"path":   "docs/gone.md", "path": ""}\n',
    });
    assert.deepEqual(violations(r), [
      "docs/a.md: no crewrig-doc metadata block found",
      "docs/index.json: entry path 'docs/gone.md' does not resolve to a file (orphan)",
    ]);
  });

  test("symlinked pages are not scanned", async () => {
    const root = docsRoot({
      "docs/real.md": published("concepts", "1", "Real"),
      "outside.md": "# T\n",
    });
    fs.symlinkSync(path.join(root, "outside.md"), path.join(root, "docs", "link.md"));
    const r = await runIn(root);
    assert.equal(r.code, 0, r.err.join("\n"));
    assert.deepEqual(
      pagesOf(indexOf(root)).map((p) => p.path),
      ["docs/real.md"],
    );
  });
});

describe("arguments and check mode", () => {
  test("an unknown argument is a usage error", async () => {
    const r = await run({ "docs/a.md": "# T\n" }, ["--nope"]);
    assert.equal(r.code, 2);
    assert.deepEqual(r.err, ["Usage: build-docs-index [--check]"]);
  });

  test("a missing docs directory is exit 2", async () => {
    const r = await run({ "x.txt": "" }, ["--check"]);
    assert.equal(r.code, 2);
    assert.deepEqual(r.err, [`Error: docs directory not found at ${r.root}/docs`]);
  });

  test("check passes right after a write", async () => {
    const files = { "docs/a.md": published("concepts", "1", "One") };
    const root = docsRoot(files);
    assert.equal((await runIn(root)).code, 0);
    const r = await runIn(root, ["--check"]);
    assert.equal(r.code, 0);
    assert.deepEqual(r.out, ["OK: docs/index.json is up to date (1 published pages)."]);
  });

  test("check reports a stale manifest with the differing lines", async () => {
    const root = docsRoot({ "docs/a.md": published("concepts", "1", "One") });
    await runIn(root);
    fs.writeFileSync(
      path.join(root, "docs", "index.json"),
      indexOf(root).replace('"title": "One"', '"title": "Old"'),
    );
    const r = await runIn(root, ["--check"]);
    assert.equal(r.code, 1);
    assert.deepEqual(r.err, [
      "Drift: docs/index.json is stale. Re-run: node scripts/build-docs-index.ts",
      '-          "title": "Old",',
      '+          "title": "One",',
    ]);
  });

  test("check reports a missing manifest", async () => {
    const r = await run({ "docs/a.md": published("concepts", "1", "One") }, ["--check"]);
    assert.equal(r.code, 1);
    assert.deepEqual(r.err, [
      "Drift: docs/index.json is missing. Run: node scripts/build-docs-index.ts",
    ]);
  });

  test("a CRLF manifest is stale: the comparison is byte exact", async () => {
    const root = docsRoot({ "docs/a.md": published("concepts", "1", "One") });
    await runIn(root);
    fs.writeFileSync(path.join(root, "docs", "index.json"), indexOf(root).replaceAll("\n", "\r\n"));
    assert.equal((await runIn(root, ["--check"])).code, 1);
  });
});
