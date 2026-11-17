// sync-from-upstream-policies.test.ts — manifest policies of scripts/sync-from-upstream.ts
// (spec 0260; replaces groups G1, G2, G4 and cases vv, bbb of test-sync-from-upstream.sh).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import {
  createSyncRoot,
  exists,
  git,
  makeAdopter,
  makeUpstream,
  read,
  runSync,
  why,
  writeFile,
  type SyncRoot,
} from "./lib/sync-fixture.ts";

let sr: SyncRoot;
before(() => {
  sr = createSyncRoot("crewrig-sync-pol-");
});
after(() => sr.dispose());

/** Upstream with a README at v1 then v2. */
const readmeUpstream = (): string =>
  makeUpstream(sr, [{ "README.md": "upstream readme v1" }, { "README.md": "upstream readme v2" }]);

describe("G1 basics", () => {
  test("1 clean core: exit 0, upstream content, nothing staged", () => {
    const files = { "core-file.txt": "upstream content", "other.txt": "other content" };
    const upstream = makeUpstream(sr, [files]);
    const adopter = makeAdopter(sr, { upstream, manifest: ["core-file.txt"], files });
    const out = runSync(sr, adopter);
    assert.equal(out.status, 0, why(out));
    assert.equal(read(adopter, "core-file.txt"), "upstream content");
    assert.equal(git(sr, adopter, "diff", "--cached", "--name-only"), "");
  });

  test("2 dirty strict file aborts, names it, leaves the worktree untouched", () => {
    const upstream = makeUpstream(sr, [{ "core-file.txt": "upstream content" }]);
    const adopter = makeAdopter(sr, {
      upstream,
      manifest: ["core-file.txt"],
      files: { "core-file.txt": "upstream content" },
    });
    writeFile(adopter, "core-file.txt", "local override content\n");
    const out = runSync(sr, adopter);
    assert.equal(out.status, 1, why(out));
    assert.ok(out.stderr.includes("core-file.txt"), why(out));
    assert.equal(read(adopter, "core-file.txt"), "local override content\n");
  });

  for (const [label, config] of [
    ["3 empty canonical_repo", 'canonical_repo = ""\n'],
    ["4 absent canonical_repo", "# empty config\n"],
  ] as const) {
    test(`${label}: exit 1 and stderr names canonical_repo`, () => {
      const adopter = makeAdopter(sr, {
        upstream: "",
        manifest: ["core-file.txt"],
        files: { "core-file.txt": "content" },
        config,
      });
      const out = runSync(sr, adopter);
      assert.equal(out.status, 1, why(out));
      assert.ok(out.stderr.includes("canonical_repo"), why(out));
    });
  }
});

