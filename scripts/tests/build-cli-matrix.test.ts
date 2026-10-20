// build-cli-matrix.test.ts — the CLI-matrix generator of spec 0272: row print, unknown id,
// freshness check, determinism (locale, cwd), CRLF input, manifest/source mismatches, the
// generated-file comment position, heading offsets and the link rewrite. Fixture trees live in
// fs.mkdtempSync directories removed after each test; the real tree is only read. No assertion
// depends on how the sources are wrapped.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, test } from "node:test";

import { assemble, GENERATED_COMMENT } from "../lib/build-cli-matrix/assemble.ts";
import { readManifest } from "../lib/build-cli-matrix/manifest.ts";
import { demoteHeadings, rewriteLinks } from "../lib/build-cli-matrix/transform.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const CLI = path.join(REPO, "scripts", "build-cli-matrix.ts");
const NODE_ARGS = ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", CLI];

function run(args: string[], opts: { cwd?: string; env?: Record<string, string> } = {}) {
  return spawnSync(process.execPath, [...NODE_ARGS, ...args], {
    cwd: opts.cwd ?? REPO,
    env: { ...process.env, ...opts.env },
    encoding: "utf8",
  });
}

const made: string[] = [];
afterEach(() => {
  while (made.length > 0) fs.rmSync(made.pop()!, { recursive: true, force: true });
});

type Tree = Record<string, string>;

const BASE: Tree = {
  "intro.md":
    "# CLI Support Matrix\n\n<!-- crewrig-doc: section=reference -->\n\nLead paragraph.\n",
  "supported-clis.md": "# Supported CLIs\n\nText.\n",
  "feature-matrix.md": "# Feature matrix\n\n## Sub\n\nBody.\n",
  "rows/1.md": "# 1 — First\n\n- Claude Code: yes\n",
  "rows/7g.md": "# 7g — Dup\n\n- a\n",
  "rows/7g-2.md": "# 7g — Dup again\n\n- b\n",
  "notes.md": "# Notes\n\nNote text.\n",
  "parity-gaps.md": "# Parity gaps\n\n- [GAP] x\n",
  "adding-a-cli.md": "# Adding a CLI\n\nSteps.\n",
};
const ORDER = [
  "intro.md",
  "supported-clis.md",
  "feature-matrix.md",
  "1.md",
  "7g.md",
  "7g-2.md",
  "notes.md",
  "parity-gaps.md",
  "adding-a-cli.md",
];

/** Write a fixture source tree under a fresh mkdtemp directory; returns its path. */
function tree(files: Tree = {}, order: string[] = ORDER, eol = "\n"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-matrix-"));
  made.push(dir);
  fs.mkdirSync(path.join(dir, "rows"));
  const all = { ...BASE, ...files };
  for (const [rel, text] of Object.entries(all)) {
    if (text === "") continue;
    fs.writeFileSync(path.join(dir, rel), text.replace(/\n/g, eol));
  }
  fs.writeFileSync(path.join(dir, "order.txt"), `${order.join("\n")}\n`.replace(/\n/g, eol));
  return dir;
}

