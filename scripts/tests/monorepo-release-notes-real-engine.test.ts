// monorepo-release-notes-real-engine.test.ts — Replaces scripts/tests/test-monorepo-release-notes.sh.
// Regression test for issue #1225: the release note scripts/monorepo-release.sh produces for an
// extension must be non-empty and carry that extension's own gitmoji commit subjects (and #1227:
// the heading carries a single `v`).
//
// Root cause under test: semantic-release-monorepo resolves each wrapped step (analyzeCommits,
// generateNotes, success, fail) with an ESM `import()` of the plugin name. semantic-release-gitmoji
// is CommonJS, and Node's named-export detection exposes only `analyzeCommits`, so `generateNotes`
// was never found and every extension release shipped an empty note.
//
// Hermetic harness: a throwaway git repository with one extension, a local bare remote (so the
// engine's push-permission probe runs offline) and gitmoji commits inside and outside the extension.
// The REAL scripts/monorepo-release.sh runs against it in GitHub PUBLISH mode and generates the REAL
// .releaserc.json; only `npx` is stubbed, so a Node driver (written from a string at runtime, never a
// stored .mjs) runs the engine programmatically in dry-run mode with that exact configuration. The
// only override is `verifyConditions: []` (the GitHub plugin would call the API with a token).
// POSIX-only (bare remote, bash shim, loopback stub). Skips without semantic-release, fails under CI.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { REPO } from "./lib/build-fixture-tree.ts";
import { cleanEnv, cleanGit, ENGINE_SKIP, requireEngine } from "./lib/release-engine-fixture.ts";
import { startForgeStub } from "./lib/release-forge-stub.ts";

// Dry-run stand-in for `npx semantic-release`, configured through --extends like the real call.
const DRIVER = [
  "import { readFileSync, writeFileSync, existsSync } from 'node:fs';",
  "import { createRequire } from 'node:module';",
  "import { pathToFileURL } from 'node:url';",
  "const [repoDir, notesOut, resultOut, remote, ...rest] = process.argv.slice(2);",
  "const require = createRequire(repoDir + '/package.json');",
  "const { default: semanticRelease } = await import(",
  "  pathToFileURL(require.resolve('semantic-release')).href",
  ");",
  "// Spec 0235: .releaserc.json must NOT be written inside the extension directory.",
  "if (existsSync('.releaserc.json')) {",
  "  throw new Error('Found .releaserc.json inside extension directory during release run');",
  "}",
  "const extendsIdx = rest.indexOf('--extends');",
  "const rawExtends = extendsIdx !== -1 ? rest[extendsIdx + 1] : '.releaserc.json';",
  "const config = JSON.parse(readFileSync(rawExtends.split(',').pop(), 'utf8'));",
  "// Drop every CI marker so env-ci resolves the branch from the fixture's git state.",
  "const env = { PATH: process.env.PATH, HOME: process.env.HOME };",
  "const result = await semanticRelease(",
  "  { ...config, repositoryUrl: remote, dryRun: true, ci: false, verifyConditions: [] },",
  "  { cwd: process.cwd(), env }",
  ");",
  "writeFileSync(notesOut, result ? result.nextRelease.notes || '' : '');",
  "writeFileSync(resultOut, JSON.stringify(result",
  "  ? { version: result.nextRelease.version, gitTag: result.nextRelease.gitTag } : null));",
  "",
].join("\n");

const skip =
  process.platform === "win32" ? "SKIP: POSIX-only (bare remote, bash shim)" : ENGINE_SKIP;

