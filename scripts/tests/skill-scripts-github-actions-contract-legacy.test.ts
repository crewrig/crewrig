// skill-scripts-github-actions-contract-legacy.test.ts — the five existing github-actions scripts
// keep every exit code and message they had (spec 0300 R10 as amended by delta-01: additive
// changes only), with and without --json. The bulk of this is pinned by the 0258 oracle; this
// file adds the paths the oracle cannot see (stubs on PATH, SIGINT and SIGTERM, the exit code
// under --json). No test here expects exit 2 or 3 from an existing script for a bad target.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import {
  type ScriptName,
  SKILL_DIR,
  stubTool,
  WF_CLEAN,
} from "./lib/skill-scripts-github-actions-cli.ts";
import {
  act,
  exec,
  root,
  sandbox,
  type Sandbox,
  tmpLeft,
} from "./lib/skill-scripts-github-actions-sandbox.ts";

after(() => fs.rmSync(root, { recursive: true, force: true }));

describe("a missing or unreadable input stays exit 1, message text unchanged", () => {
  const cases: [ScriptName, string[], string, (s: Sandbox) => void][] = [
    [
      "check-pinned-actions",
      ["missing.yml"],
      "[FAIL] not a file or directory: missing.yml",
      () => {},
    ],
    [
      "lint-workflow",
      ["missing.yml"],
      "[FAIL] not a file or directory: missing.yml",
      (s) => stubTool(s.bin, "actionlint", "exit 0"),
    ],
    ["simulate-job", ["missing.yml", "b"], "[FAIL] workflow file not found: missing.yml", () => {}],
    ["simulate-workflow", ["missing.yml"], "[FAIL] workflow file not found: missing.yml", () => {}],
    [
      "simulate-workflow",
      ["wf.yml", "push", "nope.json"],
      "[FAIL] event payload file not found: nope.json",
      (s) => act(s, "exit 0"),
    ],
  ];
  for (const [script, args, message, setup] of cases)
    test(`${script} ${args.join(" ")}`, () => {
      const s = sandbox({ "wf.yml": WF_CLEAN });
      setup(s);
      const plain = exec(s, script, args);
      assert.equal(plain.status, 1, plain.stdout + plain.stderr);
      assert.ok(plain.stderr.includes(message), plain.stderr);
      assert.equal(exec(s, script, [...args, "--json"]).status, 1, "--json keeps the exit code");
    });
  test("a missing event payload leaves no temporary payload file", () => {
    const s = sandbox({ "wf.yml": WF_CLEAN });
    act(s, "exit 0");
    exec(s, "simulate-workflow", ["wf.yml", "push", "nope.json"]);
    assert.deepEqual(tmpLeft(s), []);
  });
});

