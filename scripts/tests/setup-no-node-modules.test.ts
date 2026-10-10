// setup-no-node-modules.test.ts — requirement 20 of spec 0256 (plan v2 step C5, finding v1-F5): a
// user who just cloned the repository has NO `node_modules`, so each setup entry must run every step
// that precedes the dependency step (`deps-install`, `npm ci --omit=dev --workspaces=false`) on the
// Node.js standard library alone; a third-party package may be imported only after it.
//
// Two proofs per entry, on a sandbox repository without `node_modules` (see `omitNodeModules` in
// lib/setup-sandbox.ts), with the stub `npm` first on PATH and a closed stdin:
//  - `npm ci` FAILS (stub): no package can ever appear, so a third-party import anywhere before the
//    dependency step would surface as a module-not-found. The run must reach the recorded `npm ci`,
//    stop there and leave `node_modules` absent.
//  - `npm ci` WORKS (stub copying the real packages in): the vacuity guard. `node_modules` is absent
//    before the run and present after it, and the call is recorded, so the first proof did not pass
//    by never reaching the step.
// A canary proves the module-not-found detector matches what Node.js really prints in this sandbox.
// Windows is covered by the Windows entry job (plan v2 step C7).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import { REPO } from "./lib/build-fixture-tree.ts";
import { PROMPT_INVENTORY } from "../lib/setup/prompt-ids.ts";
import { baseStubs, exposeTools } from "./lib/setup-golden-common.ts";
import { createSetupSandbox } from "./lib/setup-sandbox.ts";
import type { SetupSandbox } from "./lib/setup-sandbox.ts";
import { installStubs } from "./lib/setup-stubs.ts";
import type { StubHandle, StubOptions } from "./lib/setup-stubs.ts";

type Cli = "claude" | "gemini" | "copilot" | "antigravity";
const CLIS: readonly Cli[] = ["claude", "gemini", "copilot", "antigravity"];
const NPM_CI = ["ci", "--omit=dev", "--workspaces=false"];
const FAILURE = "stub-npm: registry unreachable (R20 proof)";
const skip = process.platform === "win32" ? "Windows is covered by the Windows entry job" : false;

/** What a missing package looks like: Node.js, the dependency helper, or a bare package error. */
const MISSING_PACKAGE = [
  /ERR_MODULE_NOT_FOUND/,
  /Cannot find package/,
  /Cannot find module/,
  /require-dependency/,
  /MODULE_NOT_FOUND/,
];

const cleanup: string[] = [];
after(() => cleanup.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

/** A directory holding the production packages (js-yaml and its dependency argparse) `npm ci` installs. */
const packages = ((): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-r20-packages-"));
  cleanup.push(dir);
  for (const name of ["js-yaml", "argparse"]) {
    fs.cpSync(path.join(REPO, "node_modules", name), path.join(dir, name), {
      recursive: true,
      dereference: true,
    });
  }
  return dir;
})();

/** `--answer <id>=<value>` for every question of `cli`: the first option, a catalogue entry by name. */
function answersFor(cli: Cli): string[] {
  const out: string[] = [];
  for (const row of PROMPT_INVENTORY) {
    if (!row.clis.includes(cli)) continue;
    const value = row.catalogue === undefined ? row.options[0] : firstEntry(row.catalogue);
    if (value !== undefined) out.push("--answer", `${row.id}=${value}`);
  }
  return out;
}

function firstEntry(dir: string): string | undefined {
  const names = fs
    .readdirSync(path.join(REPO, dir))
    .filter((name) => name.endsWith(".md") && name !== "README.md")
    .sort();
  return names[0]?.replace(/\.md$/, "");
}

interface Run {
  readonly sb: SetupSandbox;
  readonly stubs: StubHandle;
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly hadNodeModules: boolean;
}

