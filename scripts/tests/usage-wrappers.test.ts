// usage-wrappers.test.ts — the unit and entry-level tests of the nine TypeScript usage entries
// `scripts/usage-{attribute,backfill,dashboard,drain,mirror,price,prune,query,task}.ts` and
// their shared spawner `scripts/lib/usage-wrapper.ts` (spec 0253 + delta-01 R1, R2, R7, R8, R9;
// PLAN v3 step B4).
//
// Part 1 drives `runJs` against a recording script in a temp lib directory. Part 2 asserts the
// entry form of spec 0243 R5 and the entry-to-module mapping statically. Part 3 is the R9
// separation from the MemPalace history importers. Part 4 runs `usage-drain.ts` end to end and
// observes the `journal.js` process through a NODE_OPTIONS recorder. Part 5 runs entries
// unflagged on the runner's Node.js and asserts no Node.js warning reaches standard error.
//
// Portable: no shell is spawned (the suite runs on Linux, macOS and Windows), and every run uses
// a temp HOME and a temp CREWRIG_USAGE_ROOT so nothing touches the real store.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, mock, test } from "node:test";

import { runJs } from "../lib/usage-wrapper.ts";

const SCRIPTS = path.resolve(import.meta.dirname, "..");
const JOURNAL = path.join(SCRIPTS, "lib", "usage-store", "journal.js");
const WARNING = /Warning|MODULE_TYPELESS|ExperimentalWarning|--trace/;

const ENTRIES: readonly (readonly [string, string])[] = [
  ["attribute", "usage-store/ledger.js"],
  ["backfill", "usage-capture/backfill.js"],
  ["dashboard", "usage-dashboard/cli.js"],
  ["drain", "usage-store/journal.js"],
  ["mirror", "usage-store/mirror.js"],
  ["price", "usage-price/cli.js"],
  ["prune", "usage-store/prune.js"],
  ["query", "usage-store/query.js"],
  ["task", "usage-store/declaration.js"],
];

let tmp = "";
before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "usage-wrappers-"));
});
after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** A fresh empty directory under the suite's temp root. */
function fresh(label: string): string {
  return fs.mkdtempSync(path.join(tmp, `${label}-`));
}

/** The runner's environment with Node.js option variables and the drain budget removed. */
function cleanEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env["NODE_OPTIONS"];
  delete env["NODE_NO_WARNINGS"];
  delete env["CREWRIG_USAGE_DRAIN_BUDGET_MS"];
  return { ...env, ...extra };
}

/** A hermetic environment: temp HOME/USERPROFILE and an empty temp usage root. */
function hermetic(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const home = fresh("home");
  return cleanEnv({
    HOME: home,
    USERPROFILE: home,
    CREWRIG_USAGE_ROOT: path.join(home, "usage"),
    ...extra,
  });
}

/** Run an entry unflagged on the runner's Node.js. */
function runEntry(name: string, args: string[], env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, [path.join(SCRIPTS, `usage-${name}.ts`), ...args], {
    env,
    encoding: "utf8",
  });
}

interface Recorded {
  argv: string[];
  execArgv: string[];
  env: Record<string, string | null>;
}

describe("runJs (R7)", () => {
  const libDir = (): string => {
    const dir = fresh("lib");
    fs.writeFileSync(
      path.join(dir, "rec.js"),
      [
        'const fs = require("node:fs");',
        "const vars = process.env.REC_VARS.split(',');",
        "const env = Object.fromEntries(vars.map((v) => [v, process.env[v] ?? null]));",
        "fs.writeFileSync(process.env.REC_FILE, JSON.stringify({ argv: process.argv.slice(2), execArgv: process.execArgv, env }));",
        "process.exitCode = Number(process.env.REC_EXIT ?? 0);",
      ].join("\n"),
    );
    return dir;
  };

  function record(
    args: readonly string[],
    extra: NodeJS.ProcessEnv = {},
  ): { status: number; rec: Recorded } {
    const dir = libDir();
    const file = path.join(dir, "out.json");
    const env = cleanEnv({
      REC_FILE: file,
      REC_VARS: "NODE_OPTIONS,CREWRIG_ARBITRARY",
      ...extra,
    });
    const status = runJs("rec.js", args, env, { libDir: dir });
    return { status, rec: JSON.parse(fs.readFileSync(file, "utf8")) as Recorded };
  }

  test("arguments are forwarded verbatim and in order", () => {
    const args = ["--flag", "a value with spaces", "", "--", "naïve 日本語 ✓", "-x"];
    assert.deepEqual(record(args).rec.argv, args);
  });

  test("--disable-warning=ExperimentalWarning precedes the script", () => {
    assert.deepEqual(record([]).rec.execArgv, ["--disable-warning=ExperimentalWarning"]);
  });

  for (const code of [0, 3, 99]) {
    test(`the child's exit status ${code} is returned`, () => {
      assert.equal(record([], { REC_EXIT: String(code) }).status, code);
    });
  }

  test("NODE_OPTIONS and an arbitrary inherited variable reach the child", () => {
    const { rec } = record([], {
      NODE_OPTIONS: "--max-old-space-size=123",
      CREWRIG_ARBITRARY: "kept",
    });
    assert.deepEqual(rec.env, {
      NODE_OPTIONS: "--max-old-space-size=123",
      CREWRIG_ARBITRARY: "kept",
    });
  });

  test("a child killed by a signal gives status 1 and one Error line", () => {
    const dir = fresh("sig");
    fs.writeFileSync(path.join(dir, "kill.js"), 'process.kill(process.pid, "SIGKILL");\n');
    const written: string[] = [];
    const spy = mock.method(process.stderr, "write", (chunk: string | Uint8Array): boolean => {
      written.push(String(chunk));
      return true;
    });
    try {
      assert.equal(runJs("kill.js", [], cleanEnv(), { libDir: dir }), 1);
    } finally {
      spy.mock.restore();
    }
    // Windows has no signal death: the child just exits 1.
    if (process.platform !== "win32")
      assert.match(written.join(""), /^Error: kill\.js did not run to completion \(.+\)\n$/);
  });

  test("a node binary that cannot be spawned gives status 1 and one Error line", () => {
    const written: string[] = [];
    const spy = mock.method(process.stderr, "write", (chunk: string | Uint8Array): boolean => {
      written.push(String(chunk));
      return true;
    });
    try {
      const status = runJs("x.js", [], cleanEnv(), {
        libDir: tmp,
        nodePath: path.join(tmp, "no-such-node"),
      });
      assert.equal(status, 1);
    } finally {
      spy.mock.restore();
    }
    assert.match(written.join(""), /^Error: x\.js did not run to completion \(.+\)\n$/);
  });

  test("a missing script gives status 1", () => {
    const stderr = mock.method(process.stderr, "write", (): boolean => true);
    try {
      // The child (node) reports the missing module itself and exits 1.
      assert.equal(runJs("absent.js", [], cleanEnv(), { libDir: fresh("empty") }), 1);
    } finally {
      stderr.mock.restore();
    }
  });
});

