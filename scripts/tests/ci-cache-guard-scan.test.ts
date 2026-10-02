// ci-cache-guard-scan.test.ts — tests for the `--stray-scan` mode of
// scripts/ci-cache-guard.sh (spec 0170 delta-01 R10-R14, issue #1445).
//
// The mode runs one suite command, passes its stdout and stderr through on their
// own streams, preserves its exit status, and fails the job when the shell's
// not-found phrase (`command not found`) appears on either stream:
//
//   bash scripts/ci-cache-guard.sh --stray-scan -- <command...>
//
// Contract pinned here:
//   - clean run: streams and status untouched (R12);
//   - a visible stray fails with the command's own non-zero status, else 70, and
//     prints `ci-cache-guard: stray-scan: STRAY in: <command>` plus the matched
//     lines on stderr (R11);
//   - the window is the suite command only (R10);
//   - a shell that cannot print the phrase makes the detector inactive: exit 71,
//     command not run, never read as zero strays (R13);
//   - exclusive with the cache options: exit 2;
//   - nothing is left in the working directory or the TMPDIR (R12);
//   - nested under the cache guard, a stray leaves no marker and an old marker of
//     the bare command cannot certify the scanned one (R11);
//   - the classes of stray the scan cannot see are pinned as UNDETECTED (R14), and
//     a suite that merely prints the phrase is a pinned false positive (remedy:
//     reword the suite).
//
// Standard library only: it runs before `npm ci`. Every fixture runs under
// LC_ALL=C so the shell prints the English phrase whatever the host locale.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const GUARD = path.join(REPO, "scripts", "ci-cache-guard.sh");

/** The absolute path of the bash the tests run the guard with (a fake `bash` may shadow `bash` on PATH). */
const BASH = (() => {
  const res = spawnSync("bash", ["-c", "command -v bash"], { encoding: "utf8" });
  assert.equal(res.status, 0, "no bash on PATH");
  return res.stdout.trim();
})();

// --- Fixtures --------------------------------------------------------------------

const temps: string[] = [];
after(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

interface Fx {
  /** Fake executables, put first on PATH when a test asks for it. */
  bin: string;
  /** Suite scripts. */
  suites: string;
  /** The working directory of every run: must stay empty of guard leftovers. */
  work: string;
  /** TMPDIR of every run. */
  tmp: string;
}

function fx(): Fx {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stray-scan-"));
  temps.push(root);
  const dirs = { bin: "bin", suites: "suites", work: "work", tmp: "tmp" };
  const out: Fx = { bin: "", suites: "", work: "", tmp: "" };
  for (const [key, name] of Object.entries(dirs) as [keyof Fx, string][]) {
    out[key] = path.join(root, name);
    fs.mkdirSync(out[key]);
  }
  return out;
}

/** Write an executable file and return its absolute path. */
function script(dir: string, name: string, body: string): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, body, { mode: 0o755 });
  return file;
}

/** A suite script (run as `bash <file>`). */
function suite(f: Fx, name: string, body: string): string {
  return script(f.suites, name, `#!/usr/bin/env bash\n${body}\n`);
}

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
  all: string;
}

interface RunOptions {
  /** Put `f.bin` first on PATH. */
  fakePath?: boolean;
  input?: string;
  env?: Record<string, string>;
}

function execute(f: Fx, file: string, args: string[], opts: RunOptions = {}): Run {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of ["CREWRIG_REPO_DIR", "GIT_DIR", "GIT_WORK_TREE"]) delete env[key];
  env.LC_ALL = "C";
  env.LANG = "C";
  env.TMPDIR = f.tmp;
  if (opts.fakePath === true) env.PATH = `${f.bin}${path.delimiter}${process.env.PATH ?? ""}`;
  Object.assign(env, opts.env);
  const res = spawnSync(BASH, [file, ...args], {
    cwd: f.work,
    encoding: "utf8",
    env,
    input: opts.input ?? "",
    timeout: 60_000,
  });
  const stdout = res.stdout ?? "";
  const stderr = res.stderr ?? "";
  return { status: res.status, stdout, stderr, all: `--- stdout\n${stdout}--- stderr\n${stderr}` };
}

/** `bash ci-cache-guard.sh --stray-scan -- <command...>` */
function scan(f: Fx, command: string[], opts: RunOptions = {}): Run {
  return execute(f, GUARD, ["--stray-scan", "--", ...command], opts);
}

