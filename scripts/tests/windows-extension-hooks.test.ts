// windows-extension-hooks.test.ts — the `windows-extension-hooks` job's functional proof (spec 0258
// R16, R20, R27). Each of the three example hooks runs with a fixed JSON payload on standard input
// from PowerShell and from `cmd.exe`, `bash` absent from the child PATH, and must write the payload
// and one line feed, nothing on standard error, exit status 0, and leave its landing zone empty. The
// four package layouts of R2 run the same way. The Windows legs skip elsewhere; a direct leg runs
// the same assertions on any host. The POSIX-only EAGAIN and FIFO case stays in the Linux suites.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import {
  githubEnvLines,
  HOOK_PAYLOAD_LINE,
  writeHookPayload,
} from "./lib/extension-hooks-timing-fixtures.ts";
import {
  assertBashAbsent,
  assertNone,
  HOOK_FILES,
  landingProblems,
  makeSandbox,
  PAYLOAD,
  proveHooks,
  proveLayouts,
  runProblems,
  type Leg,
  type Sandbox,
} from "./lib/windows-hooks-proof.ts";
import { WIN } from "./lib/windows-proof-support.ts";

let root = "";
let sandbox: Sandbox;

before(() => {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "windows-hooks-")));
  sandbox = makeSandbox(root);
});
after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

for (const leg of ["pwsh", "cmd"] as const satisfies readonly Leg[]) {
  describe(`from ${leg}, bash absent from the child PATH`, { skip: !WIN }, () => {
    test("every hook writes the payload and one line feed, silently", () => {
      const failures: string[] = [];
      proveHooks(sandbox, leg, failures);
      assertNone(failures);
    });

    test("every hook runs the same under each package layout", () => {
      const failures: string[] = [];
      proveLayouts(sandbox, leg, failures);
      assertNone(failures);
    });

    test("no bash was spawned, System32's bash.exe notwithstanding", () => {
      assertBashAbsent(sandbox);
    });
  });
}

describe("the same assertions, run directly on any host", () => {
  test("every hook writes the payload and one line feed, silently", () => {
    const failures: string[] = [];
    proveHooks(sandbox, "direct", failures);
    assertNone(failures);
  });

  test("every hook runs the same under each package layout", () => {
    const failures: string[] = [];
    proveLayouts(sandbox, "direct", failures);
    assertNone(failures);
  });

  test("the tripwire bash was never reached", () => {
    assertBashAbsent(sandbox);
  });

  test("three hooks are covered", () => {
    assert.equal(HOOK_FILES.length, 3);
  });
});

describe("the proof catches what it is meant to catch", () => {
  const good = { entry: "x", status: 0, out: `${PAYLOAD}\n`, err: "", ms: 0, detail: "" };

  test("a clean run has no problem", () => {
    assert.deepEqual(runProblems(good, "direct"), []);
  });

  test("stdout, stderr and the exit status are each checked", () => {
    assert.equal(runProblems({ ...good, out: PAYLOAD }, "direct").length, 1);
    assert.equal(runProblems({ ...good, err: "warn" }, "direct").length, 1);
    assert.equal(runProblems({ ...good, status: 1 }, "direct").length, 1);
  });

  test("CRLF is folded on a Windows leg and a stray CR still fails", () => {
    assert.deepEqual(runProblems({ ...good, out: `${PAYLOAD}\r\n` }, "pwsh"), []);
    assert.equal(runProblems({ ...good, out: `${PAYLOAD}\r\n` }, "direct").length, 1);
    assert.equal(runProblems({ ...good, out: `${PAYLOAD}\r\r\n` }, "cmd").length, 1);
  });

  test("a file in the landing zone is reported, with its carriage return", () => {
    const dir = fs.mkdtempSync(path.join(root, "landing-check-"));
    assert.deepEqual(landingProblems(dir), []);
    fs.writeFileSync(path.join(dir, "plain"), "a\n");
    fs.writeFileSync(path.join(dir, "crlf"), "a\r\n");
    const problems = landingProblems(dir);
    assert.equal(problems.length, 2);
    assert.equal(problems.filter((p) => p.includes("carriage return")).length, 1);
  });
});

describe("the timing fixture", () => {
  test("writes one JSON line and exports its path", () => {
    const dir = path.join(root, "hooks-timing");
    const file = writeHookPayload(dir);
    assert.equal(file, path.join(dir, "payload.json"));
    const text = fs.readFileSync(file, "utf8");
    assert.equal(text, `${HOOK_PAYLOAD_LINE}\n`);
    assert.doesNotMatch(text, /\r/);
    assert.equal(typeof JSON.parse(text), "object");
    assert.deepEqual(githubEnvLines(file), [`HOOK_PAYLOAD=${file}`]);
  });
});