/** Run the entry of `cli` on a sandbox repository with no `node_modules`; the caller disposes `sb`. */
function runEntry(cli: Cli, npm: StubOptions): Run {
  const sb = createSetupSandbox({ omitNodeModules: true });
  const hadNodeModules = fs.existsSync(path.join(sb.repo, "node_modules"));
  const stubs = installStubs(sb.bin, { ...baseStubs(cli), ...npm });
  exposeTools(sb, ["jq", "git"]);
  const res = sb.run(`setup-${cli}-interactive`, answersFor(cli), { leg: "ts", stdin: "" });
  return { sb, stubs, status: res.status, stdout: res.stdout, stderr: res.stderr, hadNodeModules };
}

const npmCalls = (run: Run): readonly (readonly string[])[] =>
  run.stubs.records("npm").map((record) => record.argv);
const report = (run: Run): string =>
  `status ${String(run.status)}\n--- stdout ---\n${run.stdout}\n--- stderr ---\n${run.stderr}`;

function assertNoMissingPackage(run: Run): void {
  const text = `${run.stdout}\n${run.stderr}`;
  for (const pattern of MISSING_PACKAGE) {
    assert.doesNotMatch(
      text,
      pattern,
      `a package was needed before the dependency step\n${report(run)}`,
    );
  }
}

describe(
  "R20: setup entries run to the dependency step on the standard library alone",
  { skip },
  () => {
    it("detector canary: a third-party import in a sandbox without node_modules fails as the patterns expect", () => {
      const sb = createSetupSandbox({ omitNodeModules: true });
      try {
        assert.equal(fs.existsSync(path.join(sb.repo, "node_modules")), false);
        const res = spawnSync(
          process.execPath,
          ["--input-type=module", "-e", 'await import("js-yaml")'],
          {
            cwd: sb.repo,
            encoding: "utf8",
          },
        );
        assert.notEqual(
          res.status,
          0,
          "js-yaml resolved from a node_modules ABOVE the sandbox (for example /node_modules): the R20 proofs below would be vacuous here",
        );
        assert.ok(
          MISSING_PACKAGE.some((pattern) => pattern.test(res.stderr)),
          `the detector must recognise a real missing package:\n${res.stderr}`,
        );
      } finally {
        sb.dispose();
      }
    });

    for (const cli of CLIS) {
      describe(cli, () => {
        it("reaches the recorded `npm ci` with no package installable, and stops there", () => {
          const run = runEntry(cli, { npmFail: FAILURE });
          try {
            assert.equal(
              run.hadNodeModules,
              false,
              "the sandbox repository must start without node_modules",
            );
            assert.deepEqual(
              npmCalls(run).filter((argv) => argv[0] === "ci"),
              [NPM_CI],
              `the dependency step must call npm ci --omit=dev --workspaces=false once\n${report(run)}`,
            );
            assert.equal(fs.existsSync(path.join(run.sb.repo, "node_modules")), false);
            assert.ok(run.stderr.includes(FAILURE), report(run));
            assert.notEqual(run.status, 0, report(run));
            assert.notEqual(
              run.status,
              2,
              `exit 2 is a module-not-found reason here\n${report(run)}`,
            );
            assertNoMissingPackage(run);
          } finally {
            run.sb.dispose();
          }
        });

        it("vacuity guard: node_modules is absent before and present after the stub `npm ci`", () => {
          const run = runEntry(cli, { npmFixture: packages });
          try {
            assert.equal(
              run.hadNodeModules,
              false,
              "the sandbox repository must start without node_modules",
            );
            assert.deepEqual(
              npmCalls(run).filter((argv) => argv[0] === "ci"),
              [NPM_CI],
              report(run),
            );
            for (const name of ["js-yaml", "argparse"]) {
              assert.ok(
                fs.existsSync(path.join(run.sb.repo, "node_modules", name)),
                `${name} was not installed`,
              );
            }
            assertNoMissingPackage(run);
          } finally {
            run.sb.dispose();
          }
        });
      });
    }
  },
);
