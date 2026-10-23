// Tests for parsePushRefs and dirtyNotice of scripts/lib/ci-pre-push/hooks.ts (spec 0279 R11).

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dirtyNotice, parsePushRefs } from "../lib/ci-pre-push/hooks.ts";
import { commitAll, newRepo, writeRel } from "./lib/governance-git-fixture.ts";

const HEAD = "a".repeat(40);
const OTHER = "b".repeat(40);
const ZERO = "0".repeat(40);

describe("parsePushRefs", () => {
  it("treats undefined and blank input as a push of HEAD", () => {
    assert.deepEqual(parsePushRefs(undefined, HEAD), { shas: [HEAD], notices: [] });
    assert.deepEqual(parsePushRefs("  \n", HEAD), { shas: [HEAD], notices: [] });
  });

  it("checks a new branch and an existing branch at HEAD", () => {
    const fresh = `refs/heads/f ${HEAD} refs/heads/f ${ZERO}\n`;
    const existing = `refs/heads/f ${HEAD} refs/heads/f ${OTHER}\n`;
    assert.deepEqual(parsePushRefs(fresh, HEAD), { shas: [HEAD], notices: [] });
    assert.deepEqual(parsePushRefs(existing, HEAD), { shas: [HEAD], notices: [] });
  });

  it("skips a delete with a notice", () => {
    const r = parsePushRefs(`(delete) ${ZERO} refs/heads/old ${OTHER}\n`, HEAD);
    assert.deepEqual(r.shas, []);
    assert.deepEqual(r.notices, ["skipped delete of refs/heads/old"]);
  });

  it("skips a tag with a notice", () => {
    const r = parsePushRefs(`refs/tags/v1 ${HEAD} refs/tags/v1 ${ZERO}\n`, HEAD);
    assert.deepEqual(r.shas, []);
    assert.deepEqual(r.notices, ["skipped tag refs/tags/v1"]);
  });

  it("reports a ref that is not the checked-out commit and does not check it", () => {
    const r = parsePushRefs(`refs/heads/other ${OTHER} refs/heads/other ${ZERO}\n`, HEAD);
    assert.deepEqual(r.shas, []);
    assert.match(
      r.notices[0] ?? "",
      /not checked: refs\/heads\/other is not the checked-out commit/,
    );
  });

  it("deduplicates and mixes several refs", () => {
    const input = [
      `refs/heads/a ${HEAD} refs/heads/a ${ZERO}`,
      `refs/heads/b ${HEAD} refs/heads/b ${OTHER}`,
      `refs/heads/c ${OTHER} refs/heads/c ${ZERO}`,
      `(delete) ${ZERO} refs/heads/d ${OTHER}`,
    ].join("\n");
    const r = parsePushRefs(`${input}\n`, HEAD);
    assert.deepEqual(r.shas, [HEAD]);
    assert.equal(r.notices.length, 2);
  });

  it("compares shas case-insensitively", () => {
    const r = parsePushRefs(`refs/heads/a ${HEAD.toUpperCase()} refs/heads/a ${ZERO}\n`, HEAD);
    assert.deepEqual(r.shas, [HEAD]);
  });

  it("throws on a malformed line", () => {
    assert.throws(() => parsePushRefs("refs/heads/a only-two\n", HEAD), /malformed pre-push line/);
  });
});

describe("dirtyNotice", () => {
  it("is null on a clean tree and a notice once a file is modified or untracked", () => {
    const dir = newRepo();
    writeRel(dir, "a.txt", "1");
    commitAll(dir, "base");
    assert.equal(dirtyNotice(dir), null);
    writeRel(dir, "b.txt", "2");
    assert.match(dirtyNotice(dir) ?? "", /working tree is dirty/);
  });
});
