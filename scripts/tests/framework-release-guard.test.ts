// Spec 0310 R1, R6, R12: the prerelease guards, run in a temporary repository with a bare origin.

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { main } from "../lib/framework-release/guard-main.ts";
import { Fixture, standardRepo } from "./lib/framework-release-fixture.ts";

let fx: Fixture;
beforeEach(() => {
  fx = new Fixture();
});
afterEach(() => fx.dispose());

function guard(tag: string, commit: string, extra: string[] = []): { code: number; err: string[]; out: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const code = main(
    ["--kind", "prerelease", "--tag", tag, "--commit", commit, "--repo", fx.work, ...extra],
    { out: (l) => out.push(l), err: (l) => err.push(l) },
  );
  return { code, out, err };
}

describe("prerelease guards", () => {
  it("passes on a release-branch commit with a matching version", () => {
    const { releaseSha } = standardRepo(fx);
    const res = guard("crewrig-v1.0.0-next.1", releaseSha);
    assert.equal(res.code, 0, res.err.join("\n"));
    assert.equal(res.out.length, 4);
  });

  for (const tag of [
    "crewrig-v1.0.0",
    "crewrig-v1.0.0-next.0",
    "crewrig-v1.0.0-next.01",
    "crewrig-v01.0.0-next.1",
    "crewrig-v1.0-next.1",
    "crewrig-v1.0.0-rc.1",
    "v1.0.0-next.1",
  ]) {
    it(`refuses the malformed tag '${tag}' before any ref work`, () => {
      const { releaseSha } = standardRepo(fx);
      const res = guard(tag, releaseSha);
      assert.equal(res.code, 1);
      assert.match(res.out.join("\n"), /FAIL form/);
    });
  }

  it("fails when the tag version differs from the declared version", () => {
    const { releaseSha } = standardRepo(fx);
    const res = guard("crewrig-v1.0.1-next.1", releaseSha);
    assert.equal(res.code, 1);
    assert.match(res.out.join("\n"), /FAIL version: tag version 1\.0\.1 differs from the declared version 1\.0\.0/);
  });

  it("fails on a feature-branch commit that is not on the release branch", () => {
    standardRepo(fx);
    const feature = fx.commit({ "x.txt": "x" }, "feature");
    const res = guard("crewrig-v1.0.0-next.1", feature);
    assert.equal(res.code, 1);
    assert.match(res.out.join("\n"), /FAIL release-branch/);
  });

  it("fails on a commit that is an ancestor of main", () => {
    const { mainSha } = standardRepo(fx);
    const res = guard("crewrig-v1.0.0-next.1", mainSha);
    assert.equal(res.code, 1);
    const text = res.out.join("\n");
    assert.match(text, /FAIL not-on-main/);
    assert.match(text, /ok   release-branch/);
  });

  it("fails when the release branch cannot be fetched", () => {
    const { releaseSha } = standardRepo(fx);
    const res = guard("crewrig-v1.0.0-next.1", releaseSha, ["--release-branch", "release/absent"]);
    assert.equal(res.code, 1);
    assert.match(res.out.join("\n"), /FAIL release-branch: cannot fetch origin\/release\/absent/);
  });

  it("fails when main cannot be fetched", () => {
    const { releaseSha } = standardRepo(fx);
    const res = guard("crewrig-v1.0.0-next.1", releaseSha, ["--main-branch", "absent"]);
    assert.equal(res.code, 1);
    assert.match(res.out.join("\n"), /FAIL not-on-main: cannot fetch origin\/absent/);
  });

  it("fails when the tagged commit cannot be resolved", () => {
    standardRepo(fx);
    const res = guard("crewrig-v1.0.0-next.1", "0".repeat(40));
    assert.equal(res.code, 1);
    assert.match(res.out.join("\n"), /FAIL commit/);
  });

  it("fails when package.json declares no version", () => {
    standardRepo(fx);
    const sha = fx.commit({ "package.json": "{}\n" }, "no version");
    fx.push("release/1822-distribution");
    const res = guard("crewrig-v1.0.0-next.1", sha);
    assert.equal(res.code, 1);
    assert.match(res.out.join("\n"), /FAIL version: package\.json at .* declares no version/);
  });

  it("exits 2 on a usage error", () => {
    const res = main(["--kind", "other"], { out: () => {}, err: () => {} });
    assert.equal(res, 2);
  });
});
