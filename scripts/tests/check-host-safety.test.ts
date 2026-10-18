// check-host-safety.test.ts — behavior suite of scripts/check-host-safety.ts (issue #1673, spec 0267
// R8-R10, R14-R15). The checker runs as a child process against fixture trees built under the test's
// own mkdtemp root; `runCheck` asserts after every run that the canary survived and no scanned
// source was executed. Nothing here removes a path other than a root this suite created.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, it } from "node:test";
import {
  ALL_CLEAN_ROOT_GUARDED_RM,
  ALLOWLIST_HEADER,
  ARGV_RENAME,
  ENV_RM,
  ENV_RM_KEY,
  ENV_RM_LINE,
  GUARDED_RM,
  HOME_CP,
  NULLISH_MKDTEMP_RM,
  OR_MKDTEMP_RM,
  OWN_MKDTEMP_RM,
  PARAMETER_HELPER,
  REASSIGNED_RM,
  REPO,
  SCOPE_COLLISION,
  TERNARY_ALL_CLEAN_RM,
  TERNARY_MKDTEMP_RM,
  TMPDIR_MKDTEMP,
  UNION_ROOT_GUARDED_RM,
  commitAll,
  disposeFixture,
  makeFixture,
  runCheck,
  writeAllowlist,
  type Fixture,
  type FixtureOptions,
} from "./lib/host-safety-fixtures.ts";

const live: Fixture[] = [];
function fixture(opts: FixtureOptions = {}): Fixture {
  const fx = makeFixture(opts);
  live.push(fx);
  return fx;
}
afterEach(() => {
  for (const fx of live.splice(0)) disposeFixture(fx);
});

const entry = (key: string, why = "fixture reason"): string => `${key}\t${why}\n`;

