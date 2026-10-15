// windows-harness-curator.test.ts — the cross-system proof of the three harness-curator entries
// (spec 0258 requirements 15, 27, 34; PLAN v2 steps 20-21). The `windows-harness-curator` job runs
// this file. On Windows every case runs through PowerShell and `cmd.exe` against a sandbox whose
// PATH holds no `bash` (a tripwire stands in for `System32\bash.exe` and must never be called), a
// stub `gh.cmd`, and the runner's plain python; on POSIX the same assertions run with node directly,
// so the leg also runs on the host. The pipe of `apply.py` through a `.cmd` stub is NOT tested on
// Windows. Failures of a leg are aggregated, each with its command, stdout and stderr. The two
// legs that touch the real Task Scheduler (a read-only query, a throwaway task) run on Windows only.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { defaultIsFile } from "../lib/worktree-claim/launch-windows.ts";
import { curatorNames } from "../lib/service/schedule-names.ts";
import { renderCalendarTaskXml } from "../lib/service/schedule-render.ts";
import { createScheduleBackend } from "../lib/service/schedule-schtasks.ts";
import type { ScheduleSpec } from "../lib/service/schedule-spec.ts";
import { currentUserId } from "../lib/service/windows-task-xml.ts";
import {
  assertNoCarriageReturn,
  entryPath,
  findPython,
  golden,
  makeFixture,
  noBashCalled,
  runCurator,
  sampleFrictions,
} from "./lib/windows-curator-proof.ts";
import type { Fixture, Invocation } from "./lib/windows-curator-proof.ts";
import { expectStatus, resolveInterpreters, why, WIN } from "./lib/windows-proof-support.ts";
import type { Shell } from "./lib/windows-proof-support.ts";

const SHELLS: readonly Shell[] = WIN ? ["pwsh", "cmd"] : ["pwsh"];
const NOT_WINDOWS = "needs the real Windows Task Scheduler";
const NO_PYTHON = "no plain python3/python on the PATH of the runner";

const interpreters = () =>
  resolveInterpreters({ platform: process.platform, env: process.env, isFile: defaultIsFile });

