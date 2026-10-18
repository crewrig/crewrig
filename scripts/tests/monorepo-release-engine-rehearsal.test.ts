// monorepo-release-engine-rehearsal.test.ts — cases 11a and 11b of the real-engine release suite.
// Replaces scripts/tests/test-monorepo-release-engine.sh (11a rehearsal on both forges, 11b the
// checkout/origin left as found, sentinel credentials, v2-F3 pre-push hook; spec 0265 row J2).
// The REAL semantic-release engine runs against a throwaway fixture whose origin is a local bare
// repository; no network call leaves 127.0.0.1.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { before, describe, it } from "node:test";

import {
  ENGINE_SKIP,
  cleanGit,
  extensionLine,
  ghEnv,
  glEnv,
  makeFixture,
  originGit,
  runDriver,
} from "./lib/release-engine-fixture.ts";
import type { DriverRun, Fixture } from "./lib/release-engine-fixture.ts";

const opts = { skip: ENGINE_SKIP, timeout: 600_000 };

/** The note text printed after a REHEARSAL line, up to the next `--- Rehearsing:` header. */
function notesOf(out: string, ext: string): string {
  const lines: string[] = [];
  let on = false;
  for (const line of out.split("\n")) {
    if (line.startsWith(`REHEARSAL ${ext} `)) {
      on = true;
      continue;
    }
    if (line.startsWith("--- Rehearsing:")) on = false;
    if (on) lines.push(line);
  }
  return lines.join("\n");
}

const linkTargets = (text: string): string[] => [
  ...[...text.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1] ?? ""),
  ...[...text.matchAll(/<(https?:\/\/[^>]+)>/g)].map((m) => m[1] ?? ""),
];
const mdTargets = (text: string): string[] =>
  [...text.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1] ?? "");

