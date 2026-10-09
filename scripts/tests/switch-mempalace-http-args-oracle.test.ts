// switch-mempalace-http-args-oracle.test.ts — the argument-parsing oracle of
// `scripts/switch-mempalace-http.sh` (spec 0252 R21, PLAN step A3). It fills
// the gap R21 names: `-h` / `--help` and unknown arguments, characterised from
// the shell's observed output and exit status. Every case exits during
// argument parsing, so the daemon is never reached; the temp HOME's token file
// must stay untouched. It passes against the shell original today and,
// unchanged, once the script becomes a shim to TypeScript. POSIX only: skipped
// on win32.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import {
  createHermeticEnv,
  runBash,
  type HermeticEnv,
  type RunResult,
} from "./lib/hermetic-env.ts";

const SWITCH_SCRIPT = path.resolve(import.meta.dirname, "..", "switch-mempalace-http.sh");

// Expected text, read from the usage block of scripts/switch-mempalace-http.sh.
const USAGE_LINE = "Usage: switch-mempalace-http.sh [--rotate|-r]";
const TOKEN = "token_args_CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";

interface Fixture {
  readonly h: HermeticEnv;
  readonly tokenPath: string;
}

/** Run `fn` with a fresh harness holding a provisioned token; the key mirrors `mcp_token_path`. */
function withToken(fn: (fx: Fixture) => void): void {
  const h = createHermeticEnv({ poisonPython: false });
  try {
    fs.mkdirSync(path.join(h.home, ".mempalace"), { recursive: true });
    const palace = path.join(fs.realpathSync(path.join(h.home, ".mempalace")), "palace");
    const key = createHash("sha256").update(palace).digest("hex").slice(0, 24);
    const tokenPath = path.join(h.home, ".mempalace", "server", key, "token");
    fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
    fs.writeFileSync(tokenPath, `${TOKEN}\n`, { mode: 0o600 });
    fn({ h, tokenPath });
  } finally {
    h.dispose();
  }
}

function run(fx: Fixture, ...args: string[]): RunResult {
  return runBash(fx.h, SWITCH_SCRIPT, args);
}

function assertTokenIntact(fx: Fixture): void {
  assert.equal(fs.readFileSync(fx.tokenPath, "utf8").trim(), TOKEN, "token file modified");
}

describe(
  "switch-mempalace-http.sh argument-parsing oracle",
  { skip: process.platform === "win32" },
  () => {
    test("-h and --help print the usage on standard output, exit 0 and touch nothing", () => {
      withToken((fx) => {
        for (const flag of ["-h", "--help"]) {
          const res = run(fx, flag);
          assert.equal(res.status, 0, `${flag} exit status`);
          assert.ok(res.stdout.includes(USAGE_LINE), `${flag} usage missing: ${res.stdout}`);
          assert.ok(
            res.stdout.includes(
              "  --rotate, -r  Rotate the bearer token, replace the daemon process,",
            ),
            `${flag} does not document --rotate: ${res.stdout}`,
          );
          assert.ok(
            res.stdout.includes("re-register every assistant with the new token (spec 0176)."),
            `${flag} rotate description truncated: ${res.stdout}`,
          );
          assert.equal(res.stderr, "", `${flag} stderr not empty`);
          assertTokenIntact(fx);
        }
      });
    });

    test("an unknown argument exits 1 with the argument on standard error, before any side effect", () => {
      withToken((fx) => {
        for (const arg of ["--bogus", "-x", "positional", "--rotat"]) {
          const res = run(fx, arg);
          assert.equal(res.status, 1, `'${arg}' exit status`);
          assert.equal(res.stderr.replace(/\n$/, ""), `ERROR: unknown argument '${arg}'`);
          assert.equal(res.stdout, "", `'${arg}' stdout not empty`);
          assertTokenIntact(fx);
        }
        const empty = run(fx, "");
        assert.equal(empty.status, 1);
        assert.equal(empty.stderr.replace(/\n$/, ""), "ERROR: unknown argument ''");
      });
    });

    test("argument ordering: the first offending or terminal argument wins", () => {
      withToken((fx) => {
        let res = run(fx, "--rotate", "--bogus");
        assert.equal(res.status, 1);
        assert.equal(res.stderr.replace(/\n$/, ""), "ERROR: unknown argument '--bogus'");
        assert.equal(res.stdout, "", "no rotation banner is printed");
        assertTokenIntact(fx);

        res = run(fx, "--rotate", "--help");
        assert.equal(res.status, 0);
        assert.ok(res.stdout.includes(USAGE_LINE), res.stdout);
        assert.ok(
          !res.stdout.includes("Rotating the shared MemPalace daemon bearer token"),
          "--help after --rotate started a rotation",
        );
        assertTokenIntact(fx);

        res = run(fx, "--bogus", "--help");
        assert.equal(res.status, 1);
        assert.equal(res.stderr.replace(/\n$/, ""), "ERROR: unknown argument '--bogus'");
      });
    });
  },
);
