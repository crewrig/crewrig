// monorepo-release-engine-gitlab-publish.test.ts — cases 11c, 11d and 11e of the real-engine release
// suite: GitLab PUBLISH against the loopback forge stub (R7/R8/R9/R14/R17/R18).
// Replaces scripts/tests/test-monorepo-release-engine.sh (11c happy path incl. the R7 archive
// comparison, 11d upload failure, 11e package failure; spec 0265 row J2). `jq`, `tar` and `diff -rq`
// become JSON.parse, the Node tar reader and a recursive content comparison. Every remote is a bare
// repository under mkdtemp; the forge is the stub on 127.0.0.1.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { before, describe, it } from "node:test";

import {
  ENGINE_SKIP,
  cleanEnv,
  cleanGit,
  extensionLine,
  gitconfigWithForge,
  glEnv,
  makeFixture,
  originGit,
  runDriver,
} from "./lib/release-engine-fixture.ts";
import type { DriverRun, Fixture } from "./lib/release-engine-fixture.ts";
import { startForgeStub } from "./lib/release-forge-stub.ts";
import type { ForgeStub, StubRequest } from "./lib/release-forge-stub.ts";
import { treeOfArchive } from "./lib/release-sandbox.ts";
import { readTarGz } from "./lib/tar-reader.ts";
import { spawnSync } from "node:child_process";

const opts = { skip: ENGINE_SKIP, timeout: 600_000 };
const TOKEN = "sentinel-glpat-9c21";

interface Published {
  fx: Fixture;
  stub: ForgeStub;
  run: DriverRun;
  log: StubRequest[];
}

/** One GitLab publish run against a fresh fixture and stub; `prepare` may edit the fixture first. */
async function publish(
  stubOptions: { failUpload?: boolean },
  prepare?: (fx: Fixture) => void,
): Promise<Published> {
  const fx = makeFixture();
  prepare?.(fx);
  const stub = await startForgeStub(stubOptions);
  const run = runDriver(
    fx,
    { ...glEnv(stub.gitlabApiUrl), GITLAB_TOKEN: TOKEN },
    gitconfigWithForge(fx),
  );
  return { fx, stub, run, log: stub.requests() };
}

// baz has no baseline tag, so it ALSO publishes (or fails) in the same run: every request
// assertion is scoped to foo so baz's legitimate parallel traffic never reads as a duplicate.
const forFoo = (log: StubRequest[]): StubRequest[] => log.filter((r) => r["pkg"] === "foo");
const puts = (log: StubRequest[]): StubRequest[] => forFoo(log).filter((r) => r.method === "PUT");
const body = (r: StubRequest | undefined): Record<string, unknown> =>
  (r?.["body"] ?? {}) as Record<string, unknown>;