describe("entry form and mapping (R1, R7)", () => {
  for (const [name, target] of ENTRIES) {
    const file = path.join(SCRIPTS, `usage-${name}.ts`);
    const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    const lines = text.split("\n");

    describe(`usage-${name}.ts`, () => {
      test("no module syntax or global declaration at column 0", () => {
        assert.ok(text !== "", "the entry exists");
        const offending = lines.filter((line) =>
          /^(import|export|const|let|var|function|class|enum|interface|type|declare|namespace|abstract|async)\b/.test(
            line,
          ),
        );
        assert.deepEqual(offending, []);
      });

      test("the first statement removes the warning listeners", () => {
        const first = lines.find((line) => line.trim() !== "" && !line.startsWith("//"));
        assert.equal(first, 'process.removeAllListeners("warning");');
      });

      test("at most 300 lines, exit status through process.exitCode", () => {
        assert.ok(lines.length <= 300, `${lines.length} lines`);
        assert.match(text, /process\.exitCode\s*=/);
        assert.doesNotMatch(text.replace(/^\s*\/\/.*$/gm, ""), /process\.exit\(/);
      });

      test("loads the shared spawner and names its module", () => {
        assert.match(text, /["']\.\/lib\/usage-wrapper\.ts["']/);
        assert.ok(text.includes(`"${target}"`), `names ${target}`);
      });
    });
  }
});

describe("separation from the history importers (R9)", () => {
  for (const file of ["usage-backfill.ts", "usage-backfill.sh"]) {
    test(`${file} names neither MemPalace nor an import-*-history script`, () => {
      const text = fs.readFileSync(path.join(SCRIPTS, file), "utf8");
      assert.doesNotMatch(text, /mempalace|import-(claude|gemini|copilot|antigravity)-history/i);
    });
  }
});

describe("usage-drain.ts end to end (R8)", () => {
  const recorderSource = [
    'const fs = require("node:fs");',
    'if (String(process.argv[1]).endsWith("journal.js")) {',
    "  fs.appendFileSync(process.env.REC_FILE, JSON.stringify({",
    "    argv: process.argv.slice(1),",
    "    budget: process.env.CREWRIG_USAGE_DRAIN_BUDGET_MS ?? null,",
    '  }) + "\\n");',
    "}",
  ].join("\n");

  function drain(budget: string | undefined): { argv: string[]; budget: string | null } {
    const dir = fresh("rec");
    const recorder = path.join(dir, "rec.js");
    const file = path.join(dir, "records.jsonl");
    fs.writeFileSync(recorder, recorderSource);
    const options = `--require "${recorder.replaceAll("\\", "/")}"`;
    const extra: NodeJS.ProcessEnv = { NODE_OPTIONS: options, REC_FILE: file };
    if (budget !== undefined) extra["CREWRIG_USAGE_DRAIN_BUDGET_MS"] = budget;
    const res = runEntry("drain", ["ignored"], hermetic(extra));
    assert.equal(res.status, 0, res.stderr);
    const records = fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => line !== "");
    assert.equal(records.length, 1, "journal.js ran exactly once");
    return JSON.parse(records[0] ?? "") as { argv: string[]; budget: string | null };
  }

  test("forwards no argument and defaults the budget to 0 when unset", () => {
    assert.deepEqual(drain(undefined), { argv: [JOURNAL], budget: "0" });
  });

  test("keeps an explicit budget", () => {
    assert.deepEqual(drain("500"), { argv: [JOURNAL], budget: "500" });
  });

  test("treats an empty budget as unset", () => {
    assert.deepEqual(drain(""), { argv: [JOURNAL], budget: "0" });
  });
});

describe("silence on the runner's Node.js, no flag and no option (R2)", () => {
  const cases: readonly (readonly [string, string[]])[] = [
    ["query", ["--undrained"]],
    ["task", ["show", "--session", "s1"]],
    ["drain", []],
  ];
  for (const [name, args] of cases) {
    test(`usage-${name}.ts ${args.join(" ")}`.trim(), () => {
      const res = runEntry(name, args, hermetic());
      assert.equal(res.status, 0, res.stderr);
      assert.doesNotMatch(res.stderr, WARNING);
    });
  }
});