/** Scan a suite script run as `bash <suite>`. */
function scanSuite(f: Fx, file: string, opts: RunOptions = {}): Run {
  return scan(f, ["bash", file], opts);
}

/** The part of stderr from the first `STRAY in:` line on: the report. */
function report(run: Run): string {
  const at = run.stderr.indexOf("STRAY in:");
  return at < 0 ? "" : run.stderr.slice(at);
}

const STRAY_LINE = /stray-scan: STRAY in: /;

/** Fake `bash` that prints a translated not-found message, as a French-locale shell would. */
function fakeTranslatedBash(f: Fx): void {
  script(
    f.bin,
    "bash",
    '#!/bin/sh\necho "bash: ligne 1: $2: commande introuvable" >&2\nexit 127\n',
  );
}

// --- Pass-through, status, streams (R12) -------------------------------------------

describe("stray-scan: a clean command is invisible", () => {
  test("stdout and stderr pass through on their own streams and the status is 0", () => {
    const f = fx();
    const s = suite(f, "clean.sh", "echo out-line\necho err-line >&2");

    const r = scanSuite(f, s);

    assert.equal(r.status, 0, r.all);
    assert.ok(r.stdout.includes("out-line"), r.all);
    assert.ok(!r.stdout.includes("err-line"), `stderr leaked into stdout:\n${r.all}`);
    assert.ok(r.stderr.includes("err-line"), r.all);
    assert.ok(!r.stderr.includes("out-line"), `stdout leaked into stderr:\n${r.all}`);
    assert.doesNotMatch(r.all, /STRAY/);
  });

  test("standard input is inherited by the command", () => {
    const f = fx();

    const r = scan(f, ["cat"], { input: "hello-stdin\n" });

    assert.equal(r.status, 0, r.all);
    assert.ok(r.stdout.includes("hello-stdin"), r.all);
  });

  for (const code of [1, 3, 127]) {
    test(`the command's exit status ${code} is preserved and its output still passes through`, () => {
      const f = fx();
      const s = suite(f, `exit${code}.sh`, `echo before-exit\nexit ${code}`);

      const r = scanSuite(f, s);

      assert.equal(r.status, code, r.all);
      assert.ok(r.stdout.includes("before-exit"), r.all);
      assert.doesNotMatch(r.all, /STRAY/);
    });
  }

  test("under `bash -eo pipefail` a failing command aborts the caller with its own status", () => {
    const f = fx();
    const s = suite(f, "fails.sh", "echo before-fail\nexit 3");
    const driver = script(
      f.suites,
      "driver-e.sh",
      `#!/usr/bin/env bash\nset -eo pipefail\n"$BASH_REAL" "$GUARD" --stray-scan -- bash ${s}\necho AFTER\n`,
    );

    const r = execute(f, driver, [], { env: { BASH_REAL: BASH, GUARD } });

    assert.equal(r.status, 3, r.all);
    assert.ok(r.stdout.includes("before-fail"), r.all);
    assert.ok(!r.stdout.includes("AFTER"), `the job did not abort:\n${r.all}`);
  });

  test("without -e the caller reads the command's status from $?", () => {
    const f = fx();
    const s = suite(f, "fails.sh", "exit 3");
    const driver = script(
      f.suites,
      "driver.sh",
      `#!/usr/bin/env bash\n"$BASH_REAL" "$GUARD" --stray-scan -- bash ${s}\necho "rc=$?"\n`,
    );

    const r = execute(f, driver, [], { env: { BASH_REAL: BASH, GUARD } });

    assert.ok(r.stdout.includes("rc=3"), r.all);
  });
});

// --- Detection and attribution (R10, R11) ------------------------------------------