function withSandbox<T>(body: (fx: Fixture) => T): T {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "windows-curator-")));
  try {
    return body(makeFixture(root, interpreters()));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/** What `--dry-run --frequency weekly --hour 9` must print for the platform of the host. */
const SCHEDULE_MARKERS: Record<string, readonly string[]> = {
  win32: ["Target OS:  Windows", "CalendarTrigger", "ScheduleByWeek", "crewrig:service-task"],
  linux: ["Target OS:  Linux", "[Timer]", "OnCalendar="],
  darwin: ["Target OS:  Darwin", "StartCalendarInterval"],
};

describe("harness-curator entries from PowerShell and cmd.exe (directly on POSIX)", () => {
  for (const shell of SHELLS) {
    it(`${WIN ? shell : "direct"}: curate, setup-labels and schedule-curator`, (t) => {
      withSandbox((fx) => {
        const failures: string[] = [];
        const attempt = (name: string, fn: () => void): void => {
          try {
            fn();
          } catch (error) {
            failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
          }
        };
        const run = (entry: string, args: string[], o: Partial<Invocation> = {}) =>
          runCurator({ fx, entry, args, shell, ...o });
        const python = fx.pythonDir !== undefined;
        if (!python) t.diagnostic(`curate cases skipped: ${NO_PYTHON}`);

        attempt("wc-curate-dry-run-stdin", () => {
          if (!python) return;
          const r = run("curate", ["--from-stdin", "--dry-run"], {
            python: true,
            input: sampleFrictions(),
          });
          expectStatus(r, 0);
          assert.equal(r.out, golden("curate-stdin-sample-dry-run", "stdout"), why(r, "stdout"));
          assert.equal(r.err, golden("curate-stdin-sample-dry-run", "stderr"), why(r, "stderr"));
        });
        attempt("wc-curate-apply-without-gh", () => {
          if (!python) return;
          const r = run("curate", ["--from-stdin", "--apply"], {
            python: true,
            input: sampleFrictions(),
          });
          expectStatus(r, 3);
          assert.equal(r.err, golden("curate-apply-without-gh", "stderr"), why(r, "stderr"));
          assert.deepEqual(r.ghCalls, [], why(r, "no gh was on the PATH"));
        });
        attempt("wc-setup-labels-dry-run", () => {
          const r = run("setup-labels", ["--dry-run"]);
          expectStatus(r, 0);
          assert.equal(r.out, golden("setup-labels-dry-run", "stdout"), why(r, "stdout"));
          assert.equal(r.out.split("\n").filter((l) => l !== "").length, 9, why(r, "nine lines"));
        });
        attempt("wc-setup-labels-apply", () => {
          const r = run("setup-labels", [], { gh: true });
          expectStatus(r, 0);
          assert.equal(r.out, golden("setup-labels-all-succeed", "stdout"), why(r, "stdout"));
          assert.equal(
            r.out.split("\n").filter((l) => l.startsWith("ok: ")).length,
            9,
            why(r, "ok"),
          );
          assert.equal(r.ghCalls.length, 9, why(r, "nine gh calls"));
          for (const call of r.ghCalls)
            assert.deepEqual(call.slice(0, 2), ["label", "create"], why(r, `gh ${call.join(" ")}`));
        });
        attempt("wc-setup-labels-one-fails", () => {
          const r = run("setup-labels", [], { gh: true, env: { GH_FAIL_LABEL: "room:format" } });
          expectStatus(r, 2);
          const name = "setup-labels-fourth-label-fails";
          assert.equal(r.out, golden(name, "stdout"), why(r, "stdout"));
          assert.equal(r.err, golden(name, "stderr"), why(r, "stderr"));
          assert.equal(r.ghCalls.length, 9, why(r, "every label is attempted"));
        });
        attempt("wc-schedule-dry-run", () => {
          const r = run("schedule-curator", ["--dry-run", "--frequency", "weekly", "--hour", "9"], {
            gh: true,
          });
          expectStatus(r, 0);
          const markers = SCHEDULE_MARKERS[process.platform] ?? [];
          assert.notEqual(markers.length, 0, `no markers for ${process.platform}`);
          for (const marker of markers)
            assert.ok(r.out.includes(marker), why(r, `stdout lacks ${JSON.stringify(marker)}`));
          assert.ok(r.out.includes(entryPath("curate")), why(r, "stdout names curate.ts"));
        });
        if (WIN)
          attempt("wc-schedule-uninstall-nothing", () => {
            // Queries the REAL Task Scheduler, read-only, for the curator's own task name.
            const r = run("schedule-curator", ["--uninstall"]);
            expectStatus(r, 0);
            assert.ok(r.out.includes("nothing to remove"), why(r, "stdout"));
          });
        attempt("wc-no-cr", () => {
          assertNoCarriageReturn(fx);
          noBashCalled(fx);
        });
        assert.deepEqual(failures, [], `\n${failures.map((f, i) => `${i + 1}. ${f}`).join("\n")}`);
      });
    });
  }
});

describe(
  "harness-curator service layer on the real Task Scheduler",
  { skip: !WIN && NOT_WINDOWS },
  () => {
    it("registers, finds and removes a throwaway task, with no carriage return in its XML", () => {
      const names = curatorNames(`crewrig-test-curator-${process.pid}-${Date.now()}`);
      const backend = createScheduleBackend();
      const root = fs.realpathSync.native(
        fs.mkdtempSync(path.join(os.tmpdir(), "windows-curator-")),
      );
      const spec: ScheduleSpec = {
        frequency: "weekly",
        hour: 9,
        nodePath: process.execPath,
        entry: entryPath("curate"),
        args: ["--apply", "--dedup", "--max-issues", "5"],
        pathValue: process.env["PATH"] ?? "C:\\Windows\\System32",
        logFile: path.join(root, "curator.log"),
      };
      const query = () =>
        spawnSync("schtasks", ["/Query", "/TN", names.taskPath, "/XML"], { encoding: "utf8" });
      try {
        assert.ok(
          !renderCalendarTaskXml(names, spec, currentUserId()).includes("\r"),
          "XML holds CR",
        );
        const installed = backend.install(names, spec);
        assert.ok(installed.ok, `install: ${JSON.stringify(installed)}`);
        const found = query();
        assert.equal(found.status, 0, `${found.stdout}\n${found.stderr}`);
        for (const marker of ["ScheduleByWeek", "crewrig:service-task"])
          assert.ok(found.stdout.includes(marker), `${marker} missing from ${found.stdout}`);
        const removed = backend.uninstall(names);
        assert.ok(removed.ok, `uninstall: ${JSON.stringify(removed)}`);
        assert.notEqual(query().status, 0, "the task is still registered");
      } finally {
        backend.uninstall(names);
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  },
);

describe("windows curator proof helpers", () => {
  it("finds a python on a host that has one, or reports none", () => {
    const python = findPython();
    assert.ok(python === undefined || path.isAbsolute(python), String(python));
  });
});