describe("11c GitLab publish happy path (R7/R8/R9/R11/R17/R18)", opts, () => {
  let p: Published;
  before(async () => {
    p = await publish({});
  });

  it("11c: publish exits 0, PUBLISHED line names foo, tag, archive and sha256; bar UNCHANGED; token never in output (R11)", () => {
    assert.equal(p.run.rc, 0, p.run.err);
    assert.match(
      p.run.out,
      /PUBLISHED foo tag=foo-v1\.3\.0 archive=foo-1\.3\.0\.tar\.gz sha256=[0-9a-f]{64}/,
    );
    assert.match(p.run.out, /UNCHANGED bar/);
    assert.doesNotMatch(p.run.out + p.run.err, new RegExp(TOKEN));
  });

  it("11c (R8, R9): exactly one PUT foo/1.3.0/foo-1.3.0.tar.gz and one release POST with one package link and a real note", () => {
    const put = puts(p.log);
    assert.equal(put.length, 1, JSON.stringify(put));
    assert.equal(put[0]?.["version"], "1.3.0");
    assert.equal(put[0]?.["label"], "foo-1.3.0.tar.gz");
    const releases = p.log.filter((r) => body(r)["tag_name"] === "foo-v1.3.0");
    assert.equal(releases.length, 1, "expected exactly one release POST for foo-v1.3.0");
    const release = body(releases[0]);
    const links = (release["assets"] as { links: { url: string }[] }).links;
    assert.equal(links.length, 1);
    assert.match(links[0]?.url ?? "", /\/packages\/generic\/foo\/1\.3\.0\/foo-1\.3\.0\.tar\.gz$/);
    // A description equal to the bare tag is the fallback taken when the note is empty.
    assert.notEqual(release["description"], "foo-v1.3.0");
  });

  it("11c: nothing uploaded for bar; origin carries foo-v1.3.0 and its main HEAD is the release commit", () => {
    assert.ok(!p.log.some((r) => r["pkg"] === "bar"), "bar was unexpectedly uploaded");
    assert.ok(originGit(p.fx, ["tag", "-l"]).split("\n").includes("foo-v1.3.0"));
    assert.equal(
      originGit(p.fx, ["log", "-1", "--format=%s", "main"]).trim(),
      "🔖 foo-v1.3.0 [skip ci]",
    );
  });

  it("11c (R7): uploaded sha256 equals the PUBLISHED line, no stray .releaserc.json (R17/R18), equals a fresh render", () => {
    const published = /sha256=([0-9a-f]+)$/.exec(extensionLine(p.run.out, "foo"))?.[1];
    assert.ok(published, "no sha256 on the PUBLISHED line");
    const uploaded = fs
      .readdirSync(p.stub.uploads)
      .filter((f) => f.startsWith("foo-1.3.0-"))
      .map((f) => path.join(p.stub.uploads, f))[0];
    assert.ok(uploaded, `no uploaded file found under ${p.stub.uploads}`);
    const sha = createHash("sha256").update(fs.readFileSync(uploaded)).digest("hex");
    assert.equal(sha, published, "uploaded body sha256 differs from the PUBLISHED line");

    const members = readTarGz(uploaded).map((r) => r.path);
    assert.ok(members.length > 0, "the uploaded archive has no member");
    assert.ok(
      !members.some((m) => /^(\.\/)?\.releaserc\.json$/.test(m)),
      "the published archive carries a stray .releaserc.json",
    );

    const out = path.join(p.fx.root, "fresh-render-11c");
    const fresh = spawnSync(
      "bash",
      ["scripts/release-package-extension.sh", "foo", "--version", "1.3.0", "--out", out],
      { cwd: p.fx.fix, env: cleanEnv(p.fx.home), encoding: "utf8" },
    );
    const archive = path.join(out, "foo-1.3.0.tar.gz");
    assert.ok(fs.existsSync(archive), `no fresh archive: ${fresh.stdout}${fresh.stderr}`);
    assert.deepEqual(treeOfArchive(uploaded), treeOfArchive(archive));
  });
});

describe("11d (R14) upload failure", opts, () => {
  it("rc != 0, step=upload, incomplete tag reported, no release POST, one PUT attempt for foo", async () => {
    const p = await publish({ failUpload: true });
    assert.notEqual(p.run.rc, 0, "the driver exited 0 despite a forced upload failure");
    assert.match(p.run.out, /RELEASE-FAILED foo step=upload/);
    assert.match(p.run.out, /RELEASE-INCOMPLETE-TAG foo-v1\.3\.0/);
    assert.ok(!p.log.some((r) => "tag_name" in body(r)), "a release POST happened");
    assert.equal(puts(p.log).length, 1, "a 403 must be attempted exactly once");
  });
});

describe("11e (R14) package failure", opts, () => {
  it("rc != 0, step=package, no tag in origin or locally, no API call for foo", async () => {
    const p = await publish({}, (fx) => {
      // Retired 'components' shape: packaging refuses, which fails the prepare step BEFORE the git step.
      const manifest = path.join(fx.fix, "extensions", "core", "foo", "extension.json");
      const json = JSON.parse(fs.readFileSync(manifest, "utf8")) as Record<string, unknown>;
      fs.writeFileSync(manifest, `${JSON.stringify({ ...json, components: {} }, null, 2)}\n`);
      cleanGit(fx.home, fx.fix, ["add", "-A"]);
      cleanGit(fx.home, fx.fix, [
        "commit",
        "-q",
        "-m",
        ":bug: break foo's manifest (test fixture)",
      ]);
    });
    assert.notEqual(p.run.rc, 0, "the driver exited 0 despite a broken manifest");
    assert.match(p.run.out, /RELEASE-FAILED foo step=package/);
    assert.ok(!originGit(p.fx, ["tag", "-l"]).split("\n").includes("foo-v1.3.0"), "origin tag");
    assert.ok(!cleanGit(p.fx.home, p.fx.fix, ["tag", "-l"]).split("\n").includes("foo-v1.3.0"));
    assert.deepEqual(forFoo(p.log), [], "the GitLab API was called for foo");
  });
});