describe("stray-scan: a visible stray fails the command", () => {
  test("a stray in a nested `bash -c` with exit 0 fails with 70, naming the stray and the suite command", () => {
    const f = fx();
    const s = suite(f, "nested-stray.sh", "echo start\nbash -c 'bogus-xyz'\nexit 0");

    const r = scanSuite(f, s);

    assert.equal(r.status, 70, r.all);
    assert.ok(r.stdout.includes("start"), r.all);
    assert.match(r.stderr, STRAY_LINE);
    assert.match(r.stderr, /STRAY in: .*nested-stray\.sh/, "the report names the suite command");
    assert.ok(report(r).includes("bogus-xyz"), `the report names the stray:\n${r.all}`);
    assert.ok(
      r.stderr.includes("bogus-xyz: command not found"),
      `the original message still reaches stderr:\n${r.all}`,
    );
  });

  test("a stray raised directly by the suite is reported with its file and line", () => {
    const f = fx();
    const s = suite(f, "direct-stray.sh", "echo one\nbogus-direct\nexit 0");

    const r = scanSuite(f, s);

    assert.equal(r.status, 70, r.all);
    assert.match(report(r), /direct-stray\.sh: line \d+: bogus-direct: command not found/);
  });

  test("a stray whose message is routed to stdout is seen too", () => {
    const f = fx();
    const s = suite(f, "stdout-stray.sh", "bash -c 'bogus-out' 2>&1\nexit 0");

    const r = scanSuite(f, s);

    assert.equal(r.status, 70, r.all);
    assert.ok(r.stdout.includes("bogus-out: command not found"), r.all);
    assert.ok(report(r).includes("bogus-out"), r.all);
  });

  // v1-F1: the first recipe lost both the report and the status under `set -euo pipefail`.
  test("a command that fails AND strays reports the stray and keeps its own non-zero status", () => {
    const f = fx();
    const s = suite(f, "fail-and-stray.sh", "echo start\nbash -c 'bogus-both'\nexit 3");

    const r = scanSuite(f, s);

    assert.equal(r.status, 3, r.all);
    assert.match(r.stderr, /STRAY in: .*fail-and-stray\.sh/, r.all);
    assert.ok(report(r).includes("bogus-both"), `the report names the stray:\n${r.all}`);
    assert.ok(r.stdout.includes("start"), r.all);
  });

  test("a stray that is the last command keeps status 127 and is reported", () => {
    const f = fx();
    const s = suite(f, "last-stray.sh", "bash -c 'bogus-last'");

    const r = scanSuite(f, s);

    assert.equal(r.status, 127, r.all);
    assert.ok(report(r).includes("bogus-last"), r.all);
  });

  test("the window is the scanned command only: strays outside it are not attributed", () => {
    const f = fx();
    const s = suite(f, "clean.sh", "echo clean-run");
    const driver = script(
      f.suites,
      "window.sh",
      [
        "#!/usr/bin/env bash",
        "bash -c 'bogus-before'",
        `"$BASH_REAL" "$GUARD" --stray-scan -- bash ${s}`,
        'echo "rc=$?"',
        "bash -c 'bogus-after'",
        "",
      ].join("\n"),
    );

    const r = execute(f, driver, [], { env: { BASH_REAL: BASH, GUARD } });

    assert.ok(
      r.stdout.includes("rc=0"),
      `the clean command was failed by a foreign stray:\n${r.all}`,
    );
    assert.doesNotMatch(r.all, /STRAY in:/);
    assert.equal(
      r.stderr.split("bogus-before: command not found").length - 1,
      1,
      "the earlier stray is printed once, by its own shell, never again by the guard",
    );
  });
});

// --- The detector proves itself (R13) ----------------------------------------------

describe("stray-scan: an inert detector is not read as zero strays", () => {
  test("a shell that prints a translated message exits 71 with a distinct message and the command is not run", () => {
    const f = fx();
    fakeTranslatedBash(f);
    const sentinel = path.join(f.suites, "ran");
    const s = suite(f, "never.sh", `touch ${sentinel}`);

    const r = execute(f, GUARD, ["--stray-scan", "--", "bash", s], { fakePath: true });

    assert.equal(r.status, 71, r.all);
    assert.match(r.stderr, /detector inactive/);
    assert.doesNotMatch(r.all, /STRAY in:/, "an inert detector is not a stray report");
    assert.ok(!fs.existsSync(sentinel), "the suite must not run when the detector is inactive");
  });
});

// --- Exclusivity -------------------------------------------------------------------