describe("check-host-safety: findings", () => {
  it("flags an env-derived rmSync, naming the source and the assertInside fix", () => {
    const fx = fixture({ sources: { "scripts/tests/wipe.ts": ENV_RM } });
    const res = runCheck(fx);
    assert.equal(res.status, 1, res.stderr);
    assert.deepEqual(res.findings.length, 1, res.stderr);
    const line = res.findings[0] as string;
    assert.match(
      line,
      new RegExp(`^host-safety: env-derived-destructive: scripts/tests/wipe\\.ts:${ENV_RM_LINE}: `),
    );
    assert.match(line, /process\.env\.CANARY_DIR/);
    assert.match(line, /assertInside\(root, p\)/);
  });

  it("passes the same delete once assertInside(root, dir) runs earlier in the function", () => {
    const fx = fixture({ sources: { "scripts/tests/wipe.ts": GUARDED_RM } });
    const res = runCheck(fx);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /host-safety: OK/);
  });

  it("passes the removal of a directory the file made with mkdtemp itself", () => {
    const fx = fixture({ sources: { "scripts/tests/scratch.ts": OWN_MKDTEMP_RM } });
    assert.equal(runCheck(fx).status, 0);
  });

  it("passes the removal of an mkdtemp result even when its prefix is built from process.env.TMPDIR", () => {
    const fx = fixture({ sources: { "scripts/tests/scratch.ts": TMPDIR_MKDTEMP } });
    assert.equal(runCheck(fx).status, 0);
  });

  const flaggedAs = (src: string, re: RegExp): void => {
    const fx = fixture({ sources: { "scripts/tests/scratch.ts": src } });
    const res = runCheck(fx);
    assert.equal(res.status, 1, res.stderr);
    assert.equal(res.findings.length, 1, res.stderr);
    assert.match(res.findings[0] as string, re);
  };

  it("flags an rmSync of `process.env.X ?? mkdtempSync(...)`: one untrusted branch taints the binding", () => {
    flaggedAs(NULLISH_MKDTEMP_RM, /env-derived-destructive: .*process\.env\.CANARY_DIR/);
  });

  it("flags an rmSync of `process.env.X || mkdtempSync(...)`", () => {
    flaggedAs(OR_MKDTEMP_RM, /env-derived-destructive: .*process\.env\.CANARY_DIR/);
  });

  it("flags an rmSync of `cond ? process.env.X : mkdtempSync(...)`", () => {
    flaggedAs(TERNARY_MKDTEMP_RM, /env-derived-destructive: .*process\.env\.CANARY_DIR/);
  });

  it("passes a conditional whose every branch is an mkdtemp result", () => {
    const fx = fixture({ sources: { "scripts/tests/scratch.ts": TERNARY_ALL_CLEAN_RM } });
    assert.equal(runCheck(fx).status, 0);
  });

  it("flags a binding that began as an mkdtemp result and was later reassigned from process.env", () => {
    flaggedAs(REASSIGNED_RM, /env-derived-destructive: .*process\.env\.CANARY_DIR/);
  });

  it("does not count a guard root that is a union with an untrusted branch as containment", () => {
    const fx = fixture({ sources: { "scripts/tests/wipe.ts": UNION_ROOT_GUARDED_RM } });
    const res = runCheck(fx);
    assert.equal(res.status, 1, res.stderr);
    assert.equal(res.findings.length, 1, res.stderr);
  });

  it("counts a guard root whose every branch is an mkdtemp result as containment", () => {
    const fx = fixture({ sources: { "scripts/tests/wipe.ts": ALL_CLEAN_ROOT_GUARDED_RM } });
    assert.equal(runCheck(fx).status, 0);
  });

  it("flags path.join(process.env.HOME, ...) as a cpSync destination, naming HOME", () => {
    const fx = fixture({ sources: { "scripts/tests/copy-in.ts": HOME_CP } });
    const res = runCheck(fx);
    assert.equal(res.status, 1, res.stderr);
    assert.equal(res.findings.length, 1, res.stderr);
    assert.match(
      res.findings[0] as string,
      /^host-safety: env-derived-destructive: scripts\/tests\/copy-in\.ts:\d+: .*process\.env\.HOME/,
    );
  });

  it("flags an argv-derived path reaching renameSync through a parsed options object", () => {
    const fx = fixture({ sources: { "scripts/tests/publish.ts": ARGV_RENAME } });
    const res = runCheck(fx);
    assert.equal(res.status, 1, res.stderr);
    assert.equal(res.findings.length, 1, res.stderr);
    assert.match(
      res.findings[0] as string,
      /^host-safety: argv-derived-destructive: scripts\/tests\/publish\.ts:\d+: .*process\.argv/,
    );
  });

  it("resolves names by lexical scope: a loop variable does not taint a sibling binding of the same name", () => {
    const fx = fixture({ sources: { "scripts/tests/collide.ts": SCOPE_COLLISION } });
    const res = runCheck(fx);
    assert.equal(res.status, 0, res.stderr);
  });

  // KNOWN LIMIT, pinned on purpose (issues #1673 and #1722): taint does not cross a function
  // boundary through a parameter, so the incident shape (an unsafe path handed to a helper that
  // deletes it) is NOT flagged by the static check. The runtime guard (`assertInside`) and the brief
  // rule cover it; #1722 tracks closing the gap. If this ever starts failing because the checker got
  // smarter, flip the expectation and remove this comment.
  it("does not flag the incident shape where the path reaches the delete through a helper parameter", () => {
    const fx = fixture({ sources: { "scripts/tests/helper.ts": PARAMETER_HELPER } });
    const res = runCheck(fx);
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(res.findings, []);
  });
});

