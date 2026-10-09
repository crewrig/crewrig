// usage-wrappers-oracle.test.ts — the black-box oracle of the three usage
// wrappers `scripts/usage-{drain,task,backfill}.sh` (spec 0253 + delta-01 R26,
// PLAN v3 step A1). It drives each wrapper through `bash` under the hermetic
// harness with the REAL `node`, and observes only what survives the migration:
// exit status, stdout, stderr, files under a temp CREWRIG_USAGE_ROOT, and the
// process that runs `journal.js` (a NODE_OPTIONS recorder). It passes against
// the shell scripts today and, unchanged, once they become shims to TypeScript.
// POSIX only: skipped on win32.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import {
  createHermeticEnv,
  runBash,
  type HermeticEnv,
  type RunResult,
} from "./lib/hermetic-env.ts";

const SCRIPTS = path.resolve(import.meta.dirname, "..");
const DRAIN = path.join(SCRIPTS, "usage-drain.sh");
const TASK = path.join(SCRIPTS, "usage-task.sh");
const BACKFILL = path.join(SCRIPTS, "usage-backfill.sh");
const JOURNAL = path.join(SCRIPTS, "lib", "usage-store", "journal.js");
const SESSION = "oracle-session-1";

/** Run `fn` with a fresh harness and a temp usage root, both disposed afterwards. */
function withUsage(fn: (h: HermeticEnv, usage: string) => void): void {
  const h = createHermeticEnv();
  try {
    fn(h, path.join(h.root, "usage"));
  } finally {
    h.dispose();
  }
}

/** Every regular file under `dir`, as sorted paths relative to it (empty when `dir` is absent). */
function filesUnder(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((rel) => fs.statSync(path.join(dir, rel)).isFile())
    .sort();
}

function parseJson(text: string): unknown {
  return JSON.parse(text);
}

function asRecord(value: unknown): Record<string, unknown> {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value));
  return value as Record<string, unknown>;
}

describe("usage-task.sh oracle", { skip: process.platform === "win32" }, () => {
  test("set, show and clear a session declaration: exit 0, file written then removed, streams recorded", () => {
    withUsage((h, usage) => {
      const env = { CREWRIG_USAGE_ROOT: usage };
      const task = (...args: string[]): RunResult => runBash(h, TASK, args, { env });

      const set = task("set", "--task-key", "7", "--channel", "protocol", "--session", SESSION);
      assert.equal(set.status, 0);
      assert.equal(set.stderr, "");
      const written = asRecord(parseJson(set.stdout));
      assert.equal(written["taskHandoffKey"], "7");
      assert.equal(written["declaringChannel"], "protocol");
      assert.equal(written["sessionId"], SESSION);
      assert.equal(filesUnder(usage).length, 1, "one declaration file under the temp root");

      const show = task("show", "--session", SESSION);
      assert.equal(show.status, 0);
      assert.equal(show.stderr, "");
      assert.deepEqual(parseJson(show.stdout), { scope: "session", record: written });

      const clear = task("clear", "--session", SESSION);
      assert.equal(clear.status, 0);
      assert.equal(clear.stdout, "cleared\n");
      assert.equal(clear.stderr, "");
      assert.deepEqual(filesUnder(usage), []);

      const after = task("show", "--session", SESSION);
      assert.equal(after.status, 0);
      assert.equal(after.stdout, "no declaration record resolved\n");
      assert.equal(after.stderr, "");
    });
  });

  test("an unknown subcommand prints the usage on stdout and exits 2, writing nothing", () => {
    withUsage((h, usage) => {
      const res = runBash(h, TASK, ["bogus"], { env: { CREWRIG_USAGE_ROOT: usage } });
      assert.equal(res.status, 2);
      assert.equal(res.stderr, "");
      assert.match(
        res.stdout,
        /^Usage: bash scripts\/usage-task\.sh set --channel explicit\|protocol /,
      );
      assert.deepEqual(filesUnder(usage), []);
    });
  });

  test("a bad option is a FATAL line on stderr and exit 2", () => {
    withUsage((h, usage) => {
      const res = runBash(h, TASK, ["show", "--nope"], { env: { CREWRIG_USAGE_ROOT: usage } });
      assert.equal(res.status, 2);
      assert.equal(res.stdout, "");
      assert.equal(res.stderr, "FATAL: unrecognized argument: --nope\n");
    });
  });
});

