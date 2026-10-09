// build-components-differential-cli.test.ts — configuration, `--resolve`, `--diagnostics`,
// `--list-output-dirs` and the organisation merge: the unchanged shell script against the
// entry, no deviation (spec 0250 R5, R6, R7, R8, R20; plan step 22). Linux gate or
// CREWRIG_SHELL_PARITY=1; retires in PR D. Harness: fixtures/build-components/differential-*.ts.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { compare, expectSame } from "./fixtures/build-components/differential-compare.ts";
import {
  makePair,
  normalise,
  runShell,
  runTs,
} from "./fixtures/build-components/differential-kit.ts";
import { orgMapping } from "./fixtures/build-components/entry-kit.ts";
import { rich, small } from "./fixtures/build-components/differential-trees.ts";
import { yamlLib } from "./lib/yaml-lib.ts";
import { parityGate } from "./lib/shell-resolve-harness.ts";

const SKIP = parityGate();
const TARGET = ["--target", "claude"];

describe("canonical_repo and the configuration file (R7)", { skip: SKIP }, () => {
  for (const repo of [
    "file:///tmp/foo",
    "https://h/o/r/extra",
    "http://h/o/r",
    "https://h/o",
    "https://h//r",
    "https://h/o/r x",
  ]) {
    test(`malformed canonical_repo ${repo}: exit 1, two lines on standard error, nothing written`, () => {
      const { ts } = compare(makePair(small(`canonical_repo = "${repo}"\n`)), { args: TARGET });
      assert.equal(ts.status, 1);
      assert.equal(ts.stdout, "");
      assert.match(ts.stderr, /^Error: canonical_repo in crewrig\.config\.toml is malformed: /);
    });
  }

  test("a well-formed value, with and without the trailing slash, builds", () => {
    for (const repo of ["https://h/o/r", "https://h/o/r/", "https://host.example:8443/o/r"]) {
      const { ts } = compare(makePair(small(`canonical_repo = "${repo}"\n`)), { args: TARGET });
      assert.equal(ts.status, 0, repo);
    }
  });

  test("a missing file warns and leaves placeholders literal", () => {
    const { ts } = compare(makePair(small(null)), { args: TARGET });
    assert.match(
      ts.stderr,
      /^Warning: <ROOT>\/crewrig\.config\.toml not found — placeholders will be left literal\.\n/,
    );
    assert.equal(ts.status, 0);
  });

  const texts: Array<[string, string]> = [
    [
      "CRLF line endings",
      'canonical_repo = "https://h/o/r"\r\nfeedback_repo = "https://h/o/f"\r\n',
    ],
    [
      "quotes, blanks, comments and a table-less layout",
      '# c\n\n  canonical_repo   =   "https://h/o/r"  \n feedback_repo="https://h/o/f"\n',
    ],
    [
      "a repeated key keeps its last value",
      'canonical_repo = "https://h/o/a"\ncanonical_repo = "https://h/o/b"\n',
    ],
    [
      "a last line with no terminator is not read",
      'canonical_repo = "https://h/o/r"\nfeedback_repo = "https://h/o/f"',
    ],
    [
      "placeholders in file order: a value naming a later key",
      'canonical_repo = "https://h/o/${FEEDBACK_REPO}"\nfeedback_repo = "f"\n',
    ],
    [
      "a value with a quote after whitespace and a quote before it",
      'canonical_repo = "https://h/o/r"\nfeedback_repo = abc" \nzz = "abc "\n',
    ],
    [
      "a key with no `=`, a digit-first key and an inner blank",
      'canonical_repo = "https://h/o/r"\nloose\n1a = z\na b = c\n',
    ],
    [
      "a shell metacharacter in a value is literal",
      'canonical_repo = "https://h/o/r"\nfeedback_repo = "a&b\\1$(x)`y`"\n',
    ],
  ];
  for (const [label, text] of texts) {
    test(`${label}: the same bytes`, () => {
      compare(makePair(small(text)), { args: TARGET });
    });
  }
});

describe("--list-output-dirs (R5)", { skip: SKIP }, () => {
  const rows: string[][] = [
    ["--list-output-dirs"],
    ["--list-output-dirs", "--target", "claude", "--tier", "community"],
    ["--list-output-dirs", "--target", "nope"],
    ["--list-output-dirs", "--target", "gemini claude"],
    ["--list-output-dirs", "--target", "github", "--tier", "library", "--tier", "core"],
    ["--list-output-dirs", "--tier", "b", "--tier", "a", "--tier", ""],
    ["--tier", "x", "--list-output-dirs", "--check", "--bogus"],
  ];
  for (const args of rows) {
    test(args.join(" "), () => {
      const { ts } = compare(
        makePair(() => undefined),
        { args },
      );
      assert.equal(ts.status, 0);
      assert.equal(ts.stderr, "");
    });
  }
});