describe("assemble: structure", () => {
  test("parts are joined by one blank line and the output ends with exactly one newline", () => {
    const out = assemble(tree());
    assert.ok(out.endsWith("\n") && !out.endsWith("\n\n"));
    assert.ok(!/\n\n\n/.test(out), "no run of two blank lines");
    const heads = out.split("\n").filter((l) => /^#{1,6} /.test(l));
    assert.deepEqual(heads, [
      "# CLI Support Matrix",
      "## Supported CLIs",
      "## Feature matrix",
      "### Sub",
      "### 1 — First",
      "### 7g — Dup",
      "### 7g — Dup again",
      "## Parity gaps",
      "## Adding a CLI",
    ]);
  });

  test("the generated-file comment is on line 5, after the marker line and a blank", () => {
    const lines = assemble(tree()).split("\n");
    assert.equal(lines[2], "<!-- crewrig-doc: section=reference -->");
    assert.equal(lines[3], "");
    assert.equal(lines[4], GENERATED_COMMENT);
    assert.equal(lines[5], "");
    assert.equal(lines[6], "Lead paragraph.");
  });

  test("notes.md's source-only H1 is consumed, its text kept", () => {
    const out = assemble(tree());
    assert.ok(!out.includes("Notes\n"), "title not emitted");
    assert.ok(out.includes("Note text."));
  });

  test("both 7g rows are emitted, in manifest order", () => {
    const out = assemble(tree());
    assert.ok(out.indexOf("### 7g — Dup\n") < out.indexOf("### 7g — Dup again"));
  });

  test("a reordered manifest reorders the output", () => {
    const swapped = [...ORDER];
    [swapped[4], swapped[5]] = [swapped[5]!, swapped[4]!];
    const out = assemble(tree({}, swapped));
    assert.ok(out.indexOf("### 7g — Dup again") < out.indexOf("### 7g — Dup\n"));
  });

  test("CRLF sources and CRLF manifest give byte-identical output to LF", () => {
    const lf = assemble(tree());
    const crlf = assemble(tree({}, ORDER, "\r\n"));
    assert.equal(crlf, lf);
    assert.ok(!crlf.includes("\r"));
  });

  test("a bare CR line ending is normalised too", () => {
    const out = assemble(tree({ "rows/1.md": "# 1 — First\r\r- Claude Code: yes\r" }));
    assert.ok(!out.includes("\r"));
    assert.ok(out.includes("### 1 — First\n\n- Claude Code: yes\n"));
  });

  test("a missing blank line after the intro marker fails", () => {
    const dir = tree({ "intro.md": "# T\n\n<!-- crewrig-doc: a=b -->\nText\n" });
    assert.throws(() => assemble(dir), /blank line after the crewrig-doc marker/);
  });

  test("a part without a level-1 heading fails", () => {
    assert.throws(() => assemble(tree({ "rows/1.md": "- no heading\n" })), /level-1 heading/);
  });
});

describe("manifest and source-tree validation", () => {
  test("a manifest entry without a file fails", () => {
    const order = [...ORDER.slice(0, 4), "ghost.md", ...ORDER.slice(4)];
    assert.throws(() => readManifest(tree({}, order)), /"ghost.md" has no file/);
  });

  test("an orphan row file absent from the manifest fails", () => {
    const dir = tree({ "rows/orphan.md": "# orphan — x\n" });
    assert.throws(() => readManifest(dir), /"orphan.md" is absent from order.txt/);
  });

  test("an orphan fragment file absent from the manifest fails", () => {
    const dir = tree({});
    fs.writeFileSync(path.join(dir, "extra.md"), "# Extra\n");
    assert.throws(() => readManifest(dir), /"extra.md" is absent from order.txt/);
  });

  test("removing a row from the manifest while its file remains fails", () => {
    const order = ORDER.filter((n) => n !== "7g-2.md");
    assert.throws(() => readManifest(tree({}, order)), /"7g-2.md" is absent from order.txt/);
  });

  test("a duplicate manifest entry fails", () => {
    const order = [...ORDER.slice(0, 5), "7g.md", ...ORDER.slice(5)];
    assert.throws(() => readManifest(tree({}, order)), /duplicate entry "7g.md"/);
  });

  test("a path-like entry fails", () => {
    const order = [...ORDER.slice(0, 3), "rows/1.md", ...ORDER.slice(4)];
    assert.throws(() => readManifest(tree({}, order)), /invalid entry/);
  });

  test("misplaced leading or trailing fragments fail", () => {
    const order = [ORDER[1]!, ORDER[0]!, ...ORDER.slice(2)];
    assert.throws(() => readManifest(tree({}, order)), /must start with/);
  });

  test("blank lines in the manifest are ignored", () => {
    const dir = tree();
    fs.writeFileSync(path.join(dir, "order.txt"), `\n${ORDER.join("\n\n")}\n\n`);
    assert.equal(readManifest(dir).length, ORDER.length);
  });
});

describe("demoteHeadings", () => {
  test("offset 0 is the identity", () => {
    assert.equal(demoteHeadings("# A\n", 0, "t"), "# A\n");
  });

  test("an H1 becomes ### at offset 2 and deeper headings shift equally", () => {
    assert.equal(demoteHeadings("# A\n\n## B\n\n#### C", 2, "t"), "### A\n\n#### B\n\n###### C");
  });

  test("a # line inside a fenced block is untouched, including a longer outer fence", () => {
    const text = "# A\n\n```sh\n# comment\n```\n\n````md\n```\n# nested\n```\n````\n\n## B";
    const out = demoteHeadings(text, 1, "t");
    assert.ok(out.includes("```sh\n# comment\n```"));
    assert.ok(out.includes("# nested"));
    assert.ok(!out.includes("## nested"));
    assert.ok(out.startsWith("## A") && out.endsWith("### B"));
  });

  test("a tilde fence is honoured and a hash without a space is not a heading", () => {
    const out = demoteHeadings("~~~\n# x\n~~~\n#hashtag\n# y", 1, "t");
    assert.equal(out, "~~~\n# x\n~~~\n#hashtag\n## y");
  });

  test("demoting past level 6 fails", () => {
    assert.throws(() => demoteHeadings("##### deep", 2, "row.md"), /past level 6/);
  });
});

describe("rewriteLinks", () => {
  const rw = (text: string, prefix = "../../") => rewriteLinks(text, prefix, "row.md");

  test("a ../ target of a row strips exactly the part prefix", () => {
    assert.equal(rw("[s](../../../specs/x.md)"), "[s](../specs/x.md)");
    assert.equal(rw("[a](../../a.md)"), "[a](a.md)");
    assert.equal(rw("[a](../a.md)", "../"), "[a](a.md)");
  });

  test("the #fragment suffix survives", () => {
    assert.equal(rw("[a](../../a.md#x)"), "[a](a.md#x)");
  });

  test("a bare anchor is untouched", () => {
    assert.equal(rw("[a](#x)"), "[a](#x)");
  });

  test("http, https, mailto and absolute targets are untouched", () => {
    const text = "[a](http://x.io/a) [b](https://x.io) [c](mailto:a@b.c) [d](/abs/path)";
    assert.equal(rw(text), text);
  });

  test("a ]( inside an inline code span is untouched, also with a double-backtick span", () => {
    const text = "`[a](../../x.md)` and ``[b](../../y.md)`` then [c](../../z.md)";
    assert.equal(rw(text), "`[a](../../x.md)` and ``[b](../../y.md)`` then [c](z.md)");
  });

  test("a ]( inside a fenced block is untouched", () => {
    const text = "```\n[a](../../x.md)\n```\n[b](../../y.md)";
    assert.equal(rw(text), "```\n[a](../../x.md)\n```\n[b](y.md)");
  });

  test("link text wrapped across a line is rewritten", () => {
    assert.equal(
      rw("see [the long\n  link text](../../docs/a.md#h) now"),
      "see [the long\n  link text](docs/a.md#h) now",
    );
  });

  test("several links on one line are all rewritten", () => {
    assert.equal(rw("[a](../../a.md) [b](../../b.md)"), "[a](a.md) [b](b.md)");
  });

  test("a target lacking the expected prefix fails and names the part", () => {
    assert.throws(
      () => rw("[a](docs/a.md)"),
      /row\.md: link target "docs\/a\.md" lacks the expected prefix/,
    );
    assert.throws(() => rw("[a](../a.md)"), /lacks the expected prefix/);
  });

  test("an unterminated code span does not swallow the rest of the line", () => {
    assert.equal(rw("`open [a](../../a.md)"), "`open [a](a.md)");
  });
});

describe("assemble: link rewrite end to end", () => {
  test("row and fragment links are restored to docs-relative form", () => {
    const out = assemble(
      tree({
        "rows/1.md": "# 1 — First\n\n- see [spec](../../../specs/x.md) and [doc](../../x.md#a)\n",
        "feature-matrix.md": "# Feature matrix\n\nSee [d](../docs/y.md).\n",
      }),
    );
    assert.ok(out.includes("[spec](../specs/x.md)"));
    assert.ok(out.includes("[doc](x.md#a)"));
    assert.ok(out.includes("[d](docs/y.md)"));
  });

  test("a wrongly prefixed link in a source fails the build", () => {
    assert.throws(
      () => assemble(tree({ "rows/1.md": "# 1 — First\n\n[x](../x.md)\n" })),
      /lacks the expected prefix/,
    );
  });
});

describe("CLI against the real tree", () => {
  test("--check exits 0: docs/cli-matrix.md is fresh", () => {
    const r = run(["--check"]);
    assert.equal(r.status, 0, r.stderr);
  });

  test("row prints one row source verbatim", () => {
    const r = run(["row", "37e"]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(
      r.stdout,
      fs.readFileSync(path.join(REPO, "docs", "cli-matrix", "rows", "37e.md"), "utf8"),
    );
  });

  test("row resolves the duplicate 7g id to 7g.md", () => {
    const r = run(["row", "7g"]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(
      r.stdout,
      fs.readFileSync(path.join(REPO, "docs", "cli-matrix", "rows", "7g.md"), "utf8"),
    );
    assert.ok(r.stdout.startsWith("# 7g — "));
  });

  test("row 7g-2 resolves to its own file", () => {
    const r = run(["row", "7g-2"]);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.startsWith("# 7g — "));
    assert.notEqual(r.stdout, run(["row", "7g"]).stdout);
  });

  test("an unknown row id exits 1, lists valid ids on stderr and prints nothing on stdout", () => {
    const r = run(["row", "nope-999"]);
    assert.equal(r.status, 1);
    assert.equal(r.stdout, "");
    assert.match(r.stderr, /Unknown row id "nope-999"/);
    assert.match(r.stderr, /\b37e\b/);
  });

  test("bad usage exits 2", () => {
    for (const args of [["--bogus"], ["row"], ["row", "a", "b"], ["--check", "x"]]) {
      assert.equal(run(args).status, 2, args.join(" "));
    }
  });

  test("the output is independent of the working directory and of the locale", () => {
    const base = run(["--check"]);
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "cli-matrix-cwd-"));
    made.push(other);
    const elsewhere = run(["--check"], { cwd: other });
    const c = run(["--check"], { env: { LC_ALL: "C" } });
    const fr = run(["--check"], { env: { LC_ALL: "fr_FR.UTF-8", LANG: "fr_FR.UTF-8" } });
    for (const r of [base, elsewhere, c, fr]) assert.equal(r.status, 0, r.stderr);
    assert.equal(run(["row", "37e"], { cwd: other }).stdout, run(["row", "37e"]).stdout);
  });

  test("assemble is idempotent: two runs give the same bytes and match the published file", () => {
    const dir = path.join(REPO, "docs", "cli-matrix");
    const first = assemble(dir);
    assert.equal(assemble(dir), first);
    assert.equal(first, fs.readFileSync(path.join(REPO, "docs", "cli-matrix.md"), "utf8"));
    assert.equal(first.split("\n")[4], GENERATED_COMMENT);
  });
});