describe("stray-scan: exclusive with the cache options (exit 2)", () => {
  const combos: ReadonlyArray<readonly [string, string[]]> = [
    ["--cache-dir with the default value", ["--cache-dir", ".ci-cache"]],
    ["--cache-dir with another value", ["--cache-dir", "other-cache"]],
    ["--key-files", ["--key-files", "a.txt"]],
    ["--key-env", ["--key-env", "SOME_VAR"]],
  ];
  for (const [label, opt] of combos) {
    for (const order of ["before", "after"] as const) {
      test(`${label} ${order} --stray-scan exits 2 and runs nothing`, () => {
        const f = fx();
        const sentinel = path.join(f.suites, "ran");
        const control = scan(f, ["touch", sentinel]);
        assert.equal(control.status, 0, `--stray-scan alone must work:\n${control.all}`);
        fs.rmSync(sentinel);
        const args =
          order === "before"
            ? [...opt, "--stray-scan", "--", "touch", sentinel]
            : ["--stray-scan", ...opt, "--", "touch", sentinel];

        const r = execute(f, GUARD, args);

        assert.equal(r.status, 2, r.all);
        assert.doesNotMatch(
          r.stderr,
          /unknown option/,
          "a mutual-exclusion error, not an unknown flag",
        );
        assert.ok(!fs.existsSync(sentinel), "the command must not run");
      });
    }
  }

  test("--stray-scan without a command exits 2", () => {
    const f = fx();

    const r = execute(f, GUARD, ["--stray-scan", "--"]);

    assert.equal(r.status, 2, r.all);
    assert.doesNotMatch(r.stderr, /unknown option/);
  });
});

// --- Hygiene (R12) -----------------------------------------------------------------

describe("stray-scan: leaves nothing behind", () => {
  const cases: ReadonlyArray<readonly [string, string, number]> = [
    ["a clean run", "echo ok", 0],
    ["a failing run", "exit 3", 3],
    ["a run with a stray", "bash -c 'bogus-hygiene'", 127],
  ];
  for (const [label, body, status] of cases) {
    test(`${label}: no file in the working directory, the TMPDIR entry removed`, () => {
      const f = fx();
      const s = suite(f, "hygiene.sh", `ls "$TMPDIR" >&2\n${body}`);

      const r = scanSuite(f, s);

      assert.ok(
        r.stderr.includes("stray-scan."),
        `the scratch directory lives under TMPDIR while the command runs:\n${r.all}`,
      );
      assert.equal(r.status, status, r.all);
      assert.deepEqual(fs.readdirSync(f.work), [], "the working directory stays empty");
      assert.deepEqual(fs.readdirSync(f.tmp), [], "the scratch directory is removed");
    });
  }
});

// --- Nested under the cache guard (R11) --------------------------------------------

function markers(dir: string): string[] {
  const found: string[] = [];
  if (!fs.existsSync(dir)) return found;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name.endsWith(".marker"))
      found.push(path.join(entry.parentPath, entry.name));
  }
  return found;
}

/** `ci-cache-guard.sh --cache-dir cache --key-files <kf> --key-env "" -- <inner...>` */
function cached(f: Fx, keyFiles: string, inner: string[], opts: RunOptions = {}): Run {
  return execute(
    f,
    GUARD,
    ["--cache-dir", "cache", "--key-files", keyFiles, "--key-env", "", "--", ...inner],
    opts,
  );
}

describe("stray-scan: nested under the cache guard", () => {
  test("a stray leaves no marker, even when the suite exits 0", () => {
    const f = fx();
    const s = suite(f, "stray.sh", "bash -c 'bogus-cached'\nexit 0");

    const r = cached(f, "", [BASH, GUARD, "--stray-scan", "--", "bash", s]);

    assert.equal(r.status, 70, r.all);
    assert.deepEqual(markers(path.join(f.work, "cache")), []);
  });

  test("a clean run misses then hits: the suite runs once", () => {
    const f = fx();
    const count = path.join(f.suites, "count");
    const s = suite(f, "clean.sh", `echo run >> ${count}`);
    const inner = [BASH, GUARD, "--stray-scan", "--", "bash", s];

    const first = cached(f, "", inner);
    const second = cached(f, "", inner);

    assert.equal(first.status, 0, first.all);
    assert.match(first.stdout, /cache miss/);
    assert.equal(second.status, 0, second.all);
    assert.match(second.stdout, /cache hit/);
    assert.equal(fs.readFileSync(count, "utf8").trim().split("\n").length, 1);
    assert.equal(markers(path.join(f.work, "cache")).length, 1);
  });

  test("a hit pays nothing: the detector probe is not run, so an inert shell cannot fail it (R13)", () => {
    const f = fx();
    const s = suite(f, "clean.sh", "true");
    const inner = [BASH, GUARD, "--stray-scan", "--", "bash", s];
    assert.equal(cached(f, "", inner).status, 0);
    fakeTranslatedBash(f);

    const r = cached(f, "", inner, { fakePath: true });

    assert.equal(r.status, 0, r.all);
    assert.match(r.stdout, /cache hit/);
    assert.doesNotMatch(r.all, /detector inactive/);
  });

  test("a copy of the guard listed in --key-files invalidates the marker when it is edited", () => {
    const f = fx();
    const copy = path.join(f.suites, "guard-copy.sh");
    fs.copyFileSync(GUARD, copy);
    const count = path.join(f.suites, "count");
    const s = suite(f, "clean.sh", `echo run >> ${count}`);
    const inner = [BASH, copy, "--stray-scan", "--", "bash", s];

    const first = cached(f, copy, inner);
    const second = cached(f, copy, inner);
    fs.appendFileSync(copy, "\n# edited scan code\n");
    const third = cached(f, copy, inner);

    assert.match(first.stdout, /cache miss/, first.all);
    assert.match(second.stdout, /cache hit/, second.all);
    assert.match(
      third.stdout,
      /cache miss/,
      `an edit of the scan code must re-execute:\n${third.all}`,
    );
    assert.equal(fs.readFileSync(count, "utf8").trim().split("\n").length, 2);
  });

  test("a marker written for the bare command does not certify the scanned command", () => {
    const f = fx();
    const count = path.join(f.suites, "count");
    const s = suite(f, "clean.sh", `echo run >> ${count}`);

    const bare = cached(f, "", ["bash", s]);
    const bareAgain = cached(f, "", ["bash", s]);
    const scanned = cached(f, "", [BASH, GUARD, "--stray-scan", "--", "bash", s]);

    assert.match(bare.stdout, /cache miss/, bare.all);
    assert.match(bareAgain.stdout, /cache hit/, bareAgain.all);
    assert.match(
      scanned.stdout,
      /cache miss/,
      `the old bare marker certified the scanned run:\n${scanned.all}`,
    );
    assert.equal(fs.readFileSync(count, "utf8").trim().split("\n").length, 2);
  });
});

