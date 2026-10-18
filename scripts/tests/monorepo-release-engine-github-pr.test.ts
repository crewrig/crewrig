// monorepo-release-engine-github-pr.test.ts — cases 11h and 11i of the real-engine release suite:
// the GitHub release-PR flow (issue #1379). Replaces scripts/tests/test-monorepo-release-engine.sh
// (11h preparation and post-merge publish, 11i classification failure and release-pr/* refusal;
// spec 0265 row J2). The forge is the loopback stub; the post-merge publish engine is a runtime
// generated `npx` stand-in that records where it ran and the config it got.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { before, describe, it } from "node:test";

import {
  ENGINE_SKIP,
  cleanGit,
  cleanPath,
  ghPushEnv,
  makeFixture,
  originGit,
  runDriver,
} from "./lib/release-engine-fixture.ts";
import type { DriverRun, Fixture } from "./lib/release-engine-fixture.ts";
import { startForgeStub } from "./lib/release-forge-stub.ts";
import type { ForgeStub, StubRequest } from "./lib/release-forge-stub.ts";

const opts = { skip: ENGINE_SKIP, timeout: 600_000 };
const TOKEN = "sentinel-ghs-7f3a";
const RELEASE_RANGE = "refs/heads/main..refs/heads/release-pr/main";

const body = (r: StubRequest | undefined): Record<string, unknown> =>
  (r?.["body"] ?? {}) as Record<string, unknown>;

