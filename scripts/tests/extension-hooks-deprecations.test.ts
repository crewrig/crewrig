// extension-hooks-deprecations.test.ts — the deprecation channel for the example hooks (spec 0258 R20;
// model: hook-deprecations.test.ts, spec 0243 R5).
//
// Each hook removes the `warning` listeners on purpose, which would hide the day a Node.js release
// deprecates an API it uses. Detection therefore lives here, in CI: `--throw-deprecation` raises a
// DeprecationWarning as an uncaught error before and independent of any listener the hook removed,
// and `--pending-deprecation` widens that to APIs Node.js has only scheduled for deprecation. Each
// hook runs under both flags and must exit 0 with the payload on standard output and an empty
// standard error. A canary proves the channel is live, and a source check proves no hook installs an
// `uncaughtException` or `unhandledRejection` handler, which would blind it.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { HOOK_FILES, PAYLOAD, REPO } from "./lib/windows-hooks-proof.ts";

const FLAGS = ["--throw-deprecation", "--pending-deprecation"] as const;
const FIRST_STATEMENT = 'process.removeAllListeners("warning");';

let work = "";
before(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), "extension-hooks-deprecations-"));
});
after(() => {
  fs.rmSync(work, { recursive: true, force: true });
});

interface Outcome {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Run `node [flags] <script>` with the payload on standard input, in a clean child environment. */
function run(script: string, flags: readonly string[]): Outcome {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of ["NODE_TEST_CONTEXT", "NODE_OPTIONS", "CI"]) delete env[key];
  const res = spawnSync(process.execPath, [...flags, script], {
    encoding: "utf8",
    input: `${PAYLOAD}\n`,
    env,
    cwd: work,
    timeout: 60_000,
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

/** A copy of a hook that raises a DeprecationWarning right after its listeners are removed. */
function canary(hook: string): string {
  const source = fs.readFileSync(path.join(REPO, hook), "utf8");
  assert.ok(source.includes(FIRST_STATEMENT), `${hook} no longer starts as the canary expects`);
  const target = path.join(work, `canary-${path.basename(hook)}`);
  fs.writeFileSync(
    target,
    source.replace(
      FIRST_STATEMENT,
      `${FIRST_STATEMENT}\nprocess.emitWarning("canary", "DeprecationWarning");`,
    ),
  );
  return target;
}

describe("the hooks raise no deprecation, even one Node.js only pends", () => {
  for (const hook of HOOK_FILES) {
    test(`${hook} writes the payload, silently, under both flags`, () => {
      const res = run(path.join(REPO, hook), FLAGS);
      assert.equal(res.status, 0, res.stderr);
      assert.equal(res.stdout, `${PAYLOAD}\n`);
      assert.equal(res.stderr, "");
    });
  }
});

describe("the channel is live", () => {
  for (const hook of HOOK_FILES) {
    const name = path.basename(hook);

    test(`${name}: the canary copy stays silent without the flags, so the flags alone reveal it`, () => {
      const res = run(canary(hook), []);
      assert.equal(res.status, 0, res.stderr);
      assert.equal(res.stderr, "");
    });

    test(`${name}: a DeprecationWarning under --throw-deprecation makes the hook exit non-zero`, () => {
      const res = run(canary(hook), FLAGS);
      assert.notEqual(res.status, 0, "the canary must be detected");
      assert.match(res.stderr, /DeprecationWarning|canary/);
    });
  }
});

describe("no hook can blind the channel", () => {
  for (const hook of HOOK_FILES) {
    test(`${hook} installs no uncaughtException or unhandledRejection handler`, () => {
      const code = fs
        .readFileSync(path.join(REPO, hook), "utf8")
        .split("\n")
        .filter((line) => !line.trim().startsWith("//"))
        .join("\n");
      assert.doesNotMatch(code, /uncaughtException|unhandledRejection/);
    });
  }
});
