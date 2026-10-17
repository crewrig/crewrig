// model-ci-tooling-spec-id-suites.test.ts — runs the UNCHANGED Bash suites of reserve-spec-id.sh
// and check-spec-id-reserved.sh through the shared differential wrapper (spec 0262 reqs 21, 22,
// 23, 26; review finding review/1339-F3). Every call the suite makes to the script runs the shell
// in sandbox A and the TypeScript twin in sandbox B; any difference in stdout, stderr, status or
// left-behind state is recorded and fails the test. The suites build their own scratch bare
// remotes under their own temp directory and never contact a real remote: the sandbox drops
// `origin` and the suites configure only scratch paths. POSIX only (the shell legs need bash).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { createDifferential, installWrapper } from "./lib/bash-suite-differential.ts";
import { tmpEnv } from "./lib/differential-guard.ts";
import { cleanEnv } from "./lib/differential-sandbox.ts";

interface Entry {
  readonly diffs: string[];
}

const SUITES = [
  {
    name: "reserve-spec-id",
    suite: "scripts/tests/test-reserve-spec-id.sh",
    tools: [],
  },
  {
    name: "check-spec-id-reserved",
    suite: "scripts/tests/test-check-spec-id-reserved.sh",
    tools: [],
  },
] as const;

function hasTool(tool: string): boolean {
  return spawnSync(tool, ["--version"], { stdio: "ignore" }).status === 0;
}

function skipReason(tools: readonly string[]): string | undefined {
  if (process.platform === "win32") return "shell legs need bash";
  const missing = tools.filter((t) => !hasTool(t));
  return missing.length > 0 ? `required tool missing locally: ${missing.join(", ")}` : undefined;
}

function readRecord(file: string): Entry[] {
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Entry);
}

describe("spec-id Bash suites through the differential wrapper", () => {
  for (const { name, suite, tools } of SUITES) {
    const skip = skipReason(tools);
    test(`${suite} passes with zero shell/TS differences`, { ...(skip ? { skip } : {}) }, () => {
      const d = createDifferential({ script: `scripts/${name}.sh` });
      try {
        const record = installWrapper(d, name);
        const run = spawnSync("bash", [path.join(d.a, suite)], {
          cwd: d.a,
          encoding: "utf8",
          env: cleanEnv(d.ctx.shell.scratch.home, tmpEnv(d.root)),
          maxBuffer: 64 * 1024 * 1024,
          timeout: 540_000,
        });
        const entries = readRecord(record);
        assert.ok(entries.length > 0, "the wrapper recorded no call: the suite never ran the tool");
        const bad = entries.filter((e) => e.diffs.length > 0);
        assert.equal(
          bad.length,
          0,
          `${bad.length}/${entries.length} calls differ:\n${bad
            .slice(0, 3)
            .map((e) => e.diffs.join("\n"))
            .join("\n---\n")}`,
        );
        assert.equal(
          run.status,
          0,
          `suite failed:\n${run.stdout
            .split("\n")
            .filter((l, i, a) => /^FAIL/.test(l) || /^FAIL/.test(a[i - 1] ?? ""))
            .join("\n")}\n${run.stderr.slice(-1500)}`,
        );
        assert.match(run.stdout, /Results: \d+ passed, 0 failed/);
      } finally {
        d.cleanup();
      }
    });
  }
});