describe("11h GitHub release-PR flow (issue #1379)", opts, () => {
  let fx: Fixture;
  let stub: ForgeStub;
  let prep: DriverRun;
  let prepLog: StubRequest[];
  let mainBefore: string;
  let tagsBefore: string;

  before(async () => {
    fx = makeFixture();
    mainBefore = originGit(fx, ["rev-parse", "refs/heads/main"]).trim();
    tagsBefore = originGit(fx, ["tag", "-l"]);
    stub = await startForgeStub();
    prep = runDriver(fx, ghPushEnv(stub.apiUrl, TOKEN));
    prepLog = stub.requests();
  });

  it("11h: preparation exits 0; foo and baz PENDING, bar UNCHANGED, nothing PUBLISHED; token never in output (R11)", () => {
    assert.equal(prep.rc, 0, prep.err);
    assert.match(prep.out, /^PENDING foo version=1\.3\.0 tag=foo-v1\.3\.0$/m);
    assert.match(prep.out, /^PENDING baz version=1\.0\.0 tag=baz-v1\.0\.0$/m);
    assert.match(prep.out, /^UNCHANGED bar$/m);
    assert.doesNotMatch(prep.out, /^PUBLISHED /m);
    assert.doesNotMatch(prep.out + prep.err, new RegExp(TOKEN));
  });

  it("11h: origin main and tags are untouched; release-pr/main has one release commit per pending extension, no [skip ci]", () => {
    assert.ok(mainBefore !== "" && tagsBefore !== "", "vacuous snapshots");
    assert.equal(originGit(fx, ["rev-parse", "refs/heads/main"]).trim(), mainBefore);
    assert.equal(originGit(fx, ["tag", "-l"]), tagsBefore);
    const subjects = originGit(fx, ["log", "--format=%s", RELEASE_RANGE]).trim().split("\n").sort();
    assert.deepEqual(subjects, ["🔖 baz-v1.0.0", "🔖 foo-v1.3.0"]);
    assert.doesNotMatch(originGit(fx, ["log", "--format=%B", RELEASE_RANGE]), /skip ci/);
  });

  it("11h: the release branch bumps both foo manifests to 1.3.0 and writes its CHANGELOG.md", () => {
    const show = (file: string): string =>
      originGit(fx, ["show", `refs/heads/release-pr/main:extensions/core/foo/${file}`]);
    assert.equal((JSON.parse(show("package.json")) as { version: string }).version, "1.3.0");
    assert.equal((JSON.parse(show("extension.json")) as { version: string }).version, "1.3.0");
    assert.match(show("CHANGELOG.md"), /^# Changelog/m);
  });

  it("11h: the release PR release-pr/main -> main is opened, titled with both tags; build.yml is dispatched on it", () => {
    const post = prepLog.find(
      (r) => r.method === "POST" && (r.path ?? "").endsWith("/repos/acme/fixture/pulls"),
    );
    assert.equal(body(post)["head"], "release-pr/main");
    assert.equal(body(post)["base"], "main");
    assert.equal(body(post)["title"], "🔖 Release baz-v1.0.0, foo-v1.3.0");
    assert.match(prep.out, /^RELEASE-PR opened #1 /m);
    const dispatch = prepLog.find((r) =>
      (r.path ?? "").includes("/actions/workflows/build.yml/dispatches"),
    );
    assert.equal(body(dispatch)["ref"], "release-pr/main");
  });

  it("11h: after the merge, the publish engine runs for foo and baz only, with the GitHub leg and no changelog/git step; no loop", () => {
    // Fast-forward main to the release branch (as a rebase merge would), then release on merged main.
    originGit(fx, ["update-ref", "refs/heads/main", "refs/heads/release-pr/main"]);
    cleanGit(fx.home, fx.fix, ["fetch", "-q", "origin", "main"], fx.gitconfig);
    cleanGit(fx.home, fx.fix, ["reset", "-q", "--hard", "FETCH_HEAD"]);
    const npx = path.join(fx.root, "npx-11h");
    const calls = path.join(npx, "calls");
    fs.mkdirSync(path.join(npx, "bin"), { recursive: true });
    fs.mkdirSync(calls);
    const script = [
      "#!/bin/bash",
      'ext="$(basename "$PWD")"',
      'for a in "$@"; do',
      `  case "$a" in semantic-release-monorepo,*) cp "\${a#semantic-release-monorepo,}" "${calls}/$ext.json" ;; esac`,
      "done",
      "exit 0",
      "",
    ].join("\n");
    fs.writeFileSync(path.join(npx, "bin", "npx"), script, { mode: 0o755 });
    stub.reset();
    const merged = runDriver(fx, {
      ...ghPushEnv(stub.apiUrl, TOKEN),
      PATH: `${path.join(npx, "bin")}${path.delimiter}${cleanPath()}`,
    });
    const ran = fs.readdirSync(calls).sort();
    assert.deepEqual(ran, ["baz.json", "foo.json"], `rc=${merged.rc}: ${merged.err}`);
    assert.equal(merged.rc, 0, merged.err);
    const config = JSON.parse(fs.readFileSync(path.join(calls, "foo.json"), "utf8")) as {
      plugins: (string | [string, unknown])[];
    };
    const names = config.plugins.map((p) => (Array.isArray(p) ? p[0] : p));
    assert.ok(names.includes("@semantic-release/github"), "no GitHub leg");
    assert.ok(
      names.every((n) => n !== "@semantic-release/git" && !n.endsWith("changelog-plugin.ts")),
    );
    assert.doesNotMatch(merged.out, /^PENDING /m);
    assert.match(merged.out, /^RELEASE-PR none$/m);
    assert.ok(!stub.requests().some((r) => r.method === "POST"), "the merged release re-proposed");
  });
});

describe("11i classification failure and release-pr/* refusal", opts, () => {
  it("an unclassifiable extension fails the run and never closes the open release PR (i1-F2); a release-pr/* branch is refused (i1-F5)", async () => {
    const fx = makeFixture();
    for (const e of ["foo", "baz"]) {
      fs.writeFileSync(path.join(fx.fix, "extensions", "core", e, "package.json"), "{ not json\n");
    }
    cleanGit(fx.home, fx.fix, ["commit", "-q", "-am", ":bug: break foo and baz manifests"]);
    cleanGit(fx.home, fx.fix, ["push", "-q", "origin", "main"], fx.gitconfig);
    const stub = await startForgeStub({ openPr: true });
    const env = ghPushEnv(stub.apiUrl, TOKEN);

    const failed = runDriver(fx, env);
    assert.notEqual(failed.rc, 0, failed.out);
    assert.match(failed.out, /^RELEASE-FAILED foo step=engine$/m);
    assert.ok(!stub.requests().some((r) => r.method === "PATCH"), "the open release PR was closed");
    assert.doesNotMatch(failed.out, /^RELEASE-PR /m);

    cleanGit(fx.home, fx.fix, ["checkout", "-q", "-b", "release-pr/main"]);
    const refused = runDriver(fx, env);
    assert.equal(refused.rc, 2, refused.err);
    assert.ok(
      refused.err.includes("refusing to publish from a release PR branch (release-pr/main)"),
      refused.err,
    );
  });
});