describe("--resolve and --diagnostics (R6)", { skip: SKIP }, () => {
  const agent = "artifacts/core/agents/prof/AGENT.md";
  for (const target of ["claude", "gemini", "copilot", "antigravity"]) {
    test(`--resolve of a profile agent for ${target}: four outputs on stdout, diagnostics on stderr`, () => {
      const { ts } = compare(makePair(rich), { args: ["--resolve", agent, target] });
      assert.equal(ts.status, 0);
      if (target !== "copilot") assert.match(ts.stdout, /^offering: /m);
      else assert.match(ts.stderr, /^model-drop\t/m, "copilot drops the profile: diagnostics only");
    });
  }

  test("--resolve with --diagnostics truncates the file first and fills it; a build appends", () => {
    const pair = makePair((put, root) => {
      rich(put, root);
      put("diag.log", "old line\n");
    });
    const { ts } = compare(pair, {
      args: ["--resolve", agent, "claude", "--diagnostics", "diag.log"],
    });
    assert.equal(ts.status, 0);
    for (const root of [pair.a, pair.b]) {
      const log = fs.readFileSync(path.join(root, "diag.log"), "utf8");
      assert.ok(!log.includes("old line") && log.length > 0, "truncated first, then filled");
    }
    const built = makePair((put, root) => {
      rich(put, root);
      put("diag.log", "old line\n");
    });
    const { ts: build } = compare(built, { args: [...TARGET, "--diagnostics", "diag.log"] });
    assert.equal(build.status, 0);
    assert.ok(fs.readFileSync(path.join(built.b, "diag.log"), "utf8").startsWith("old line\n"));
  });

  test("an agent source with no capability profile, and a source with no frontmatter", () => {
    compare(makePair(rich), {
      args: ["--resolve", "artifacts/core/agents/bashy/AGENT.md", "claude"],
    });
    compare(
      makePair((put, root) => {
        rich(put, root);
        put("plain.md", "no frontmatter\n");
      }),
      { args: ["--resolve", "plain.md", "claude"] },
    );
  });

  test("--resolve runs before the configuration: a malformed canonical_repo does not stop it", () => {
    const bad = makePair((put, root) => {
      rich(put, root);
      put("crewrig.config.toml", 'canonical_repo = "file:///x"\n');
    });
    const { ts } = compare(bad, { args: ["--resolve", agent, "claude"] });
    assert.equal(ts.status, 0);
  });
});

describe(
  "the organisation merge, shell and entry in turn on one MAPPING_MERGE_DIR (R20)",
  { skip: SKIP },
  () => {
    const mergeEnv = (
      pair: { tmpA: string; tmpB: string },
      side: "a" | "b",
    ): Record<string, string> => ({
      MAPPING_MERGE_DIR: path.join(side === "a" ? pair.tmpA : pair.tmpB, "merge"),
    });

    test("a caller's merge root: the same files, the same counter, the same documents once loaded (R33(h))", () => {
      const pair = makePair(rich);
      const { shell, ts } = compare(pair, { args: [], env: mergeEnv });
      assert.ok(
        shell.tmp.some((f) => f === "merge/.merges"),
        shell.tmp.join(", "),
      );
      const docs = (tmp: string): string[] =>
        fs.readdirSync(path.join(tmp, "merge")).filter((n) => /^[0-9a-f]{64}$/.test(n));
      assert.deepEqual(docs(pair.tmpB), docs(pair.tmpA), "both compute the same digest");
      const load = (tmp: string, digest: string): unknown =>
        yamlLib.load(fs.readFileSync(path.join(tmp, "merge", digest, "claude.yml"), "utf8"), {
          schema: yamlLib.CORE_SCHEMA,
        });
      for (const digest of docs(pair.tmpA))
        assert.deepEqual(load(pair.tmpB, digest), load(pair.tmpA, digest));
      assert.equal(
        fs.readFileSync(path.join(pair.tmpB, "merge/.merges"), "utf8"),
        fs.readFileSync(path.join(pair.tmpA, "merge/.merges"), "utf8"),
      );
      assert.ok(ts.stderr.includes("mapping-merge"), "a merge happened");
    });

    test("--target all merges once per target (claude and gemini) and a second run adds none", () => {
      const pair = makePair((put, root) => {
        rich(put, root);
        put("model-mappings/gemini.org.yml", orgMapping("gemini"));
      });
      compare(pair, { args: [], env: mergeEnv });
      const merges = (tmp: string): string =>
        fs.readFileSync(path.join(tmp, "merge/.merges"), "utf8");
      assert.equal(merges(pair.tmpB), merges(pair.tmpA));
      assert.deepEqual(merges(pair.tmpB).split("\n").filter(Boolean).sort(), ["claude", "gemini"]);
      const again = runTs(pair.b, pair.tmpB, [], mergeEnv(pair, "b"));
      assert.equal(again.status, 0, again.stderr);
      assert.equal(merges(pair.tmpB), merges(pair.tmpA), "the second run reused both documents");
    });

    test("each reads the other's document: the shell then the entry, and the reverse, add no merge", () => {
      const pair = makePair(rich);
      const shell1 = runShell(pair.a, pair.tmpA, TARGET, mergeEnv(pair, "a"));
      const merges = fs.readFileSync(path.join(pair.tmpA, "merge/.merges"), "utf8");
      // the entry, run on the SAME root and merge directory the shell just used
      const ts2 = runTs(pair.a, pair.tmpA, TARGET, mergeEnv(pair, "a"));
      assert.equal(ts2.status, 0, ts2.stderr);
      assert.equal(
        fs.readFileSync(path.join(pair.tmpA, "merge/.merges"), "utf8"),
        merges,
        "the entry reused the shell's document",
      );
      const ts1 = runTs(pair.b, pair.tmpB, TARGET, mergeEnv(pair, "b"));
      const shell2 = runShell(pair.b, pair.tmpB, TARGET, mergeEnv(pair, "b"));
      assert.equal(shell2.status, 0, shell2.stderr);
      assert.equal(
        fs.readFileSync(path.join(pair.tmpB, "merge/.merges"), "utf8"),
        merges,
        "the shell reused the entry's document",
      );
      expectSame(
        "first runs",
        normalise(shell1, [pair.a], [pair.tmpA]),
        normalise(ts1, [pair.b], [pair.tmpB]),
      );
    });
  },
);
