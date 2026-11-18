// Spec 0310 R7, R12: the stable guards (ref, head of main, version, no tag, no published release).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { main } from "../lib/framework-release/guard-main.ts";
import { Fixture, standardRepo } from "./lib/framework-release-fixture.ts";

let fx: Fixture;
let mainSha = "";
beforeEach(() => {
  fx = new Fixture();
  mainSha = standardRepo(fx).mainSha;
});
afterEach(() => fx.dispose());

function releases(list: unknown): string {
  const file = path.join(fx.root, "releases.json");
  fs.writeFileSync(file, JSON.stringify(list));
  return file;
}

function guard(over: { version?: string; ref?: string; commit?: string; json?: string } = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const code = main(
    [
      "--kind", "stable",
      "--version", over.version ?? "1.0.0",
      "--ref", over.ref ?? "refs/heads/main",
      "--commit", over.commit ?? mainSha,
      "--releases-json", over.json ?? releases([]),
      "--repo", fx.work,
    ],
    { out: (l) => out.push(l), err: (l) => err.push(l) },
  );
  return { code, text: out.join("\n"), err };
}

describe("stable guards", () => {
  it("passes on the head of main with the declared version and no tag or release", () => {
    const res = guard();
    assert.equal(res.code, 0, res.text);
  });

  it("fails off main", () => {
    const res = guard({ ref: "refs/heads/release/1822-distribution" });
    assert.equal(res.code, 1);
    assert.match(res.text, /FAIL ref/);
  });

  it("fails when the commit is not the head of main", () => {
    fx.git("checkout", "-q", "main");
    fx.commit({ "later.txt": "x" }, "later");
    fx.push("main");
    const res = guard();
    assert.equal(res.code, 1);
    assert.match(res.text, /FAIL head-of-main/);
  });

  it("fails when the input version differs from the declared one", () => {
    const res = guard({ version: "1.0.1" });
    assert.equal(res.code, 1);
    assert.match(res.text, /FAIL version/);
  });

  it("fails on a version that is not a SemVer core", () => {
    assert.equal(guard({ version: "1.0.0-next.1" }).code, 1);
  });

  it("fails when the tag already exists on origin", () => {
    fx.git("tag", "crewrig-v1.0.0", mainSha);
    fx.push("crewrig-v1.0.0");
    const res = guard();
    assert.equal(res.code, 1);
    assert.match(res.text, /FAIL no-tag/);
  });

  it("fails when a published release of that name exists", () => {
    const res = guard({ json: releases([{ tag_name: "crewrig-v1.0.0", draft: false }]) });
    assert.equal(res.code, 1);
    assert.match(res.text, /FAIL no-release/);
  });

  it("reads the paginated `--slurp` form (an array of pages)", () => {
    const json = releases([[{ tag_name: "x-v1" }], [{ tag_name: "crewrig-v1.0.0", draft: false }]]);
    assert.equal(guard({ json }).code, 1);
  });

  it("does not refuse on a leftover draft: its fate is the publisher's (R5)", () => {
    const res = guard({ json: releases([{ tag_name: "crewrig-v1.0.0", draft: true }]) });
    assert.equal(res.code, 0, res.text);
  });

  it("fails closed when the releases file is missing or malformed", () => {
    const missing = guard({ json: path.join(fx.root, "absent.json") });
    assert.equal(missing.code, 1);
    assert.match(missing.text, /FAIL no-release: cannot read the releases file/);
    const bad = path.join(fx.root, "bad.json");
    fs.writeFileSync(bad, "{}");
    assert.equal(guard({ json: bad }).code, 1);
  });
});