// --- What the scan cannot see (R14): each class is pinned as UNDETECTED -------------

describe("stray-scan: undetected classes (R14) are pinned", () => {
  test("a stray whose stderr is discarded and whose status is swallowed", () => {
    const f = fx();
    const s = suite(f, "hidden-devnull.sh", "bogus-hidden 2>/dev/null || true\nexit 0");

    const r = scanSuite(f, s);

    assert.equal(r.status, 0, r.all);
    assert.doesNotMatch(r.all, /STRAY/);
  });

  test("a stray captured by a command substitution and never re-emitted", () => {
    const f = fx();
    const s = suite(f, "hidden-capture.sh", "x=$(bogus-captured 2>&1) || true\nexit 0");

    const r = scanSuite(f, s);

    assert.equal(r.status, 0, r.all);
    assert.doesNotMatch(r.all, /STRAY/);
  });

  // dash (the CI images' /bin/sh) prints `sh: 1: <cmd>: not found`: no phrase. A stand-in
  // makes the pin independent of the host, where /bin/sh may be bash and print the phrase.
  test("a stray in a child `sh` that words the message differently (dash)", () => {
    const f = fx();
    script(f.bin, "sh", '#!/bin/sh\necho "sh: 1: $2: not found" >&2\nexit 127\n');
    const s = suite(f, "hidden-sh.sh", "sh -c bogus-dash || true\nexit 0");

    const r = scanSuite(f, s, { fakePath: true });

    assert.equal(r.status, 0, r.all);
    assert.ok(r.stderr.includes("bogus-dash: not found"), "the stand-in sh ran");
    assert.doesNotMatch(r.all, /STRAY/);
  });

  test("a missing command launched through `env`", () => {
    const f = fx();
    const s = suite(f, "hidden-env.sh", "env bogus-env || true\nexit 0");

    const r = scanSuite(f, s);

    assert.equal(r.status, 0, r.all);
    assert.doesNotMatch(r.all, /STRAY/);
  });

  test("a path-qualified missing command", () => {
    const f = fx();
    const s = suite(f, "hidden-path.sh", "./nope-xyz || true\nexit 0");

    const r = scanSuite(f, s);

    assert.equal(r.status, 0, r.all);
    assert.doesNotMatch(r.all, /STRAY/);
  });
});

describe("stray-scan: a pinned false positive", () => {
  // The remedy is to reword the suite, not to exempt it: there is no bypass by design.
  test("a suite that merely prints the phrase fails with 70", () => {
    const f = fx();
    const s = suite(f, "echoes-phrase.sh", 'echo "this suite prints: command not found"\nexit 0');

    const r = scanSuite(f, s);

    assert.equal(r.status, 70, r.all);
    assert.match(r.stderr, /STRAY in: .*echoes-phrase\.sh/);
  });
});
