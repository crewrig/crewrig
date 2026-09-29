// setup-dependency-step.test.ts — tests for install_production_dependencies in
// scripts/lib/common.sh and its wiring in the four setup scripts (spec 0240
// R4-R6, delta-01 R5; plan v3 Step 10).
//
// Every case sources common.sh in `bash -c` against its own fresh mkdtemp
// fixture checkout, spawned with `cwd` set to that checkout (plan review
// v3-F1): even a helper that lost its `cd` would still write inside the
// fixture, never into this repository's node_modules/.
//
// Stub-npm contract (frozen by plan v3): a POSIX sh `npm` first on PATH that
//   1. appends `<argv>\t<NODE_EXTRA_CA_CERTS>\t<PWD>` to $STUB_NPM_LOG;
//   2. writes $STUB_NPM_STDERR to stderr when set;
//   3. exits $STUB_NPM_EXIT (default 0), and ONLY on exit 0 first runs
//      `mkdir -p node_modules && : > node_modules/.stub-installed` in its
//      working directory, mimicking the reification of a successful `npm ci`.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const COMMON = path.join(REPO, "scripts", "lib", "common.sh");
const STAMP_REL = path.join(".crewrig-state", "production-deps.sha256");
const SETUP_SCRIPTS = ["claude", "gemini", "copilot", "antigravity"].map((cli) =>
  path.join(REPO, "scripts", `setup-${cli}-interactive.sh`),
);

const STUB_NPM = `#!/bin/sh
printf '%s\\t%s\\t%s\\n' "$*" "\${NODE_EXTRA_CA_CERTS:-}" "$PWD" >> "$STUB_NPM_LOG"
if [ -n "\${STUB_NPM_STDERR:-}" ]; then printf '%s\\n' "$STUB_NPM_STDERR" >&2; fi
code="\${STUB_NPM_EXIT:-0}"
if [ "$code" = 0 ]; then mkdir -p node_modules && : > node_modules/.stub-installed; fi
exit "$code"
`;

// One-package lockfile generated with `npm install --package-lock-only`
// (plan v3 v2-F3): the `ms` entry gives an offline `npm ci` something to fetch.
const MS_MANIFEST = {
  name: "fixture",
  version: "1.0.0",
  private: true,
  dependencies: { ms: "2.1.3" },
};
const MS_LOCKFILE = {
  name: "fixture",
  version: "1.0.0",
  lockfileVersion: 3,
  requires: true,
  packages: {
    "": { name: "fixture", version: "1.0.0", dependencies: { ms: "2.1.3" } },
    "node_modules/ms": {
      version: "2.1.3",
      resolved: "https://registry.npmjs.org/ms/-/ms-2.1.3.tgz",
      integrity:
        "sha512-6FlzubTLZG3J2a/NVCAleEhjzq5oxgHyaCU9yYXvcLsvoVaHJq/s5xXI6/XXP6tz7R9xAOtHnSO/tXtF3WRTlA==",
      license: "MIT",
    },
  },
};

