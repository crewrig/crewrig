// Spec 0310 R4, R5, R12: the publisher against a localhost stub of the GitHub REST API.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { main } from "../lib/framework-release/publish-main.ts";
import { sha256File } from "../lib/packaging/digest.ts";
import { Stub } from "./lib/framework-release-stub.ts";
import type { StubOptions } from "./lib/framework-release-stub.ts";

const TAG = "crewrig-v1.0.0-next.1";
let dir = "";
let asset = "";
let digest = "";
let stub: Stub | undefined;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-fwpub-"));
  asset = path.join(dir, "a.tgz");
  fs.writeFileSync(asset, "archive bytes");
  fs.writeFileSync(path.join(dir, "notes.md"), "notes");
  digest = sha256File(asset);
});
afterEach(async () => {
  await stub?.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function run(opts: StubOptions, kind = "prerelease", token = "secret-token") {
  stub = new Stub(opts);
  await stub.start();
  const err: string[] = [];
  const out: string[] = [];
  const code = await main(
    [
      "--kind",
      kind,
      "--tag",
      TAG,
      "--commit",
      "c0ffee",
      "--asset",
      asset,
      "--notes",
      path.join(dir, "notes.md"),
      "--repository",
      "o/r",
      "--api-url",
      stub.url,
      "--uploads-url",
      stub.url,
    ],
    { out: (l) => out.push(l), err: (l) => err.push(l) },
    { GH_TOKEN: token },
    {
      sleep: () => Promise.resolve(),
      digestAttempts: 3,
      digestDelayMs: 0,
      log: (l) => out.push(l),
    },
  );
  return { code, err, out, calls: stub.calls(), requests: stub.requests };
}

const body = (req: { body: Buffer } | undefined): Record<string, unknown> =>
  JSON.parse(req?.body.toString() ?? "{}") as Record<string, unknown>;

const PUBLISH = "PATCH /repos/o/r/releases/900";

describe("framework release publisher", () => {
  it("happy path: draft, upload, digest from the upload response, publish not latest", async () => {
    const res = await run({ uploadDigest: `sha256:${digest}` });
    assert.equal(res.code, 0, res.err.join("\n"));
    assert.deepEqual(res.calls, [
      "GET /repos/o/r/releases",
      "POST /repos/o/r/releases",
      "POST /repos/o/r/releases/900/assets",
      PUBLISH,
    ]);
    const create = body(res.requests[1]);
    assert.deepEqual(
      [
        create.draft,
        create.prerelease,
        create.make_latest,
        create.target_commitish,
        create.tag_name,
      ],
      [true, true, "false", "c0ffee", TAG],
    );
    const patch = body(res.requests[3]);
    assert.deepEqual(patch, { draft: false, prerelease: true, make_latest: "false" });
    assert.equal(res.requests[2]?.body.toString(), "archive bytes");
  });

  it("falls back to reading the release when the upload response has no digest", async () => {
    const res = await run({ uploadDigest: null, readbackDigest: `sha256:${digest}` });
    assert.equal(res.code, 0, res.err.join("\n"));
    assert.ok(res.calls.includes("GET /repos/o/r/releases/900"));
    assert.equal(res.calls.at(-1), PUBLISH);
  });

  it("marks a stable release as not a prerelease and still not latest", async () => {
    const res = await run({ uploadDigest: `sha256:${digest}` }, "stable");
    assert.equal(res.code, 0);
    const patch = body(res.requests.at(-1));
    assert.deepEqual(patch, { draft: false, prerelease: false, make_latest: "false" });
  });

  it("fails closed, publishing nothing, when no source has a digest", async () => {
    const res = await run({ uploadDigest: "", readbackDigest: null });
    assert.equal(res.code, 1);
    assert.match(res.err.join("\n"), /reports no digest/);
    assert.ok(!res.calls.includes(PUBLISH));
    assert.equal(res.calls.filter((c) => c === "GET /repos/o/r/releases/900").length, 3);
  });

  it("publishes nothing on a digest mismatch", async () => {
    const res = await run({ uploadDigest: `sha256:${"0".repeat(64)}` });
    assert.equal(res.code, 1);
    assert.match(res.err.join("\n"), /digest mismatch/);
    assert.ok(!res.calls.includes(PUBLISH));
  });

  it("a re-run on a published release fails before any upload or deletion", async () => {
    const res = await run({ releases: [{ id: 5, tag_name: TAG, draft: false }] });
    assert.equal(res.code, 1);
    assert.match(res.err.join("\n"), /a published release of crewrig-v1\.0\.0-next\.1 exists/);
    assert.deepEqual(res.calls, ["GET /repos/o/r/releases"]);
  });

  it("deletes a leftover draft of the tag, and only that one, before creating a new draft", async () => {
    const res = await run({
      uploadDigest: `sha256:${digest}`,
      releases: [
        { id: 7, tag_name: TAG, draft: true },
        { id: 8, tag_name: "other-v1", draft: true },
      ],
    });
    assert.equal(res.code, 0, res.err.join("\n"));
    assert.deepEqual(res.calls.slice(0, 3), [
      "GET /repos/o/r/releases",
      "DELETE /repos/o/r/releases/7",
      "POST /repos/o/r/releases",
    ]);
    assert.ok(!res.calls.includes("DELETE /repos/o/r/releases/8"));
  });

  it("never prints the token", async () => {
    const res = await run({ uploadDigest: `sha256:${"0".repeat(64)}` }, "prerelease", "tok-12345");
    assert.ok(![...res.err, ...res.out].join("\n").includes("tok-12345"));
  });

  it("exits 2 without a token", async () => {
    const res = await run({}, "prerelease", "");
    assert.equal(res.code, 2);
    assert.deepEqual(res.calls, []);
  });
});