describe("G2 policies (spec 0020)", () => {
  test("a excluded nested org subtree does not abort the strict guard", () => {
    const upstream = makeUpstream(sr, [{ "specs/0001.md": "upstream spec content" }]);
    const adopter = makeAdopter(sr, {
      upstream,
      manifest: ["specs\tstrict", "specs/org\texcluded"],
      files: {
        "specs/0001.md": "upstream spec content",
        "specs/org/orgspec.md": "ORG ONLY content",
      },
    });
    writeFile(adopter, "specs/org/orgspec.md", "ORG customised content\n");
    const out = runSync(sr, adopter);
    assert.equal(out.status, 0, why(out));
    assert.equal(read(adopter, "specs/0001.md"), "upstream spec content");
    assert.equal(read(adopter, "specs/org/orgspec.md"), "ORG customised content\n");
  });

  test("b adopt-on-edit file equal to upstream v2 reflects upstream", () => {
    const adopter = makeAdopter(sr, {
      upstream: readmeUpstream(),
      manifest: ["README.md\tadopt-on-edit"],
      files: { "README.md": "upstream readme v2" },
    });
    const out = runSync(sr, adopter);
    assert.equal(out.status, 0, why(out));
    assert.equal(read(adopter, "README.md"), "upstream readme v2");
  });

  test("c modified adopt-on-edit file is frozen with exit 0", () => {
    const adopter = makeAdopter(sr, {
      upstream: readmeUpstream(),
      manifest: ["README.md\tadopt-on-edit"],
      files: { "README.md": "upstream readme v1" },
    });
    writeFile(adopter, "README.md", "ADOPTER customised readme\n");
    const out = runSync(sr, adopter);
    assert.equal(out.status, 0, why(out));
    assert.equal(read(adopter, "README.md"), "ADOPTER customised readme\n");
  });

  test("d strict AGENTS.md local edit aborts and names AGENTS.md", () => {
    const upstream = makeUpstream(sr, [{ "AGENTS.md": "upstream agents" }]);
    const adopter = makeAdopter(sr, {
      upstream,
      manifest: ["AGENTS.md\tstrict"],
      files: { "AGENTS.md": "upstream agents" },
    });
    writeFile(adopter, "AGENTS.md", "local override\n");
    const out = runSync(sr, adopter);
    assert.equal(out.status, 1, why(out));
    assert.ok(out.stderr.includes("AGENTS.md"), why(out));
  });

  test("e marker directory present does not abort the strict .crewrig parent", () => {
    const manifest = [".crewrig\tstrict", ".crewrig/.synced-markers\texcluded"];
    const upstream = makeUpstream(sr, [{ ".crewrig/core-paths.txt": `${manifest.join("\n")}\n` }]);
    const adopter = makeAdopter(sr, {
      upstream,
      manifest,
      files: { ".crewrig/.synced-markers/README.md.sha": "deadbeef\n" },
    });
    const out = runSync(sr, adopter);
    assert.equal(out.status, 0, why(out));
    assert.ok(exists(adopter, ".crewrig/.synced-markers/README.md.sha"), "marker file was deleted");
  });

  const markerManifest = ["README.md\tadopt-on-edit", ".crewrig/.synced-markers\texcluded"];

  test("f stale-but-unmodified adopt-on-edit fork (older upstream blob) updates to v2", () => {
    const adopter = makeAdopter(sr, {
      upstream: readmeUpstream(),
      manifest: markerManifest,
      files: { "README.md": "upstream readme v1" },
    });
    const out = runSync(sr, adopter);
    assert.equal(out.status, 0, why(out));
    assert.equal(read(adopter, "README.md"), "upstream readme v2");
  });

  test("g pre-feature customisation freezes and the marker records the adopter's own blob", () => {
    const adopter = makeAdopter(sr, {
      upstream: readmeUpstream(),
      manifest: markerManifest,
      files: { "README.md": "ORG custom readme never upstream" },
    });
    const out = runSync(sr, adopter);
    assert.equal(out.status, 0, why(out));
    assert.equal(read(adopter, "README.md"), "ORG custom readme never upstream");
    const expected = git(sr, adopter, "hash-object", path.join(adopter, "README.md")).trim();
    const marker = fs.readFileSync(
      path.join(adopter, ".crewrig", ".synced-markers", "README.md.sha"),
      "utf8",
    );
    assert.equal(marker.trim(), expected);
  });

  test("vv org channel file under the strict model-mappings parent does not abort", () => {
    const upstream = makeUpstream(sr, [{ "model-mappings/claude.yml": "upstream core content" }]);
    const adopter = makeAdopter(sr, {
      upstream,
      manifest: ["model-mappings\tstrict", "model-mappings/claude.org.yml\texcluded"],
      files: {
        "model-mappings/claude.yml": "upstream core content",
        "model-mappings/claude.org.yml": "ORG ONLY override content",
      },
    });
    writeFile(adopter, "model-mappings/claude.org.yml", "ORG customised override\n");
    const out = runSync(sr, adopter);
    assert.equal(out.status, 0, why(out));
    assert.equal(read(adopter, "model-mappings/claude.org.yml"), "ORG customised override\n");
  });

  test("bbb excluded ci/org child survives the strict ci orphan cleanup", () => {
    const upstream = makeUpstream(sr, [
      { "ci/capabilities/gate.yml": "upstream CI capability reference" },
    ]);
    const adopter = makeAdopter(sr, {
      upstream,
      manifest: ["ci\tstrict", "ci/org\texcluded"],
      files: {
        "ci/capabilities/gate.yml": "upstream CI capability reference",
        "ci/org/gitlab-ci.custom.yml": "org-owned CI overlay content",
      },
    });
    const out = runSync(sr, adopter);
    assert.equal(out.status, 0, why(out));
    assert.ok(exists(adopter, "ci/org/gitlab-ci.custom.yml"), "excluded child was deleted");
    assert.equal(read(adopter, "ci/org/gitlab-ci.custom.yml"), "org-owned CI overlay content");
    assert.ok(!out.stdout.includes("Removed (upstream-deleted): ci/org"), why(out));
  });
});

describe("G4 phantom entries and strict regressions", () => {
  test("n phantom strict entry warns exactly once and the sibling is synced", () => {
    const upstream = makeUpstream(sr, [
      { "core-file.txt": "upstream content v1" },
      { "core-file.txt": "upstream content v2" },
    ]);
    const adopter = makeAdopter(sr, {
      upstream,
      manifest: ["phantom.txt\tstrict", "core-file.txt\tadopt-on-edit"],
      files: { "core-file.txt": "upstream content v1" },
    });
    const out = runSync(sr, adopter);
    assert.equal(out.status, 0, why(out));
    const warn = "Warning: skipping manifest entry absent from upstream: phantom.txt";
    assert.ok(out.stderr.includes(warn), why(out));
    assert.equal(out.stderr.split("\n").filter((l) => l.includes(warn)).length, 1, why(out));
    assert.equal(read(adopter, "core-file.txt"), "upstream content v2");
  });

  test("o fully resolvable manifest emits no skipping warning", () => {
    const files = { "core-file.txt": "upstream content", "other.txt": "other content" };
    const upstream = makeUpstream(sr, [files]);
    const adopter = makeAdopter(sr, {
      upstream,
      manifest: ["core-file.txt\tstrict", "other.txt\tstrict"],
      files,
    });
    const out = runSync(sr, adopter);
    assert.equal(out.status, 0, why(out));
    assert.ok(!out.stderr.includes("Warning: skipping manifest entry"), why(out));
  });

  test("p bare strict entry behind upstream exits 0 and updates (Bug 1)", () => {
    const upstream = makeUpstream(sr, [
      { "core-file.txt": "upstream v1 content" },
      { "core-file.txt": "upstream v2 content" },
    ]);
    const adopter = makeAdopter(sr, {
      upstream,
      manifest: ["core-file.txt"],
      files: { "core-file.txt": "upstream v1 content" },
    });
    const out = runSync(sr, adopter);
    assert.equal(out.status, 0, why(out));
    assert.equal(read(adopter, "core-file.txt"), "upstream v2 content");
  });

  test("q strict dir: a new upstream file is created (Bug 2)", () => {
    const upstream = makeUpstream(sr, [
      { "specs/0001.md": "spec one content" },
      { "specs/0099-new.md": "new upstream spec" },
    ]);
    const adopter = makeAdopter(sr, {
      upstream,
      manifest: ["specs"],
      files: { "specs/0001.md": "spec one content" },
    });
    const out = runSync(sr, adopter);
    assert.equal(out.status, 0, why(out));
    assert.ok(exists(adopter, "specs/0099-new.md"), why(out));
  });
});