const temps: string[] = [];
after(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

function mkTemp(prefix: string): string {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  temps.push(dir);
  return dir;
}

interface Fixture {
  checkout: string;
  home: string;
  stubBin: string;
  log: string;
}

/** A fresh checkout with the ms manifest/lockfile, tls-exec.sh, a HOME and a stub bin. */
function fixture(): Fixture {
  const checkout = mkTemp("crewrig-depstep-");
  fs.writeFileSync(
    path.join(checkout, "package.json"),
    `${JSON.stringify(MS_MANIFEST, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(checkout, "package-lock.json"),
    `${JSON.stringify(MS_LOCKFILE, null, 2)}\n`,
  );
  fs.mkdirSync(path.join(checkout, "scripts", "lib"), { recursive: true });
  fs.copyFileSync(
    path.join(REPO, "scripts", "lib", "tls-exec.sh"),
    path.join(checkout, "scripts", "lib", "tls-exec.sh"),
  );
  const home = path.join(checkout, ".home");
  const stubBin = path.join(checkout, ".stub-bin");
  fs.mkdirSync(home);
  fs.mkdirSync(stubBin);
  fs.writeFileSync(path.join(stubBin, "npm"), STUB_NPM, { mode: 0o755 });
  return { checkout, home, stubBin, log: path.join(checkout, ".stub-npm.log") };
}

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Source common.sh and run the helper in the fixture; `stub: false` uses the real npm. */
function runStep(fx: Fixture, extraEnv: Record<string, string> = {}, stub = true): Run {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: fx.home,
    STUB_NPM_LOG: fx.log,
    ...extraEnv,
  };
  for (const key of ["NODE_EXTRA_CA_CERTS", "STUB_NPM_EXIT", "STUB_NPM_STDERR"]) {
    if (!(key in extraEnv)) delete env[key];
  }
  if (stub) env.PATH = `${fx.stubBin}${path.delimiter}${process.env.PATH ?? ""}`;
  const res = spawnSync(
    "bash",
    ["-c", 'source "$1" && install_production_dependencies "$2"', "bash", COMMON, fx.checkout],
    { cwd: fx.checkout, env, encoding: "utf8", timeout: 120_000 },
  );
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

function calls(fx: Fixture): string[][] {
  if (!fs.existsSync(fx.log)) return [];
  return fs
    .readFileSync(fx.log, "utf8")
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => l.split("\t"));
}

function lockHash(fx: Fixture): string {
  return createHash("sha256")
    .update(fs.readFileSync(path.join(fx.checkout, "package-lock.json")))
    .digest("hex");
}

function stamp(fx: Fixture): string | undefined {
  const file = path.join(fx.checkout, STAMP_REL);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim() : undefined;
}

const installed = (fx: Fixture): boolean =>
  fs.existsSync(path.join(fx.checkout, "node_modules", ".stub-installed"));

/** Case 1's invocation; cases 2-4 run it first inside their own fixture. */
function firstRun(fx: Fixture): Run {
  const res = runStep(fx);
  assert.equal(res.status, 0, res.stderr);
  return res;
}

describe("install_production_dependencies (stub npm)", () => {
  test("1. first run: npm ci --omit=dev --workspaces=false once, tree and stamp written", () => {
    const fx = fixture();
    firstRun(fx);
    const log = calls(fx);
    assert.equal(log.length, 1);
    assert.equal(log[0]?.[0], "ci --omit=dev --workspaces=false");
    assert.equal(log[0]?.[2], fx.checkout);
    assert.ok(installed(fx));
    assert.equal(stamp(fx), lockHash(fx));
  });

  test("2. unchanged lockfile: skipped with a named reason, npm not called", () => {
    const fx = fixture();
    firstRun(fx);
    const res = runStep(fx);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(calls(fx).length, 1);
    assert.match(res.stdout, /Production dependencies: skipped/);
    assert.match(res.stdout, /package-lock\.json unchanged/);
  });

  test("3. changed lockfile: re-run on the hash mismatch alone", () => {
    const fx = fixture();
    firstRun(fx);
    fs.appendFileSync(path.join(fx.checkout, "package-lock.json"), " ");
    assert.ok(installed(fx));
    const res = runStep(fx);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(calls(fx).length, 2);
    assert.equal(stamp(fx), lockHash(fx));
  });

  test("4. removed tree: the stamp is invalidated and npm re-runs", () => {
    const fx = fixture();
    firstRun(fx);
    fs.rmSync(path.join(fx.checkout, "node_modules"), { recursive: true, force: true });
    assert.equal(stamp(fx), lockHash(fx));
    const res = runStep(fx);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(calls(fx).length, 2);
    assert.ok(installed(fx));
  });

  test("5. failure: non-zero exit, npm diagnostic surfaced, tree removed, no stamp", () => {
    const fx = fixture();
    fs.mkdirSync(path.join(fx.checkout, "node_modules"));
    fs.writeFileSync(path.join(fx.checkout, "node_modules", ".stub-installed"), "");
    fs.mkdirSync(path.join(fx.checkout, ".crewrig-state"));
    fs.writeFileSync(path.join(fx.checkout, STAMP_REL), "0".repeat(64));
    const res = runStep(fx, { STUB_NPM_EXIT: "1", STUB_NPM_STDERR: "npm ERR! stub" });
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /npm ERR! stub/);
    assert.match(res.stderr, /ERROR: production dependency install failed/);
    assert.equal(fs.existsSync(path.join(fx.checkout, "node_modules")), false);
    assert.equal(stamp(fx), undefined);
    // Neither the stamp nor any temporary stamp file is left behind.
    assert.deepEqual(fs.readdirSync(path.join(fx.checkout, ".crewrig-state")), []);
  });

  test("6. TLS routing: npm runs through tls-exec.sh and sees the managed CA", () => {
    const fx = fixture();
    fs.mkdirSync(path.join(fx.home, ".crewrig"));
    fs.writeFileSync(
      path.join(fx.home, ".crewrig", "tls-env.sh"),
      "export NODE_EXTRA_CA_CERTS=/fixture/ca.pem\n",
    );
    firstRun(fx);
    assert.equal(calls(fx)[0]?.[1], "/fixture/ca.pem");
  });
});

describe("setup-script wiring", () => {
  /** Line number (1-based) of the first non-comment line matching `re`, as first_call does. */
  function firstCall(lines: string[], re: RegExp): number | undefined {
    const idx = lines.findIndex((l) => re.test(l) && !/^\s*#/.test(l));
    return idx === -1 ? undefined : idx + 1;
  }

  for (const script of SETUP_SCRIPTS) {
    test(`7. ${path.basename(script)}: after offer_tls_delegation, before ensure_tier_built`, () => {
      const lines = fs.readFileSync(script, "utf8").split("\n");
      const tls = firstCall(lines, /^\s*offer_tls_delegation(\s|$)/);
      const step = firstCall(lines, /^\s*install_production_dependencies\s/);
      const tier = firstCall(lines, /^\s*ensure_tier_built\s/);
      assert.ok(
        tls !== undefined && step !== undefined && tier !== undefined,
        `${tls} ${step} ${tier}`,
      );
      assert.ok(tls < step, `offer_tls_delegation (l${tls}) must precede the step (l${step})`);
      assert.ok(step < tier, `the step (l${step}) must precede ensure_tier_built (l${tier})`);
    });
  }
});

describe("install_production_dependencies (real npm)", () => {
  test("8. first install fails offline with npm's fetch error", () => {
    const fx = fixture();
    const res = runStep(
      fx,
      {
        npm_config_registry: "http://127.0.0.1:9",
        npm_config_cache: mkTemp("crewrig-npm-cache-"),
        npm_config_fetch_retries: "0",
        npm_config_fetch_timeout: "10000",
        npm_config_audit: "false",
        npm_config_fund: "false",
        npm_config_update_notifier: "false",
      },
      false,
    );
    assert.notEqual(res.status, 0, res.stdout);
    assert.match(res.stderr, /ERROR: production dependency install failed/);
    assert.match(res.stderr, /ECONNREFUSED/);
    assert.equal(stamp(fx), undefined);
    assert.equal(fs.existsSync(path.join(fx.checkout, "node_modules")), false);
  });
});