describe("monorepo-release notes: real engine, gitmoji steps (#1225, #1227)", { skip }, () => {
  let root = "";
  let log = "";
  let notes = "";
  let rc: number | null = null;
  let resultText = "";
  let extDir = "";

  before(async () => {
    requireEngine();
    root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "release-notes-")));
    const home = path.join(root, "home");
    const fixture = path.join(root, "repo");
    const remote = path.join(root, "remote.git");
    const bin = path.join(root, "bin");
    for (const dir of [home, fixture, bin]) fs.mkdirSync(dir);
    cleanGit(home, root, ["init", "-q", "--bare", "-b", "main", remote]);
    cleanGit(home, fixture, ["init", "-q", "-b", "main"]);
    const git = (...args: string[]): string => cleanGit(home, fixture, args);
    git("config", "user.name", "fixture");
    git("config", "user.email", "fixture@example.invalid");
    git("config", "commit.gpgsign", "false");
    git("remote", "add", "origin", remote);

    extDir = path.join(fixture, "extensions", "core", "notes-fixture");
    fs.mkdirSync(extDir, { recursive: true });
    // The committed version is already the one the engine computes (a first release, 1.0.0): since
    // the GitHub release-PR flow (issue #1379) that is a merged release PR, the only case in which
    // GitHub publish mode calls `npx semantic-release` — the call this suite intercepts.
    fs.writeFileSync(
      path.join(extDir, "package.json"),
      '{\n  "name": "notes-fixture",\n  "version": "1.0.0",\n  "private": true\n}\n',
    );
    const commit = (message: string): void => {
      git("add", "-A");
      git("commit", "-q", "-m", message);
    };
    commit("🎉 Scaffold notes-fixture");
    fs.writeFileSync(path.join(extDir, "a.txt"), "a\n");
    commit("✨ Add the notes fixture feature");
    fs.writeFileSync(path.join(extDir, "b.txt"), "b\n");
    commit("🐛 Fix the notes fixture defect");
    fs.writeFileSync(path.join(fixture, "outside.txt"), "outside\n");
    commit("✨ Add an unrelated root change");
    git("push", "-q", "origin", "main");

    const driver = path.join(root, "driver.mjs");
    notes = path.join(root, "notes.md");
    const result = path.join(root, "result.json");
    fs.writeFileSync(driver, DRIVER);
    const q = (s: string): string => `'${s.replaceAll("'", "'\\''")}'`;
    const shim = path.join(bin, "npx");
    fs.writeFileSync(
      shim,
      `#!/bin/bash\nexec node ${q(driver)} ${q(REPO)} ${q(notes)} ${q(result)} ${q(`file://${remote}`)} "$@"\n`,
    );
    fs.chmodSync(shim, 0o755);

    // The driver is forge-aware (spec 0213): it runs in GitHub PUBLISH mode (the path that
    // generates the real config and calls `npx`); the push-event markers are pinned, and the
    // forge stub answers the release-PR sync calls on loopback.
    const stub = await startForgeStub();
    const env = cleanEnv(home, undefined, {
      GITHUB_ACTIONS: "true",
      GITHUB_REF: "refs/heads/main",
      GITHUB_EVENT_NAME: "push",
      GITHUB_SERVER_URL: "https://github.com",
      GITHUB_REPOSITORY: "acme/notes-fixture",
      GITHUB_API_URL: stub.apiUrl,
      RELEASE_TOKEN: "fixture-placeholder",
      PATH: `${bin}${path.delimiter}${cleanEnv(home).PATH}`,
    });
    const res = spawnSync("bash", [path.join(REPO, "scripts", "monorepo-release.sh")], {
      cwd: fixture,
      env,
      encoding: "utf8",
      timeout: 300_000,
      maxBuffer: 1 << 26,
    });
    rc = res.status;
    log = `${res.stdout}${res.stderr}`;
    resultText = fs.existsSync(result) ? fs.readFileSync(result, "utf8") : "";
    if (!fs.existsSync(notes)) notes = "";
    else notes = fs.readFileSync(notes, "utf8");
  });

  after(() => {
    if (path.basename(root).startsWith("release-notes-")) {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it("notes::driver run exits 0", () => {
    assert.equal(rc, 0, `monorepo-release.sh dry run exits 0 (rc=${rc})\n${log}`);
  });

  it("notes::monorepo wrapper resolves every gitmoji step", () => {
    // Other plugins legitimately lack generateNotes; only the gitmoji entry must reach the step.
    assert.match(log, /Start step "generateNotes" of plugin "[^"]*gitmoji[^"]*"/);
    assert.doesNotMatch(log, /Plugin "[^"]*gitmoji[^"]*" does not provide step/);
  });

  it("notes::version and tag unchanged (1.0.0, notes-fixture-v1.0.0)", () => {
    assert.notEqual(resultText, "", "result.json was not written");
    const parsed = JSON.parse(resultText) as { version?: string; gitTag?: string } | null;
    assert.equal(parsed?.version, "1.0.0");
    assert.equal(parsed?.gitTag, "notes-fixture-v1.0.0");
  });

  it("notes::release note is non-empty", () => {
    assert.match(notes, /\S/);
  });

  for (const subject of ["Add the notes fixture feature", "Fix the notes fixture defect"]) {
    it(`notes::carries own commits: ${subject}`, () => {
      assert.ok(notes.includes(subject), `note lacks "${subject}"`);
    });
  }

  it("notes::excludes root commit", () => {
    assert.ok(!notes.includes("Add an unrelated root change"));
  });

  it("notes::heading has a single v", () => {
    assert.doesNotMatch(notes, /^# (\[)?vnotes-fixture-v/m, "heading carries a doubled v prefix");
    assert.match(
      notes,
      /^# (\[)?notes-fixture-v/m,
      `release note heading has unexpected format (got: ${notes.split("\n")[0]})`,
    );
  });

  it("notes::generated releaserc cleaned", () => {
    assert.ok(!fs.existsSync(path.join(extDir, ".releaserc.json")));
    assert.doesNotMatch(log, /Found \.releaserc\.json inside extension directory/);
  });
});
