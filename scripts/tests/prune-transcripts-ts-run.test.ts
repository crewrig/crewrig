// prune-transcripts-ts-run.test.ts — the TLS environment and the run of the TypeScript port of
// prune-transcripts (spec 0253 R16-R18, delta-01 R25 items 8-9), through `runPrune` with
// injected effects and a throw-away home directory. Companion of prune-transcripts-ts.test.ts.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

import { buildChildEnv, loadTls } from "./../lib/history-import/prune-env.ts";
import { runPrune } from "./../lib/history-import/prune-run.ts";
import type { PruneDeps } from "./../lib/history-import/prune-run.ts";

/** A fake file system: the set of existing paths; every one is an executable file. */
function fakeIo(paths: readonly string[], pipxHome?: string) {
  const set = new Set(paths);
  return {
    exists: (p: string) => set.has(p),
    isExecutableFile: (p: string) => set.has(p),
    pipxHome: () => pipxHome,
  };
}

function withHome<T>(tlsFile: string | undefined, body: (home: string, file: string) => T): T {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "prune-ts-"));
  const file = path.join(home, ".crewrig", "tls-env.sh");
  try {
    if (tlsFile !== undefined) {
      fs.mkdirSync(path.dirname(file));
      fs.writeFileSync(file, tlsFile);
    }
    return body(home, file);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

describe("TLS environment", () => {
  test("a well-formed file yields its variables and no warning", () => {
    withHome("# c\nexport SSL_CERT_FILE=/tmp/a.pem\n", (home) => {
      assert.deepEqual(loadTls(home), {
        vars: { SSL_CERT_FILE: "/tmp/a.pem" },
        warning: undefined,
      });
    });
  });
  test("an absent file yields nothing and no warning", () => {
    withHome(undefined, (home) => {
      assert.deepEqual(loadTls(home), { vars: {}, warning: undefined });
    });
  });
  test("a malformed file applies nothing and warns with the file and line", () => {
    withHome("export A=1\nrm -rf /\n", (home, file) => {
      assert.deepEqual(loadTls(home), {
        vars: {},
        warning: `Warning: ${file} is unreadable or malformed (line 2); no custom CA variable applied`,
      });
    });
  });
  test("an unreadable file (a directory) applies nothing and warns without a line", () => {
    withHome(undefined, (home) => {
      const file = path.join(home, ".crewrig", "tls-env.sh");
      fs.mkdirSync(file, { recursive: true });
      const r = loadTls(home);
      assert.deepEqual(r.vars, {});
      assert.equal(
        r.warning,
        `Warning: ${file} is unreadable or malformed; no custom CA variable applied`,
      );
    });
  });
  test("buildChildEnv lets the file override the inherited value and sets the run variables", () => {
    const env = buildChildEnv(
      { SSL_CERT_FILE: "/inherited", KEEP: "1" },
      { SSL_CERT_FILE: "/file" },
      {
        cutoff: "2026-09-09",
        dryRun: false,
        project: "p",
        installSpec: "mempalace",
      },
    );
    assert.deepEqual(env, {
      SSL_CERT_FILE: "/file",
      KEEP: "1",
      TRANSCRIPTS_WING: "transcripts",
      PROJECT_FILTER: "p",
      CUTOFF_DATE: "2026-09-09",
      DRY_RUN: "false",
      MEMPALACE_INSTALL_SPEC: "mempalace",
    });
  });
});

interface Recorded {
  command: string;
  args: readonly string[];
  env: NodeJS.ProcessEnv;
}

/** Drive runPrune with fake effects; the interpreter is `/fake/py` unless the env says otherwise. */
function drive(
  argv: string[],
  options: {
    home?: string;
    env?: NodeJS.ProcessEnv;
    status?: number;
    exists?: boolean;
    paths?: string[];
  } = {},
) {
  const out: string[] = [];
  const err: string[] = [];
  const spawned: Recorded[] = [];
  const pipxEnvs: NodeJS.ProcessEnv[] = [];
  const deps: PruneDeps = {
    ...fakeIo(options.exists === false ? [] : ["/fake/py", ...(options.paths ?? [])]),
    installSpec: "mempalace>=3.6.0,<3.7",
    script: "scripts/prune-transcripts.ts",
    platform: "linux",
    pythonFile: "/repo/prune_drawers.py",
    now: () => new Date(2026, 9, 9),
    pipxHome: (env) => {
      pipxEnvs.push(env);
      return "/h";
    },
    spawn: (command, args, env) => {
      spawned.push({ command, args, env });
      return options.status ?? 0;
    },
  };
  const home = options.home ?? os.tmpdir();
  const env = { MEMPALACE_PYTHON: "/fake/py", ...options.env };
  const status = runPrune(
    argv,
    env,
    home,
    { out: (l) => out.push(l), err: (l) => err.push(l) },
    deps,
  );
  return { status, out, err, spawned, pipxEnvs };
}

describe("runPrune", () => {
  test("prints the banner, then spawns the interpreter on prune_drawers.py with the run environment", () => {
    const r = drive(["--days", "7", "--project", "x"], { home: "/nonexistent-home" });
    assert.equal(r.status, 0);
    assert.deepEqual(r.out, [
      "=========================================",
      "  Transcript Prune",
      "=========================================",
      "Wing:        transcripts",
      "Cutoff date: 2026-10-02 (older than 7 days)",
      "Dry run:     true",
      "Project:      x (filter only)",
      "",
    ]);
    assert.equal(r.spawned.length, 1);
    const [call] = r.spawned as [Recorded];
    assert.equal(call.command, "/fake/py");
    assert.deepEqual(call.args, ["/repo/prune_drawers.py"]);
    assert.equal(call.env["DRY_RUN"], "true");
    assert.equal(call.env["PROJECT_FILTER"], "x");
    assert.equal(call.env["CUTOFF_DATE"], "2026-10-02");
    assert.equal(call.env["TRANSCRIPTS_WING"], "transcripts");
    assert.equal(call.env["MEMPALACE_INSTALL_SPEC"], "mempalace>=3.6.0,<3.7");
  });
  test("--apply flips DRY_RUN and omits the Project line when unfiltered", () => {
    const r = drive(["--apply"], { home: "/nonexistent-home" });
    assert.ok(r.out.includes("Dry run:     false"));
    assert.ok(!r.out.some((l) => l.startsWith("Project:")));
    assert.equal(r.spawned[0]?.env["DRY_RUN"], "false");
    assert.ok(r.out.includes("Cutoff date: 2026-09-09 (older than 30 days)"));
  });
  test("returns the child's exit status", () => {
    assert.equal(drive([], { status: 4, home: "/nonexistent-home" }).status, 4);
  });
  test("--help prints the usage on stdout, exit 0, nothing spawned", () => {
    const r = drive(["-h"]);
    assert.equal(r.status, 0);
    assert.ok(r.out[0]?.startsWith("Usage: scripts/prune-transcripts.ts"));
    assert.equal(r.spawned.length, 0);
  });
  test("an argument error goes to stderr, exit 1, nothing spawned", () => {
    const r = drive(["--days", "0"]);
    assert.equal(r.status, 1);
    assert.deepEqual(r.err, ["Error: --days must be at least 1"]);
    assert.deepEqual(r.out, []);
    assert.equal(r.spawned.length, 0);
  });
  test("a missing interpreter is reported before the banner", () => {
    const r = drive([], { exists: false, home: "/nonexistent-home" });
    assert.equal(r.status, 1);
    assert.deepEqual(r.err, [
      "Error: /fake/py not found",
      "Install MemPalace via pipx: pipx install 'mempalace>=3.6.0,<3.7'",
    ]);
    assert.deepEqual(r.out, []);
    assert.equal(r.spawned.length, 0);
  });
  test("a trust file overrides an inherited SSL_CERT_FILE in the child", () => {
    withHome("export SSL_CERT_FILE=/tmp/from-file.pem\n", (home) => {
      const r = drive([], { home, env: { SSL_CERT_FILE: "/tmp/inherited.pem" } });
      assert.equal(r.spawned[0]?.env["SSL_CERT_FILE"], "/tmp/from-file.pem");
      assert.deepEqual(r.err, []);
    });
  });
  test("the TLS variables reach the pipx child", () => {
    withHome("export SSL_CERT_FILE=/tmp/from-file.pem\n", (home) => {
      const r = drive([], {
        home,
        env: { MEMPALACE_PYTHON: "", PATH: "/bin", SSL_CERT_FILE: "/tmp/inherited.pem" },
        paths: ["/bin/pipx", "/h/venvs/mempalace", "/h/venvs/mempalace/bin/python3"],
      });
      assert.equal(r.status, 0);
      assert.equal(r.pipxEnvs.length, 1);
      assert.equal(r.pipxEnvs[0]?.["SSL_CERT_FILE"], "/tmp/from-file.pem");
      assert.equal(r.spawned[0]?.command, "/h/venvs/mempalace/bin/python3");
    });
  });
  test("a malformed trust file warns once, applies nothing and the run continues", () => {
    withHome("export A=1\nnot a variable\n", (home, file) => {
      const r = drive([], { home, env: { SSL_CERT_FILE: "/tmp/inherited.pem" } });
      assert.equal(r.status, 0);
      assert.deepEqual(r.err, [
        `Warning: ${file} is unreadable or malformed (line 2); no custom CA variable applied`,
      ]);
      assert.equal(r.spawned[0]?.env["SSL_CERT_FILE"], "/tmp/inherited.pem");
      assert.equal(r.spawned[0]?.env["A"], undefined);
    });
  });
});
