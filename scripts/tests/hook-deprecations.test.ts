// hook-deprecations.test.ts — the deprecation channel of spec 0243 R5 / plan
// step 22.
//
// The entries silence Node.js warnings on purpose (R5), which would hide the
// day a Node.js release deprecates an API they use. Detection therefore lives
// here, in CI, never in the hook command line: `--throw-deprecation` turns a
// DeprecationWarning into an uncaught error raised on the next tick, before and
// independent of any `warning` listener the entry removed, and
// `--pending-deprecation` widens it to APIs Node.js has only scheduled for
// deprecation. Each entry runs through its fast, slow and shim scenarios under
// both flags and must exit 0 with empty streams. A canary proves the channel is
// live, and a source check proves no entry installs an `uncaughtException`
// handler, which would blind it.
//
// If `--pending-deprecation` ever fires on legitimate legacy adapter code, drop
// it here (keep `--throw-deprecation`) and record the reason on the logbook.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import {
  hookEnv,
  makeFixtureTree,
  REPO,
  runEntry,
  type FixtureTree,
} from "./lib/hook-fixture-tree.ts";
import { writeTimingFixtures, type TimingFixtures } from "./lib/usage-capture-timing-fixtures.ts";

const FLAGS = ["--throw-deprecation", "--pending-deprecation"] as const;
const CAPTURE = path.join(REPO, "hooks", "usage-capture.ts");
const SHIM = path.join(REPO, "hooks", "antigravity-statusline-shim.ts");
const COPILOT_FIXTURE = path.join(
  REPO,
  "scripts",
  "tests",
  "fixtures",
  "usage-capture",
  "copilot-cli",
  "assistant-usage-events",
);

let work = "";
let fixtures: TimingFixtures;
let counter = 0;

before(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), "hook-deprecations-"));
  fixtures = writeTimingFixtures(path.join(work, "fixtures"));
});
after(() => {
  fs.rmSync(work, { recursive: true, force: true });
});

interface Outcome {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Run an entry as `node --throw-deprecation --pending-deprecation <entry> <args>`. */
function flagged(
  entry: string,
  args: string[],
  stdin: string,
  env: NodeJS.ProcessEnv,
  flags: readonly string[] = FLAGS,
): Outcome {
  const res = spawnSync(process.execPath, [...flags, entry, ...args], {
    encoding: "utf8",
    input: stdin,
    env,
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

function fresh(): { root: string; home: string; env: NodeJS.ProcessEnv } {
  counter += 1;
  const root = path.join(work, `root-${counter}`);
  const home = path.join(work, `home-${counter}`);
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  return { root, home, env: hookEnv({ CREWRIG_USAGE_ROOT: root, HOME: home, USERPROFILE: home }) };
}

function assertClean(res: Outcome): void {
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout, "");
  assert.equal(res.stderr, "");
}

describe("the entries raise no deprecation, even one Node.js only pends", () => {
  test("usage-capture.ts, fast path", () => {
    const env = hookEnv({ CREWRIG_USAGE_ROOT: fixtures.usageRoot });
    assertClean(
      flagged(CAPTURE, ["claude-code", "Stop"], fs.readFileSync(fixtures.fastPayload, "utf8"), env),
    );
  });

  test("usage-capture.ts, slow path through the real capture graph", () => {
    const { env } = fresh();
    assertClean(
      flagged(CAPTURE, ["claude-code", "Stop"], fs.readFileSync(fixtures.slowPayload, "utf8"), env),
    );
  });

  test("usage-capture.ts, slow path through node:sqlite (Copilot CLI)", () => {
    const { home, env } = fresh();
    const store = path.join(home, ".copilot", "session-store.db");
    fs.mkdirSync(path.dirname(store), { recursive: true });
    const db = new DatabaseSync(store);
    try {
      db.exec(fs.readFileSync(path.join(COPILOT_FIXTURE, "schema.sql"), "utf8"));
      db.exec(fs.readFileSync(path.join(COPILOT_FIXTURE, "rows.sql"), "utf8"));
    } finally {
      db.close();
    }
    assertClean(flagged(CAPTURE, ["copilot-cli", "agentStop"], "{}", env));
  });

  test("antigravity-statusline-shim.ts, no prior command", () => {
    const { env } = fresh();
    assertClean(flagged(SHIM, [], fs.readFileSync(fixtures.shimPayload, "utf8"), env));
  });

  test("antigravity-statusline-shim.ts, with a prior command", () => {
    const { root, env } = fresh();
    const prior = path.join(work, "prior.js");
    fs.writeFileSync(prior, "process.stdin.resume();process.stdin.on('end',()=>{});\n");
    fs.mkdirSync(path.join(root, "state"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "state", "antigravity-statusline.json"),
      JSON.stringify({ priorStatusLineCommand: `node "${prior.replaceAll("\\", "/")}"` }),
    );
    assertClean(flagged(SHIM, [], fs.readFileSync(fixtures.shimPayload, "utf8"), env));
  });
});

describe("the channel is live", () => {
  let tree: FixtureTree;
  before(() => {
    // A capture graph that deprecates something, as a Node.js release might.
    tree = makeFixtureTree({
      hookRun: [
        "export async function runCapture(): Promise<void> {",
        '  process.emitWarning("canary", "DeprecationWarning");',
        "}",
        "",
      ].join("\n"),
    });
  });
  after(() => tree.cleanup());

  test("the same run without the flags stays silent, so the flags alone reveal it", () => {
    const { env } = fresh();
    const res = runEntry(
      tree.file("hooks", "usage-capture.ts"),
      ["claude-code", "Stop"],
      "{}",
      env,
    );
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stderr, "");
  });

  test("a DeprecationWarning under --throw-deprecation makes the entry exit non-zero", () => {
    const { env } = fresh();
    const res = flagged(tree.file("hooks", "usage-capture.ts"), ["claude-code", "Stop"], "{}", env);
    assert.notEqual(res.status, 0, "the canary must be detected");
    assert.match(res.stderr, /DeprecationWarning|canary/);
  });

  test("the shim reports it as well", () => {
    const { env } = fresh();
    const res = flagged(tree.file("hooks", "antigravity-statusline-shim.ts"), [], "{}", env);
    assert.notEqual(res.status, 0, "the canary must be detected");
  });
});

describe("no entry can blind the channel", () => {
  for (const entry of [CAPTURE, SHIM]) {
    test(`${path.basename(entry)} installs no uncaughtException or unhandledRejection handler`, () => {
      const source = fs.readFileSync(entry, "utf8");
      const code = source
        .split("\n")
        .filter((line) => !line.trim().startsWith("//"))
        .join("\n");
      assert.doesNotMatch(code, /uncaughtException|unhandledRejection/);
    });
  }
});