describe("11a rehearsal correctness (R3/R4/R5/R6), both forges", opts, () => {
  let gh: DriverRun;
  let gl: DriverRun;
  before(() => {
    const fx = makeFixture();
    gh = runDriver(fx, { ...ghEnv(), RELEASE_DRY_RUN: "true" });
    gl = runDriver(fx, { ...glEnv(), RELEASE_DRY_RUN: "true" });
  });

  const triple = (line: string, version: string, tag: string, baseline: string): void => {
    assert.ok(line.includes(`version=${version}`), line);
    assert.ok(line.includes(`tag=${tag}`), line);
    assert.ok(line.includes(`baseline=${baseline}`), line);
  };

  it("11a: GitHub rehearsal exits 0", () => {
    assert.equal(gh.rc, 0, gh.err);
  });

  it("11a: GitHub rehearsal computes foo 1.3.0 / foo-v1.3.0 / baseline foo-v1.2.0, bar UNCHANGED, baz 1.0.0 / baseline none", () => {
    triple(extensionLine(gh.out, "foo"), "1.3.0", "foo-v1.3.0", "foo-v1.2.0");
    assert.match(gh.out, /UNCHANGED bar/);
    triple(extensionLine(gh.out, "baz"), "1.0.0", "baz-v1.0.0", "none");
  });

  it("11a: GitHub note for foo is non-empty (#1225), carries a commit link and the compare range", () => {
    const notes = notesOf(gh.out, "foo");
    assert.ok(/\S/.test(notes), "the foo note is empty");
    assert.match(notes, /https:\/\/github\.com\/acme\/fixture\/commit\//);
    assert.match(notes, /compare\/foo-v1\.2\.0\.\.\.foo-v1\.3\.0/);
  });

  it("11a: GitLab rehearsal exits 0 and computes the same foo triple as GitHub", () => {
    assert.equal(gl.rc, 0, gl.err);
    triple(extensionLine(gl.out, "foo"), "1.3.0", "foo-v1.3.0", "foo-v1.2.0");
    assert.ok(/\S/.test(notesOf(gl.out, "foo")), "the GitLab foo note is empty (#1225)");
  });

  it("11a: GitLab link set targets the self-hosted host:port (at least one link, R20)", () => {
    const links = linkTargets(notesOf(gl.out, "foo"));
    assert.ok(links.length > 0, "the GitLab note carries no link");
    const bad = links.filter((l) => !l.startsWith("https://gitlab.example.test:8443/"));
    assert.deepEqual(bad, [], "a link does not target the self-hosted host:port");
    const base = "https://gitlab.example.test:8443";
    assert.ok(links.some((l) => l.startsWith(`${base}/acme/sub/fixture/-/commit/`)));
    assert.ok(links.includes(`${base}/acme/sub/fixture/-/compare/foo-v1.2.0...foo-v1.3.0`));
    assert.ok(links.includes(`${base}/acme/sub/fixture/-/issues/12`));
    assert.ok(links.includes(`${base}/other/lib/-/issues/3`));
  });

  it("11a (v2-F4): neither forge links the nested reference acme/sub/other#5", () => {
    assert.ok(!mdTargets(notesOf(gh.out, "foo")).some((l) => l.includes("sub/other")), "GitHub");
    assert.ok(!mdTargets(notesOf(gl.out, "foo")).some((l) => l.includes("sub/other")), "GitLab");
  });

  it("11a (R4/R20): first release baz has baseline none and no compare link on either forge", () => {
    assert.match(extensionLine(gl.out, "baz"), /baseline=none/);
    for (const [name, run] of [
      ["GitHub", gh],
      ["GitLab", gl],
    ] as const) {
      const notes = notesOf(run.out, "baz");
      assert.ok(/\S/.test(notes), `${name} baz note is empty`);
      assert.ok(!mdTargets(notes).some((l) => l.includes("compare")), `${name} compare link`);
    }
  });
});

const refs = (fx: Fixture): string => cleanGit(fx.home, fx.fix, ["for-each-ref"]);
const status = (fx: Fixture): string =>
  cleanGit(fx.home, fx.fix, ["status", "--porcelain=v1", "--ignored"]);
const worktrees = (fx: Fixture): string => cleanGit(fx.home, fx.fix, ["worktree", "list"]);

describe("11b rehearsal leaves the checkout and origin as found (R12/R13)", opts, () => {
  let fx: Fixture;
  let run: DriverRun;
  const before_: Record<string, string> = {};
  const after_: Record<string, string> = {};
  before(() => {
    fx = makeFixture();
    before_["refs"] = refs(fx);
    before_["status"] = status(fx);
    before_["worktree"] = worktrees(fx);
    before_["origin"] = originGit(fx, ["for-each-ref"]);
    // Sentinel credentials in the OUTER env: rehearsal needs none, and a credential is only named.
    run = runDriver(fx, {
      ...ghEnv(),
      RELEASE_DRY_RUN: "true",
      GITLAB_TOKEN: "sentinel-outer-9f3a",
      RELEASE_TOKEN: "sentinel-outer-b271",
    });
    after_["refs"] = refs(fx);
    after_["status"] = status(fx);
    after_["worktree"] = worktrees(fx);
    after_["origin"] = originGit(fx, ["for-each-ref"]);
  });

  it("11b: rehearsal succeeds with sentinel credentials sitting unused, and none appears in output", () => {
    assert.equal(run.rc, 0, run.err);
    assert.doesNotMatch(run.out + run.err, /sentinel-outer-9f3a|sentinel-outer-b271/);
  });

  it("11b: refs, working tree, worktree list and origin refs are unchanged (non-empty snapshots)", () => {
    for (const key of ["refs", "worktree", "origin"]) {
      assert.ok((before_[key] ?? "") !== "", `${key} snapshot is empty: the comparison is vacuous`);
    }
    assert.equal(after_["refs"], before_["refs"], "the checkout's refs changed");
    assert.equal(after_["status"], before_["status"], "the working tree changed");
    assert.equal(after_["worktree"], before_["worktree"], "a stray worktree survived");
    assert.equal(after_["origin"], before_["origin"], "origin's refs changed");
  });

  it("11b: the REHEARSAL line reports a sha256 digest for the built archive", () => {
    assert.match(extensionLine(run.out, "foo"), /sha256=[0-9a-f]{64}/);
  });
});

describe("11b (v2-F3) the mirror push does not run the checkout's pre-push hook", opts, () => {
  it("marker absent AND rc 0", () => {
    const fx = makeFixture();
    const marker = path.join(fx.root, "prepush-fired-marker");
    const hook = path.join(fx.fix, ".git", "hooks", "pre-push");
    fs.writeFileSync(hook, `#!/bin/bash\ntouch "${marker}"\nexit 0\n`, { mode: 0o755 });
    const run = runDriver(fx, { ...ghEnv(), RELEASE_DRY_RUN: "true" });
    assert.equal(run.rc, 0, run.err);
    assert.ok(!fs.existsSync(marker), "the pre-push hook fired: the mirror push lacks --no-verify");
  });
});
