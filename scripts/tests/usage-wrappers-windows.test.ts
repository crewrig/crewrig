// usage-wrappers-windows.test.ts — the cross-platform entry test of the nine
// usage wrappers `scripts/usage-{attribute,backfill,dashboard,drain,mirror,
// price,prune,query,task}.ts` (spec 0253 + delta-01 R24, R27; PLAN v3 step B5).
// It is the test the `windows-usage-wrappers` CI job runs under PowerShell on
// `windows-latest`, and it also passes on Linux and macOS.
//
// No shell of any kind: every run spawns `process.execPath` directly with the
// entry file, the way Taskfile does (`node --disable-warning=
// MODULE_TYPELESS_PACKAGE_JSON scripts/usage-<x>.ts ...`), and once WITHOUT
// that flag to prove the entry form keeps stderr free of warnings. Isolation:
// a temp dir is HOME, USERPROFILE and CREWRIG_USAGE_ROOT; there is no network
// and no Python. Nothing is skipped on win32; paths go through `node:path` and
// are normalised before they are compared. R24: each command's wall time is
// recorded with a `timing:` line, never asserted against a budget.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

const SCRIPTS = path.resolve(import.meta.dirname, "..");
const FLAG = "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON";
const WARNING = /Warning|MODULE_TYPELESS|ExperimentalWarning/;
const SESSION = "win-s1";

