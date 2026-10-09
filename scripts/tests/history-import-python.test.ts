// history-import-python.test.ts — the offline end-to-end test of the four history importers
// (spec 0253 R27 and delta-01 R27; ticket #1331). It is the test run by the
// `windows-history-import` CI job on `windows-latest`, and it also passes on Linux and macOS.
// Node cannot spawn a `.cmd` stub without a shell, so the runner's REAL Python runs with a FAKE
// `mempalace` package on PYTHONPATH (tests/lib/fake-mempalace.ts): `mine` is logged and its exit
// status is chosen by the test. No bash, no shell, no `.cmd` is involved. Timings are printed,
// never asserted. The prune command is covered by history-import-prune-python.test.ts.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { Harness } from "./lib/history-import-harness.ts";
import type { Run } from "./lib/history-import-harness.ts";

const NOT_IMPORTABLE = "Error: 'mempalace' is not importable from any candidate Python.";
const INSTALL_FIRST = "Install MemPalace first: pipx install mempalace";

const h = new Harness();
before(() => h.setup());
after(() => h.teardown());

interface Importer {
  readonly cli: string;
  readonly entry: string;
  readonly sourceVar: string;
  readonly agent: string;
  readonly stream: "out" | "err";
  readonly missing: string;
  /** Create a source holding something to import under `dir`; returns its path. */
  readonly make: (dir: string) => string;
}

const write = (file: string, text: string): string => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
};

const IMPORTERS: readonly Importer[] = [
  {
    cli: "claude",
    entry: "import-claude-history.ts",
    sourceVar: "CLAUDE_PROJECTS_DIR",
    agent: "claude-code",
    stream: "out",
    missing: "Error: Claude projects directory not found: ",
    make: (d) => (write(path.join(d, "src", "proj", "s1.jsonl"), '{"a":1}\n'), path.join(d, "src")),
  },
  {
    cli: "gemini",
    entry: "import-gemini-history.ts",
    sourceVar: "GEMINI_TMP_DIR",
    agent: "gemini-cli",
    stream: "out",
    missing: "Error: Gemini tmp directory not found: ",
    make: (d) => (write(path.join(d, "src", "p", "session-1.json"), "{}"), path.join(d, "src")),
  },
  {
    cli: "copilot",
    entry: "import-copilot-history.ts",
    sourceVar: "COPILOT_SESSIONS_DIR",
    agent: "copilot-cli",
    stream: "out",
    missing: "Error: Copilot session directory not found: ",
    make: (d) => (write(path.join(d, "src", "s1", "events.jsonl"), "{}\n"), path.join(d, "src")),
  },
  {
    cli: "antigravity",
    entry: "import-antigravity-history.ts",
    sourceVar: "ANTIGRAVITY_HISTORY_FILE",
    agent: "antigravity-cli",
    stream: "err",
    missing: "Error: Antigravity CLI history file not found: ",
    make: (d) => write(path.join(d, "history.jsonl"), '{"a":1}\n{"b":2}\n'),
  },
];

for (const imp of IMPORTERS) {
  describe(`import-${imp.cli}-history.ts`, () => {
    const go = (name: string, extra: Record<string, string>, input = "", exit = 0): Run =>
      h.run(`import-${imp.cli} ${name}`, imp.entry, [], h.env(extra, exit), input);
    const errors = (r: Run): string[] => (imp.stream === "out" ? r.out : r.err);

    test("reports a missing interpreter: two Error lines, exit 1, no prompt", () => {
      const dir = h.fresh();
      const r = h.run(
        `import-${imp.cli} no-python`,
        imp.entry,
        [],
        h.envNoPython({ [imp.sourceVar]: imp.make(dir) }),
      );
      assert.equal(r.status, 1);
      assert.deepEqual(errors(r).slice(-2), [NOT_IMPORTABLE, INSTALL_FIRST]);
      assert.doesNotMatch(r.stdout + r.stderr, /\(yes\/no\)/);
      assert.deepEqual(h.mineArgv(), []);
    });

    test("reports a missing source, exit 1", () => {
      const source = path.join(h.fresh(), "absent");
      const r = go("missing-source", { [imp.sourceVar]: source });
      assert.equal(r.status, 1);
      assert.equal(errors(r).at(-2), imp.missing + source);
      assert.match(errors(r).at(-1) ?? "", new RegExp(`^Override with ${imp.sourceVar}=`));
      assert.deepEqual(h.mineArgv(), []);
    });

    if (imp.cli !== "antigravity") {
      test("an empty source prints the nothing-to-import line, exit 0, no mine", () => {
        const source = path.join(h.fresh(), "empty");
        fs.mkdirSync(source);
        const r = go("empty-source", { [imp.sourceVar]: source });
        assert.equal(r.status, 0);
        assert.ok(r.out.some((l) => l.includes("nothing to import.")));
        assert.deepEqual(h.mineArgv(), []);
      });
    }

    test("declining both questions cancels the import, exit 0, no mine", () => {
      const r = go("declined", { [imp.sourceVar]: imp.make(h.fresh()) }, "no\nno\n");
      assert.equal(r.status, 0);
      assert.ok(r.out.includes("Import canceled."));
      assert.deepEqual(h.mineArgv(), []);
    });

    test("confirming both runs a dry-run mine then the real one, exit 0", () => {
      const source = imp.make(h.fresh());
      const r = go("confirmed", { [imp.sourceVar]: source }, "yes\nyes\n");
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.ok(r.out.includes("  Import complete"));
      const calls = h.mineArgv();
      assert.equal(calls.length, 2);
      const tail = ["--mode", "convos", "--wing", "transcripts", "--agent", imp.agent];
      const [dry, real] = calls as [string[], string[]];
      assert.deepEqual(
        [dry[0], ...dry.slice(2)],
        ["mine", ...tail, "--extract", "exchange", "--dry-run"],
      );
      assert.deepEqual([real[0], ...real.slice(2)], ["mine", ...tail, "--extract", "exchange"]);
      if (imp.cli !== "antigravity") {
        assert.equal(path.normalize(dry[1] as string), path.normalize(source));
        assert.equal(path.normalize(real[1] as string), path.normalize(source));
      }
    });

    test("a failing mine ends the run with its status", () => {
      const r = go("mine-fails", { [imp.sourceVar]: imp.make(h.fresh()) }, "yes\nyes\n", 3);
      assert.equal(r.status, 3);
      assert.ok(!r.out.includes("  Import complete"));
      assert.equal(h.mineArgv().length, 1);
    });

    if (imp.cli === "antigravity") {
      for (const [label, exit] of [
        ["success", 0],
        ["failing mine", 3],
      ] as const) {
        test(`the staged directory is removed after a ${label}`, () => {
          go(`staged-${exit}`, { [imp.sourceVar]: imp.make(h.fresh()) }, "yes\nyes\n", exit);
          const staged = h.mineArgv()[0]?.[1];
          assert.ok(staged !== undefined, "mine received a directory");
          assert.equal(fs.existsSync(staged), false, `${staged} was left behind`);
        });
      }
    }
  });
}