describe("usage-drain.sh oracle", { skip: process.platform === "win32" }, () => {
  /** Run the wrapper with a NODE_OPTIONS recorder; return what it recorded for journal.js. */
  function record(
    h: HermeticEnv,
    args: readonly string[],
    budget?: string,
  ): { run: RunResult; records: Record<string, unknown>[] } {
    const rec = path.join(h.root, "rec.js");
    const out = path.join(h.root, "records.jsonl");
    fs.writeFileSync(
      rec,
      [
        "if (process.argv[1] && process.argv[1].endsWith('journal.js')) {",
        "  require('node:fs').appendFileSync(" + JSON.stringify(out) + ",",
        "    JSON.stringify({ argv: process.argv.slice(1),",
        "      budget: process.env.CREWRIG_USAGE_DRAIN_BUDGET_MS ?? null }) + '\\n');",
        "}",
      ].join("\n"),
    );
    const run = runBash(h, DRAIN, args, {
      env: {
        CREWRIG_USAGE_ROOT: path.join(h.root, "usage"),
        NODE_OPTIONS: `--require ${rec}`,
        CREWRIG_USAGE_DRAIN_BUDGET_MS: budget,
      },
    });
    const lines = fs.existsSync(out)
      ? fs.readFileSync(out, "utf8").split("\n").filter(Boolean)
      : [];
    return { run, records: lines.map((line) => asRecord(parseJson(line))) };
  }

  test("budget defaults to 0 and an extra script argument never reaches journal.js", () => {
    const h = createHermeticEnv();
    try {
      const { run, records } = record(h, ["ignored"]);
      assert.equal(run.status, 0);
      assert.equal(records.length, 1);
      assert.deepEqual(records[0], { argv: [JOURNAL], budget: "0" });
    } finally {
      h.dispose();
    }
  });

  test("an explicit CREWRIG_USAGE_DRAIN_BUDGET_MS reaches journal.js unchanged", () => {
    const h = createHermeticEnv();
    try {
      const { run, records } = record(h, [], "500");
      assert.equal(run.status, 0);
      assert.deepEqual(records, [{ argv: [JOURNAL], budget: "500" }]);
    } finally {
      h.dispose();
    }
  });

  test("smoke: a real drain on an empty root exits 0 with the completion line", () => {
    withUsage((h, usage) => {
      const res = runBash(h, DRAIN, [], { env: { CREWRIG_USAGE_ROOT: usage } });
      assert.equal(res.status, 0);
      assert.equal(res.stdout, "usage-store: drain and sweep complete.\n");
      assert.equal(res.stderr, "");
    });
  });
});

describe("usage-backfill.sh oracle", { skip: process.platform === "win32" }, () => {
  const EMPTY_SUMMARY =
    "claude-code: 0 stored, 0 duplicate, 0 rejected — from 0 source(s)\n" +
    "gemini-cli: 0 stored, 0 duplicate, 0 rejected — from 0 source(s)\n" +
    "copilot-cli: 0 stored, 0 duplicate, 0 rejected — from 0 source(s)\n";

  /** Seed one cursor file per covered CLI under the temp root; return their paths. */
  function seed(usage: string): string[] {
    return ["claude-code", "gemini-cli"].map((cli) => {
      const file = path.join(usage, "state", cli, "cursor");
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "{}\n");
      return file;
    });
  }

  test("--reset-cursors removes the seeded cursor state of the covered CLIs", () => {
    withUsage((h, usage) => {
      const seeded = seed(usage);
      const res = runBash(h, BACKFILL, ["--reset-cursors"], { env: { CREWRIG_USAGE_ROOT: usage } });
      assert.equal(res.status, 0);
      assert.equal(res.stdout, EMPTY_SUMMARY);
      for (const file of seeded) assert.equal(fs.existsSync(file), false, file);
    });
  });

  test("without the flag the seeded cursor state is kept (control)", () => {
    withUsage((h, usage) => {
      const seeded = seed(usage);
      const res = runBash(h, BACKFILL, [], { env: { CREWRIG_USAGE_ROOT: usage } });
      assert.equal(res.status, 0);
      assert.equal(res.stdout, EMPTY_SUMMARY);
      for (const file of seeded) assert.equal(fs.existsSync(file), true, file);
    });
  });

  test("a no-argument run on an empty home exits 0 and reports zero sources", () => {
    withUsage((h) => {
      const res = runBash(h, BACKFILL, [], {});
      assert.equal(res.status, 0);
      assert.equal(res.stdout, EMPTY_SUMMARY);
      assert.equal(res.stderr, "");
    });
  });
});
