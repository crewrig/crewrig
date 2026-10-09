// sync-from-upstream-windows.test.ts — cross-platform test of scripts/sync-from-upstream.ts
// (spec 0253 R27, PLAN step D6). It is run by the `windows-sync-from-upstream` job under
// PowerShell on `windows-latest`, and also passes on Linux and macOS.
//
// No bash, sh or other POSIX tool: the entry is spawned with `process.execPath`, and the
// fixtures (an UPSTREAM repository and an ADOPTER repository) are built with `git` alone,
// in temporary directories. Git runs under a private global configuration (identity, no
// signing, no CRLF conversion) with the system configuration disabled.
//
// The entry runs WITHOUT `--disable-warning`: the last test proves it prints no Node warning.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const ENTRY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "sync-from-upstream.ts",
);
const COMPLETE = "Sync complete. Review the changes with 'git diff' before committing.";

let root: string;
let gitEnv: NodeJS.ProcessEnv;
let counter = 0;

interface Outcome {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

before(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-sync-win-")));
  const globalConfig = path.join(root, "gitconfig");
  fs.writeFileSync(
    globalConfig,
    "[user]\n\tname = Test\n\temail = test@example.com\n[commit]\n\tgpgsign = false\n[core]\n\tautocrlf = false\n",
  );
  gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_NOSYSTEM: "1" };
});
after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, { cwd, env: gitEnv, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}

function writeFile(dir: string, rel: string, content: string): void {
  const file = path.join(dir, ...rel.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function commit(dir: string, message: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) writeFile(dir, rel, content);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", message);
}

interface Fixture {
  readonly upstream: string;
  readonly adopter: string;
}

/** An upstream with two commits on `core/`, and an adopter synced at the first commit. */
function makeFixture(configBody?: string): Fixture {
  const id = (counter += 1);
  const upstream = path.join(root, `upstream-${id}`);
  const adopter = path.join(root, `adopter-${id}`);
  for (const dir of [upstream, adopter]) {
    fs.mkdirSync(dir);
    git(dir, "init", "-q");
  }
  const first = { "core/a.txt": "a v1\n", "core/b.txt": "b v1\n", "README.org-owned.md": "org\n" };
  commit(upstream, "initial", first);
  commit(upstream, "update", { "core/a.txt": "a v2\n", "core/c.txt": "c v1\n" });

  // A local path is a valid git remote; forward slashes keep the TOML string valid on Windows.
  const toml = configBody ?? `canonical_repo = "${upstream.replaceAll("\\", "/")}"\n`;
  commit(adopter, "initial", {
    ...first,
    "crewrig.config.toml": toml,
    ".crewrig/core-paths.txt": "core strict\n",
  });
  return { upstream, adopter };
}

function runSync(adopter: string, name: string, ...args: string[]): Outcome {
  const started = performance.now();
  const result = spawnSync(process.execPath, [ENTRY, ...args], {
    cwd: adopter,
    env: { ...gitEnv, CREWRIG_REPO_DIR: adopter },
    encoding: "utf8",
  });
  console.log(`timing: ${name} ${Math.round(performance.now() - started)} ms`);
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const read = (dir: string, rel: string): Buffer =>
  fs.readFileSync(path.join(dir, ...rel.split("/")));

describe("sync-from-upstream.ts (cross-platform)", () => {
  test("success: restores the upstream core files without staging or committing", () => {
    const { adopter } = makeFixture();
    const headBefore = git(adopter, "rev-parse", "HEAD");

    const run = runSync(adopter, "success");
    assert.equal(run.status, 0, run.stderr);
    assert.ok(run.stdout.includes("Fetching"), run.stdout);
    assert.equal(run.stdout.trimEnd().split("\n").at(-1), COMPLETE);
    assert.equal(read(adopter, "core/a.txt").toString("utf8"), "a v2\n");
    assert.equal(read(adopter, "core/c.txt").toString("utf8"), "c v1\n");
    assert.equal(read(adopter, "core/b.txt").toString("utf8"), "b v1\n");

    assert.equal(git(adopter, "rev-parse", "HEAD"), headBefore);
    assert.equal(git(adopter, "diff", "--cached", "--name-only"), "");
    const status = git(adopter, "status", "--porcelain")
      .split("\n")
      .filter((l) => l !== "");
    assert.ok(
      status.some((l) => l.endsWith("core/a.txt") && l.startsWith(" M")),
      status.join("|"),
    );
    assert.ok(
      status.every((l) => l.startsWith(" M") || l.startsWith("??")),
      status.join("|"),
    );
  });

  test("strict-dirty abort: names the path and leaves the working tree untouched", () => {
    const { adopter } = makeFixture();
    writeFile(adopter, "core/b.txt", "local edit never upstream\n");
    const snapshot = { a: read(adopter, "core/a.txt"), b: read(adopter, "core/b.txt") };

    const outcome = runSync(adopter, "strict-dirty");
    assert.equal(outcome.status, 1);
    assert.ok(
      outcome.stderr.includes("Error: the following core-layer paths have local modifications:"),
      outcome.stderr,
    );
    assert.ok(outcome.stderr.includes("core/b.txt"), outcome.stderr);
    assert.ok(!outcome.stdout.includes("Sync complete"), outcome.stdout);
    assert.deepEqual(read(adopter, "core/a.txt"), snapshot.a);
    assert.deepEqual(read(adopter, "core/b.txt"), snapshot.b);
    assert.ok(!fs.existsSync(path.join(adopter, "core", "c.txt")));
  });

  test("unknown argument: exit 1 with the shell's message", () => {
    const { adopter } = makeFixture();
    const outcome = runSync(adopter, "unknown-argument", "--bogus");
    assert.equal(outcome.status, 1);
    assert.ok(outcome.stderr.includes("Error: unknown argument '--bogus'"), outcome.stderr);
  });

  test("missing canonical_repo: exit 1 with the shell's message", () => {
    const { adopter } = makeFixture("# no canonical_repo here\n");
    const outcome = runSync(adopter, "missing-canonical-repo");
    assert.equal(outcome.status, 1);
    assert.ok(
      outcome.stderr.includes("Error: canonical_repo is not set in crewrig.config.toml"),
      outcome.stderr,
    );
  });

  test("no Node warning on stderr when the entry runs without --disable-warning", () => {
    const { adopter } = makeFixture();
    const outcome = runSync(adopter, "no-warning");
    assert.equal(outcome.status, 0, outcome.stderr);
    assert.doesNotMatch(outcome.stderr, /Warning|MODULE_TYPELESS|ExperimentalWarning/);
  });
});