interface Run {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

interface Sandbox {
  readonly root: string;
  readonly env: NodeJS.ProcessEnv;
}

/** Run `fn` with a fresh temp HOME / USERPROFILE / usage root, removed afterwards. */
function withSandbox(fn: (box: Sandbox) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "usage-win-"));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: root,
    USERPROFILE: root,
    CREWRIG_USAGE_ROOT: path.join(root, "usage"),
  };
  for (const key of ["CREWRIG_SESSION_ID", "NODE_OPTIONS"]) delete env[key];
  try {
    fn({ root, env });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/** Spawn `node [flag] scripts/usage-<name>.ts ...args` with no shell; print its wall time. */
function runEntry(box: Sandbox, name: string, args: readonly string[], withFlag: boolean): Run {
  const entry = path.join(SCRIPTS, `usage-${name}.ts`);
  const argv = [...(withFlag ? [FLAG] : []), entry, ...args];
  const started = performance.now();
  const result = spawnSync(process.execPath, argv, {
    env: box.env,
    cwd: box.root,
    encoding: "utf8",
    timeout: 60_000,
  });
  const ms = Math.round(performance.now() - started);
  console.log(`timing: ${name} ${ms} ms`);
  assert.equal(result.error, undefined, `${name}: spawn failed`);
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function asRecord(value: unknown): Record<string, unknown> {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function parseObject(text: string): Record<string, unknown> {
  return asRecord(JSON.parse(text) as unknown);
}

/** One offline command per wrapper family, with what an empty store must produce. */
interface Case {
  readonly name: string;
  readonly args: readonly string[];
  readonly status: number;
  readonly check: (run: Run) => void;
}

const CASES: readonly Case[] = [
  {
    name: "query",
    args: ["--period", "2026-01", "--rollup"],
    status: 0,
    check: (run) => {
      const rollup = parseObject(run.stdout);
      assert.ok("byFidelity" in rollup, "rollup object names its fidelity buckets");
    },
  },
  {
    name: "drain",
    args: [],
    status: 0,
    check: (run) => assert.match(run.stdout, /drain and sweep complete/),
  },
  {
    name: "attribute",
    args: ["list", "--period", "2026-01"],
    status: 0,
    check: (run) => assert.equal(run.stdout, ""),
  },
  {
    // No pinned pricelist on an empty store, and refreshing it needs the
    // network: the documented offline outcome is a FATAL line and exit 1.
    name: "price",
    args: ["--rollup", "--period", "2026-01"],
    status: 1,
    check: (run) => {
      assert.match(run.stderr, /FATAL: no pinned pricelist snapshot/);
      assert.equal(run.stdout, "");
    },
  },
  {
    name: "dashboard",
    args: ["report", "--json"],
    status: 0,
    check: (run) => {
      const view = parseObject(run.stdout);
      assert.equal(view["schema"], "crewrig.usage-dashboard.view/1");
      assert.equal(view["empty"], "store-empty");
    },
  },
  {
    name: "backfill",
    args: [],
    status: 0,
    check: (run) => {
      for (const cli of ["claude-code", "gemini-cli", "copilot-cli"]) {
        assert.match(run.stdout, new RegExp(`${cli}: 0 stored, 0 duplicate, 0 rejected`));
      }
    },
  },
  {
    name: "prune",
    args: [],
    status: 2,
    check: (run) => assert.match(run.stdout + run.stderr, /Usage: .*prune\.js <cli> <YYYY-MM>/),
  },
  {
    name: "mirror",
    args: [],
    status: 0,
    check: (run) => assert.match(run.stdout, /catch-up complete/),
  },
];

describe("usage wrappers: Taskfile form (with the warning flag)", () => {
  for (const c of CASES) {
    test(`usage-${c.name}.ts on an empty store exits ${c.status} with the documented output`, () => {
      withSandbox((box) => {
        const run = runEntry(box, c.name, c.args, true);
        assert.equal(run.status, c.status, `stderr: ${run.stderr}`);
        c.check(run);
      });
    });
  }

  test("usage-task.ts sets, shows, clears, then reports no record", () => {
    withSandbox((box) => {
      const task = (...args: string[]): Run => runEntry(box, "task", args, true);

      const set = task("set", "--task-key", "1331", "--channel", "protocol", "--session", SESSION);
      assert.equal(set.status, 0, set.stderr);
      assert.equal(set.stderr, "");

      const show = task("show", "--session", SESSION);
      assert.equal(show.status, 0, show.stderr);
      const shown = parseObject(show.stdout);
      const record = asRecord(shown["record"]);
      assert.equal(record["taskHandoffKey"], "1331");
      assert.equal(record["declaringChannel"], "protocol");
      assert.equal(record["sessionId"], SESSION);

      const clear = task("clear", "--session", SESSION);
      assert.equal(clear.status, 0, clear.stderr);
      assert.equal(clear.stdout.trim(), "cleared");

      const again = task("show", "--session", SESSION);
      assert.equal(again.status, 0, again.stderr);
      assert.match(again.stdout, /no declaration record resolved/);
    });
  });

  test("the declaration lands under the temp usage root, never under the real home", () => {
    withSandbox((box) => {
      const set = runEntry(
        box,
        "task",
        ["set", "--task-key", "1331", "--channel", "protocol", "--session", SESSION],
        true,
      );
      assert.equal(set.status, 0, set.stderr);
      const usage = path.normalize(path.join(box.root, "usage"));
      const written = fs
        .readdirSync(usage, { recursive: true, encoding: "utf8" })
        .map((rel) => path.normalize(path.join(usage, rel)));
      assert.ok(
        written.some((file) => file.endsWith(".json") && file.startsWith(usage + path.sep)),
        `a declaration file exists under ${usage}`,
      );
    });
  });
});

describe("usage wrappers: entry form (without the warning flag)", () => {
  for (const c of CASES) {
    test(`usage-${c.name}.ts keeps stderr free of warnings`, () => {
      withSandbox((box) => {
        const run = runEntry(box, c.name, c.args, false);
        assert.equal(run.status, c.status, `stderr: ${run.stderr}`);
        assert.doesNotMatch(run.stderr, WARNING);
      });
    });
  }

  test("usage-task.ts show keeps stderr free of warnings", () => {
    withSandbox((box) => {
      const run = runEntry(box, "task", ["show", "--session", SESSION], false);
      assert.equal(run.status, 0, run.stderr);
      assert.doesNotMatch(run.stderr, WARNING);
    });
  });
});
