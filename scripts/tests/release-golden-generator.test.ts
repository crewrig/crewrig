// release-golden-generator.test.ts — smoke test of scripts/tests/fixtures/release/generate-github-golden.ts,
// the TypeScript replacement of generate-github-golden.sh (spec 0265 row J2, requirement 16).
// No Bash suite asserted the generator; this file is its oracle:
//   (a) at the default ref the output is byte-identical to the committed golden;
//   (b) a ref without scripts/monorepo-release.sh: exit 2 and the same message;
//   (c) a ref whose driver writes no config: exit 1 and the same message;
//   (d) no host path in the output.
// (b) and (c) run in a throwaway git repo (the generator takes the repository from its cwd).
// (a) and (d) need the historical commit bbd6cf6: they skip, with the reason, in a shallow clone, and
// fail when CI is set (the release-tests job declares `history-depth: full`). POSIX-only.
// The committed golden is never rewritten here; Linux regeneration is a container-only protocol.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import { REPO } from "./lib/build-fixture-tree.ts";

const GENERATOR = path.join(
  REPO,
  "scripts",
  "tests",
  "fixtures",
  "release",
  "generate-github-golden.ts",
);
const GOLDEN = path.join(
  REPO,
  "scripts",
  "tests",
  "fixtures",
  "release",
  "github-releaserc.golden.json",
);
const REF = "bbd6cf6";
const HOME_DIR = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "golden-smoke-")));
after(() => {
  if (path.basename(HOME_DIR).startsWith("golden-smoke-")) {
    fs.rmSync(HOME_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

const ENV = {
  PATH: process.env["PATH"] ?? "",
  HOME: HOME_DIR,
  LC_ALL: "C",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: os.devNull,
};

function git(cwd: string, args: readonly string[]) {
  return spawnSync("git", ["-C", cwd, ...args], { env: ENV, encoding: "utf8" });
}

function generate(cwd: string, ref?: string) {
  const args = ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", GENERATOR];
  if (ref !== undefined) args.push(ref);
  return spawnSync(process.execPath, args, { cwd, env: ENV, encoding: "utf8", maxBuffer: 1 << 26 });
}

/** A throwaway repo with one commit; `driver` is the content of scripts/monorepo-release.sh, if any. */
function tempRepo(name: string, driver?: string): string {
  const dir = path.join(HOME_DIR, name);
  fs.mkdirSync(dir);
  git(dir, ["init", "-q", "-b", "main"]);
  fs.writeFileSync(path.join(dir, "README"), "fixture\n");
  if (driver !== undefined) {
    fs.mkdirSync(path.join(dir, "scripts"));
    fs.writeFileSync(path.join(dir, "scripts", "monorepo-release.sh"), driver);
  }
  git(dir, ["add", "-A"]);
  git(dir, ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "-m", "x"]);
  return dir;
}

const hasRef = git(REPO, ["cat-file", "-e", `${REF}:scripts/monorepo-release.sh`]).status === 0;
const refSkip: string | false =
  process.platform === "win32"
    ? "SKIP: POSIX-only (runs bash on the historical driver)"
    : !hasRef && process.env["CI"] === undefined
      ? `SKIP: ${REF} is not reachable (shallow clone): fetch full history`
      : false;
const posixSkip = process.platform === "win32" ? "SKIP: POSIX-only" : false;

describe("generate-github-golden.ts", () => {
  it("generator::unknown ref exits 2 with the message", { skip: posixSkip }, () => {
    const res = generate(tempRepo("no-driver"), "HEAD");
    assert.equal(res.status, 2);
    assert.equal(res.stderr, "Error: HEAD has no scripts/monorepo-release.sh\n");
    assert.equal(res.stdout, "");
  });

  it("generator::driver wrote nothing exits 1 with the message", { skip: posixSkip }, () => {
    const res = generate(tempRepo("empty-driver", "exit 0\n"), "HEAD");
    assert.equal(res.status, 1);
    assert.equal(res.stderr, "Error: the driver at HEAD wrote no .releaserc.json\n");
    assert.equal(res.stdout, "");
  });

  it("generator::reproduces golden byte for byte at the default ref", { skip: refSkip }, () => {
    assert.ok(hasRef, `${REF} must be reachable under CI (history-depth: full)`);
    const res = generate(REPO);
    assert.equal(res.status, 0, res.stderr);
    assert.ok(
      Buffer.from(res.stdout).equals(fs.readFileSync(GOLDEN)),
      "output differs from golden",
    );
  });

  it("generator::no host path in the output", { skip: refSkip }, () => {
    assert.ok(hasRef, `${REF} must be reachable under CI (history-depth: full)`);
    const res = generate(REPO);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /\/ROOT\//);
    for (const host of ["/private", "/tmp", "/Users", "/home", os.tmpdir(), HOME_DIR]) {
      assert.ok(!res.stdout.includes(host), `output leaks ${host}`);
    }
  });
});
