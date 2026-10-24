// release-driver-sandbox.test.ts — smoke test of the black-box suite's sandbox and capturing stubs
// (spec 0257 R22): the sandbox builds hermetically, a refused run touches no engine, and a GitHub
// rehearsal reaches the (scripted) rehearsal helper once per extension. The ts leg is smoke-tested
// against the shell's refusal; the flow suites run both legs.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { REPO } from "./lib/build-fixture-tree.ts";
import { OFFLINE_API_URL, createReleaseSandbox } from "./lib/release-driver-sandbox.ts";

const GITHUB_REHEARSAL = {
  GITHUB_ACTIONS: "true",
  RELEASE_DRY_RUN: "true",
  GITHUB_SERVER_URL: "https://github.com",
  GITHUB_REPOSITORY: "acme/crewrig",
};

describe("release driver sandbox", () => {
  it("builds a hermetic repository with real dependencies and an isolated environment", () => {
    const sb = createReleaseSandbox();
    for (const name of ["js-yaml", "argparse"]) {
      const stat = fs.lstatSync(path.join(sb.root, "node_modules", name));
      assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), `${name} must be a real directory`);
    }
    for (const rel of [
      ".git",
      "package.json",
      "scripts/monorepo-release.ts",
      "extensions/core/hello-world/extension.json",
      "extensions/core/second-ext/extension.json",
    ]) {
      assert.ok(fs.existsSync(path.join(sb.root, rel)), `${rel} exists`);
    }
    const env = sb.env();
    assert.deepEqual(
      Object.keys(env).filter((k) => /^(CI|NODE_TEST_CONTEXT|GITHUB_|GITLAB_|CI_)/.test(k)),
      ["GITHUB_API_URL"],
    );
    assert.ok(fs.existsSync(path.join(sb.originBare, "HEAD")), "origin is a bare repository");
    assert.equal(sb.env({ GITHUB_ACTIONS: "true" })["GITHUB_ACTIONS"], "true");
    sb.dispose();
    assert.equal(fs.existsSync(sb.root), false);
  });

  it("never lets a GitHub publish run reach a non-loopback host", () => {
    const sb = createReleaseSandbox();
    assert.equal(sb.env()["GITHUB_API_URL"], "http://127.0.0.1:1");
    assert.equal(OFFLINE_API_URL, "http://127.0.0.1:1");
    // An unreachable API and a sentinel token: the release-PR sync must fail fast and offline.
    sb.scriptNpx({ "hello-world": ["Created tag hello-world-v9.9.9"] });
    sb.scriptRehearse({
      "hello-world": { released: true, version: "1.3.0", gitTag: "hello-world-v1.3.0" },
      "second-ext": { released: false },
    });
    const res = sb.run("shell", {
      GITHUB_ACTIONS: "true",
      GITHUB_EVENT_NAME: "push",
      GITHUB_REF: "refs/heads/main",
      GITHUB_REPOSITORY: "acme/fixture",
      GITHUB_SERVER_URL: "https://github.com",
      GITHUB_TOKEN: "sentinel-ghs-offline",
    });
    assert.match(res.stdout, /RELEASE-FAILED release-pr step=pr/, res.stdout + res.stderr);
    assert.equal(res.status, 1);
    assert.ok(!(res.stdout + res.stderr).includes("sentinel-ghs-offline"));
    sb.dispose();
  });

  it("mutates the sandbox copy only, and refuses a mutation that changes nothing", () => {
    const sb = createReleaseSandbox();
    const file = "scripts/lib/monorepo-release/branch.ts";
    const original = fs.readFileSync(path.join(REPO, file), "utf8");
    sb.mutate(file, (text) =>
      text.replace("function releasePrBranch(", "function releasePrBranchX("),
    );
    assert.match(fs.readFileSync(path.join(sb.root, file), "utf8"), /function releasePrBranchX\(/);
    assert.equal(fs.readFileSync(path.join(REPO, file), "utf8"), original);
    assert.throws(() => sb.mutate(file, (text) => text), /changed nothing/);
    sb.dispose();
  });

  it("refuses outside a CI environment without any engine call", () => {
    const sb = createReleaseSandbox();
    const res = sb.run("shell");
    assert.equal(res.status, 2);
    assert.match(res.stderr, /Error: unsupported release forge: none \(not a CI environment\)/);
    assert.deepEqual(sb.readJsonl("npx"), []);
    assert.deepEqual(sb.readJsonl("rehearse"), []);
    sb.dispose();
  });

  it("runs the ts leg, which refuses outside a CI environment exactly like the shell", () => {
    const sb = createReleaseSandbox();
    const shell = sb.run("shell");
    const ts = sb.run("ts");
    assert.equal(ts.status, 2, ts.stderr);
    assert.equal(ts.status, shell.status);
    assert.equal(ts.stderr, shell.stderr);
    assert.match(ts.stderr, /Error: unsupported release forge: none \(not a CI environment\)/);
    assert.deepEqual(sb.readJsonl("npx"), []);
    assert.deepEqual(sb.readJsonl("rehearse"), []);
    sb.dispose();
  });

  it("rehearses a GitHub run through the scripted rehearsal stub", () => {
    const sb = createReleaseSandbox();
    sb.scriptRehearse({
      "hello-world": {
        released: true,
        version: "1.3.0",
        gitTag: "hello-world-v1.3.0",
        lastTag: "hello-world-v1.2.0",
        notes: "## Notes\n- a note",
      },
      "second-ext": { released: false },
    });
    const res = sb.run("shell", GITHUB_REHEARSAL);
    assert.match(res.stdout, /REHEARSAL hello-world version=1\.3\.0 /, res.stdout + res.stderr);
    assert.match(res.stdout, /UNCHANGED second-ext/);
    const calls = sb.readJsonl("rehearse");
    assert.equal(calls.length, 2);
    for (const call of calls) {
      assert.match(String(call["configFile"]), /\.releaserc\.json$/);
      assert.equal(typeof JSON.parse(String(call["config"])), "object");
    }
    assert.deepEqual(sb.readJsonl("npx"), []);
    sb.dispose();
  });

  it("keeps the credential refusal of the real helper in the stub, naming only the variable", () => {
    const sb = createReleaseSandbox();
    const stub = path.join(sb.root, "scripts", "lib", "release-rehearse.mjs");
    const res = spawnSync(process.execPath, [stub, "main"], {
      cwd: path.join(sb.root, "extensions", "core", "hello-world"),
      env: sb.env({ GITHUB_TOKEN: "s3cr3t-value" }),
      encoding: "utf8",
    });
    assert.equal(res.status, 2);
    assert.match(res.stderr, /credential variables present: GITHUB_TOKEN/);
    assert.ok(!res.stderr.includes("s3cr3t-value"));
    assert.deepEqual(sb.readJsonl("rehearse"), []);
    sb.dispose();
  });

  it("records an npx call with both config files and prints the scripted output", () => {
    const sb = createReleaseSandbox();
    const dir = path.join(sb.root, "extensions", "core", "hello-world");
    const extra = path.join(sb.root, "extra.releaserc.json");
    fs.writeFileSync(path.join(dir, ".releaserc.json"), '{"a":1}');
    fs.writeFileSync(extra, '{"b":2}');
    sb.scriptNpx({ "hello-world": { lines: ["Created tag hello-world-v1.3.0"], status: 1 } });
    const res = spawnSync(
      "npx",
      ["semantic-release", "--branches", "main", "--extends", `semantic-release-monorepo,${extra}`],
      { cwd: dir, env: sb.env({ RELEASE_X: "1", UNRELATED: "no" }), encoding: "utf8" },
    );
    assert.equal(res.status, 1);
    assert.equal(res.stdout, "Created tag hello-world-v1.3.0\n");
    const [call] = sb.readJsonl("npx");
    assert.equal(call?.["releaserc"], '{"a":1}');
    assert.equal(call?.["extendsContent"], '{"b":2}');
    const names = Object.keys(call?.["env"] as Record<string, string>);
    assert.ok(names.includes("RELEASE_X") && !names.includes("UNRELATED"));
    sb.dispose();
  });
});

// probe #1783: control run of Release Driver Tests on main (do not merge)