describe("a missing tool stays a visible skip with exit 0, before any target check", () => {
  test("lint-workflow with no actionlint: [SKIP] and exit 0, even for a missing path or an empty directory", () => {
    const s = sandbox({ "wf.yml": WF_CLEAN });
    fs.mkdirSync(path.join(s.work, "empty"));
    for (const target of ["wf.yml", "missing.yml", "empty"]) {
      const r = exec(s, "lint-workflow", [target], false);
      assert.equal(r.status, 0, target);
      assert.match(r.stdout, /\[SKIP\] actionlint not found/);
    }
  });
  test("simulate-job and simulate-workflow with no act, then no docker: [SKIP] and exit 0", () => {
    const s = sandbox({ "wf.yml": WF_CLEAN });
    assert.match(exec(s, "simulate-job", ["wf.yml", "b"], false).stdout, /\[SKIP\] act not found/);
    assert.match(exec(s, "simulate-workflow", ["wf.yml"], false).stdout, /\[SKIP\] act not found/);
    const noDocker = sandbox({ "wf.yml": WF_CLEAN });
    stubTool(noDocker.bin, "act", "exit 0");
    const r = exec(noDocker, "simulate-workflow", ["wf.yml"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /\[SKIP\] docker CLI not found/);
  });
});

describe("a directory with no workflow file stays exit 0", () => {
  test("check-pinned-actions prints its legacy line, lint-workflow its [SKIP] line", () => {
    const s = sandbox();
    fs.mkdirSync(path.join(s.work, "empty"));
    stubTool(s.bin, "actionlint", "exit 0");
    const pinned = exec(s, "check-pinned-actions", ["empty"]);
    assert.equal(pinned.status, 0);
    assert.ok(pinned.stdout.includes("no workflow files found under: empty"), pinned.stdout);
    const lint = exec(s, "lint-workflow", ["empty"]);
    assert.equal(lint.status, 0);
    assert.ok(lint.stdout.includes("[SKIP] no workflow files found under: empty"), lint.stdout);
  });
});

describe("the status of the tool is passed through verbatim", () => {
  test("simulate-job: act exits 7 gives exit 7 and act's output reaches stdout", () => {
    const s = sandbox({ "wf.yml": WF_CLEAN });
    act(s, "echo act-says-hello; exit 7");
    const r = exec(s, "simulate-job", ["wf.yml", "b"]);
    assert.equal(r.status, 7);
    assert.equal(r.stdout, "+ act push --workflows wf.yml --job b --dryrun\nact-says-hello\n");
  });
  test("simulate-workflow: act exits 7 gives exit 7 and the payload file is removed", () => {
    const s = sandbox({ "wf.yml": WF_CLEAN });
    act(s, "echo act-says-hello; exit 7");
    const r = exec(s, "simulate-workflow", ["wf.yml"]);
    assert.equal(r.status, 7);
    assert.match(r.stdout, /act-says-hello\n$/);
    assert.deepEqual(tmpLeft(s), []);
  });
  test("a tool killed by SIGKILL ends the simulators with 128 plus 9, with and without --json", () => {
    for (const [script, args] of [
      ["simulate-job", ["wf.yml", "b"]],
      ["simulate-workflow", ["wf.yml"]],
    ] as const) {
      const s = sandbox({ "wf.yml": WF_CLEAN });
      act(s, "kill -9 $$");
      assert.equal(exec(s, script, args).status, 137, script);
      assert.equal(exec(s, script, [...args, "--json"]).status, 137, script);
    }
  });
  test("a failing actionlint is exit 1 with its own output", () => {
    const s = sandbox({ "wf.yml": WF_CLEAN });
    stubTool(s.bin, "actionlint", "echo 'wf.yml:1:1: bad' >&2; exit 1");
    const r = exec(s, "lint-workflow", ["wf.yml"]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /\[FAIL\] wf\.yml/);
    assert.match(r.stderr, /wf\.yml:1:1: bad/);
  });
});

describe("interruption of simulate-workflow keeps status 128 plus the signal", () => {
  const expected = { SIGINT: 130, SIGTERM: 143 } as const;
  for (const sig of ["SIGINT", "SIGTERM"] as const)
    test(`${sig} ends it with ${expected[sig]} and removes its temporary payload file`, async () => {
      const s = sandbox({ "wf.yml": WF_CLEAN });
      const started = path.join(s.work, "started");
      // exec: the stub is the process the script signals, so it dies at once, not an orphan child
      act(s, `: > '${started}'; exec /bin/sleep 30`);
      const entry = path.join(SKILL_DIR, "scripts", "simulate-workflow.ts");
      const child = spawn(process.execPath, [entry, "wf.yml"], {
        cwd: s.work,
        env: {
          HOME: os.tmpdir(),
          PATH: [path.dirname(process.execPath), s.bin].join(path.delimiter),
          LC_ALL: "C",
          TMPDIR: s.tmpdir,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((done) =>
        child.on("close", (code, signal) => done({ code, signal })),
      );
      const deadline = Date.now() + 15_000;
      while (!fs.existsSync(started) && Date.now() < deadline)
        await new Promise((r) => setTimeout(r, 25));
      assert.ok(fs.existsSync(started), "act stub never started");
      assert.ok(
        tmpLeft(s).some((f) => f.startsWith("act-payload.")),
        "payload file expected while running",
      );
      child.kill(sig);
      const { code, signal } = await closed;
      assert.equal(signal, null, "the script must exit by itself, not die of the signal");
      assert.equal(code, expected[sig]);
      assert.deepEqual(tmpLeft(s), []);
    });
});