describe("check-host-safety: allowlist", () => {
  const source = { "scripts/tests/wipe.ts": ENV_RM };

  it("silences a flagged site that has an entry with a justification", () => {
    const fx = fixture({ sources: source, allowlist: ALLOWLIST_HEADER + entry(ENV_RM_KEY) });
    const res = runCheck(fx);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /1 allowlisted/);
  });

  it("reports allowlist-unjustified for an entry without a written justification", () => {
    const fx = fixture({ sources: source, allowlist: `${ALLOWLIST_HEADER}${ENV_RM_KEY}\t\n` });
    const res = runCheck(fx);
    assert.equal(res.status, 1, res.stderr);
    assert.match(
      res.stderr,
      /host-safety: allowlist-unjustified: ci\/host-safety-allowlist\.txt:2: /,
    );
  });

  it("reports allowlist-stale for an entry whose call site is no longer flagged", () => {
    const fx = fixture({
      sources: { "scripts/tests/wipe.ts": GUARDED_RM },
      allowlist: ALLOWLIST_HEADER + entry(ENV_RM_KEY),
    });
    const res = runCheck(fx);
    assert.equal(res.status, 1, res.stderr);
    assert.match(res.stderr, /host-safety: allowlist-stale: ci\/host-safety-allowlist\.txt:2: /);
  });

  it("reports allowlist-unsorted for entries out of byte order", () => {
    const keyA = "scripts/tests/a.ts::wipe::fs.rmSync#1";
    const keyB = "scripts/tests/b.ts::wipe::fs.rmSync#1";
    const fx = fixture({
      sources: { "scripts/tests/a.ts": ENV_RM, "scripts/tests/b.ts": ENV_RM },
      allowlist: ALLOWLIST_HEADER + entry(keyB) + entry(keyA),
    });
    const res = runCheck(fx);
    assert.equal(res.status, 1, res.stderr);
    assert.deepEqual(res.findings.length, 1, res.stderr);
    assert.match(
      res.findings[0] as string,
      /^host-safety: allowlist-unsorted: ci\/host-safety-allowlist\.txt:3: .*out of byte order/,
    );
  });

  it("reports allowlist-unsorted for a duplicate entry", () => {
    const fx = fixture({
      sources: source,
      allowlist: ALLOWLIST_HEADER + entry(ENV_RM_KEY) + entry(ENV_RM_KEY),
    });
    const res = runCheck(fx);
    assert.equal(res.status, 1, res.stderr);
    assert.match(
      res.stderr,
      /host-safety: allowlist-unsorted: ci\/host-safety-allowlist\.txt:3: duplicate entry/,
    );
  });

  it("reports allowlist-entry-added, exit 1, for an entry absent from the merge base", () => {
    const fx = fixture({ sources: source });
    commitAll(fx);
    writeAllowlist(fx, ALLOWLIST_HEADER + entry(ENV_RM_KEY));
    const res = runCheck(fx, { BASE_REF: "main" });
    assert.equal(res.status, 1, res.stderr);
    assert.match(
      res.stderr,
      /host-safety: allowlist-entry-added: ci\/host-safety-allowlist\.txt:2: .*assertInside\(root, p\)/,
    );
  });

  it("accepts the same entry when it already exists on the merge base", () => {
    const fx = fixture({ sources: source, allowlist: ALLOWLIST_HEADER + entry(ENV_RM_KEY) });
    commitAll(fx);
    const res = runCheck(fx, { BASE_REF: "main" });
    assert.equal(res.status, 0, res.stderr);
  });
});

describe("check-host-safety: wiring faults", () => {
  it("exits 2 when the allowlist file is missing", () => {
    const fx = fixture({ allowlist: null });
    const res = runCheck(fx);
    assert.equal(res.status, 2, res.stderr);
    assert.match(res.stderr, /host-safety: error: .*host-safety-allowlist\.txt is missing/);
  });

  it("exits 2 when a scan root is missing", () => {
    const fx = fixture({ noLibDir: true });
    const res = runCheck(fx);
    assert.equal(res.status, 2, res.stderr);
    assert.match(res.stderr, /host-safety: error: scan root scripts\/lib\/ is missing/);
  });
});

describe("check-host-safety: real tree", () => {
  it("exits 0 on this repository without modifying it", () => {
    const status = (): string =>
      spawnSync("git", ["--no-optional-locks", "-C", REPO, "status", "--porcelain"], {
        encoding: "utf8",
      }).stdout;
    const before = status();
    const res = runCheck(null);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /host-safety: OK/);
    assert.equal(status(), before);
    assert.ok(fs.existsSync(path.join(REPO, "ci", "host-safety-allowlist.txt")));
  });
});
