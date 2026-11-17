// sync-from-upstream-orphans.test.ts — orphan cleanup, regenerable restore and org carve-outs of
// scripts/sync-from-upstream.ts (spec 0260; replaces cases r, s, z, aa, bb, qq, rr, ss, uu, ww,
// xx, yy, zz, aaa of test-sync-from-upstream.sh).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { after, before, describe, test } from "node:test";
import { requireOrSkip } from "./lib/capability.ts";
import {
  REPO_ROOT,
  commitFiles,
  createSyncRoot,
  exists,
  git,
  makeAdopter,
  makeUpstream,
  read,
  runSync,
  treeOf,
  why,
  writeFile,
  type SyncRoot,
} from "./lib/sync-fixture.ts";

let sr: SyncRoot;
before(() => {
  sr = createSyncRoot("crewrig-sync-orph-");
});
after(() => sr.dispose());

const removed = (p: string): string => `Removed (upstream-deleted): ${p}`;
const restored = (p: string): string => `Restored (diverged, regenerable): ${p}`;

/** Upstream whose last commit deletes `gone` (a path or directory) from the first commit's files. */
function upstreamDeleting(files: Record<string, string>, gone: string): string {
  const upstream = makeUpstream(sr, [files]);
  git(sr, upstream, "rm", "-q", "-r", gone);
  git(sr, upstream, "commit", "-q", "-m", `remove ${gone}`);
  return upstream;
}

describe("strict directory orphans", () => {
  test("r upstream-deleted orphan removed, reported on stdout, active file kept", () => {
    const files = {
      "scripts/old-file.sh": "old content",
      "scripts/active-file.sh": "active content",
    };
    const upstream = upstreamDeleting(files, "scripts/old-file.sh");
    const adopter = makeAdopter(sr, { upstream, manifest: ["scripts"], files });
    const out = runSync(sr, adopter);
    assert.equal(out.status, 0, why(out));
    assert.ok(!exists(adopter, "scripts/old-file.sh"), "orphan still present");
    assert.ok(out.stdout.includes(removed("scripts/old-file.sh")), why(out));
    assert.ok(exists(adopter, "scripts/active-file.sh"), "active file removed");
  });

  test("s excluded child of a strict directory is not removed", () => {
    const upstream = makeUpstream(sr, [{ "specs/0001.md": "spec content" }]);
    const adopter = makeAdopter(sr, {
      upstream,
      manifest: ["specs", "specs/org\texcluded"],
      files: { "specs/0001.md": "spec content", "specs/org/custom.md": "org content" },
    });
    const out = runSync(sr, adopter);
    assert.equal(out.status, 0, why(out));
    assert.ok(exists(adopter, "specs/org/custom.md"), "excluded child deleted");
    assert.ok(!out.stdout.includes(removed("specs/org")), why(out));
  });
});

describe("copilot settings carve-out", () => {
  const files = {
    ".github/copilot/settings.json": '{"hooks": {}}',
    ".github/copilot/extension.json": '{"name": "upstream-ext"}',
  };
  const manifest = [".github/copilot", ".github/copilot/settings.json\texcluded"];
  const setup = (): string =>
    makeAdopter(sr, { upstream: makeUpstream(sr, [files]), manifest, files });

  test("z mutated excluded settings.json does not abort and is kept", () => {
    const adopter = setup();
    const mutated =
      '{"hooks": {"sessionStart": [{"type": "command", "command": "/Users/agent/.claude/hooks/transcript-hook.sh"}]}}';
    writeFile(adopter, ".github/copilot/settings.json", mutated);
    const out = runSync(sr, adopter);
    assert.equal(out.status, 0, why(out));
    assert.equal(read(adopter, ".github/copilot/settings.json"), mutated);
    assert.equal(read(adopter, ".github/copilot/extension.json"), '{"name": "upstream-ext"}');
  });

  test("aa mutated extension.json still aborts, names .github/copilot, edit kept", () => {
    const adopter = setup();
    writeFile(adopter, ".github/copilot/extension.json", '{"name": "locally-edited-ext"}');
    const out = runSync(sr, adopter);
    assert.equal(out.status, 1, why(out));
    assert.ok(out.stderr.includes(".github/copilot"), why(out));
    assert.equal(read(adopter, ".github/copilot/extension.json"), '{"name": "locally-edited-ext"}');
  });

  test("bb real .gitignore ignores settings.json.bak.<stamp> but not extension.json", (t) => {
    const inside = spawnSync("git", ["-C", REPO_ROOT, "rev-parse", "--is-inside-work-tree"], {
      encoding: "utf8",
    });
    const isCheckout = inside.status === 0 && inside.stdout.trim() === "true";
    if (!requireOrSkip(t, isCheckout, "not a git checkout: .gitignore cannot be queried")) return;
    const ignored = (p: string): number | null =>
      spawnSync("git", ["-C", REPO_ROOT, "check-ignore", "-q", p]).status;
    assert.equal(
      ignored(".github/copilot/settings.json.bak.20260723-203351"),
      0,
      "bak not ignored",
    );
    assert.equal(ignored(".github/copilot/extension.json"), 1, "pattern too wide");
  });
});

describe("regenerable entries", () => {
  test("qq diverged regenerable member is restored and reported", () => {
    const files = { ".claude/agents/dev.md": "upstream agent content" };
    const adopter = makeAdopter(sr, {
      upstream: makeUpstream(sr, [files]),
      manifest: [".claude/agents\tregenerable"],
      files,
    });
    writeFile(adopter, ".claude/agents/dev.md", "regenerated content\n");
    const out = runSync(sr, adopter);
    assert.equal(out.status, 0, why(out));
    assert.equal(read(adopter, ".claude/agents/dev.md"), "upstream agent content");
    assert.ok(out.stdout.includes(restored(".claude/agents/dev.md")), why(out));
  });

  test("rr diverged member under a strict skills entry still aborts", () => {
    const files = { ".claude/skills/dev/SKILL.md": "upstream skill content" };
    const adopter = makeAdopter(sr, {
      upstream: makeUpstream(sr, [files]),
      manifest: [".claude/skills\tstrict"],
      files,
    });
    writeFile(adopter, ".claude/skills/dev/SKILL.md", "hand-edited skill\n");
    const out = runSync(sr, adopter);
    assert.equal(out.status, 1, why(out));
    assert.ok(out.stderr.includes(".claude/skills/dev/SKILL.md"), why(out));
  });

  test("ss strict vs regenerable without divergence: identical trees and streams", () => {
    const upstream = makeUpstream(sr, [
      { ".claude/agents/dev.md": "upstream agent v1", "other.txt": "other content" },
      { ".claude/agents/dev.md": "upstream agent v2" },
    ]);
    const files = { ".claude/agents/dev.md": "upstream agent v1", "other.txt": "other content" };
    const run = (policy: string): { out: ReturnType<typeof runSync>; dir: string } => {
      const dir = makeAdopter(sr, {
        upstream,
        manifest: [`.claude/agents\t${policy}`, "other.txt\tstrict"],
        files,
      });
      return { out: runSync(sr, dir), dir };
    };
    const strict = run("strict");
    const regen = run("regenerable");
    assert.equal(strict.out.status, 0, why(strict.out));
    assert.equal(regen.out.status, 0, why(regen.out));
    assert.deepEqual(treeOf(`${strict.dir}/.claude`), treeOf(`${regen.dir}/.claude`));
    assert.equal(read(strict.dir, "other.txt"), read(regen.dir, "other.txt"));
    // The adopter paths differ; neither stream may embed them for the comparison to be exact.
    const norm = (s: string, dir: string): string => s.replaceAll(dir, "<adopter>");
    assert.equal(norm(strict.out.stdout, strict.dir), norm(regen.out.stdout, regen.dir), "stdout");
    assert.equal(norm(strict.out.stderr, strict.dir), norm(regen.out.stderr, regen.dir), "stderr");
  });

  test("uu orphan cleanup still runs under regenerable, active member kept", () => {
    const files = {
      ".claude/agents/active/AGENT.md": "active content",
      ".claude/agents/old/AGENT.md": "old content",
    };
    const upstream = upstreamDeleting(files, ".claude/agents/old");
    const adopter = makeAdopter(sr, { upstream, manifest: [".claude/agents\tregenerable"], files });
    const out = runSync(sr, adopter);
    assert.equal(out.status, 0, why(out));
    assert.ok(!exists(adopter, ".claude/agents/old/AGENT.md"), "orphan not removed");
    assert.ok(out.stdout.includes(removed(".claude/agents/old/AGENT.md")), why(out));
    assert.ok(exists(adopter, ".claude/agents/active/AGENT.md"), "active removed");
  });

  test("ww retired nested agent removed, dev.md restored, diverged tester.md restored", () => {
    const upstream = makeUpstream(sr, [
      {
        ".claude/agents/dev.md": "upstream dev content",
        ".claude/agents/tester.md": "upstream tester content",
      },
    ]);
    const adopter = makeAdopter(sr, {
      upstream,
      manifest: [".claude/agents\tregenerable"],
      files: {
        ".claude/agents/dev/AGENT.md": "retired nested dev content",
        ".claude/agents/tester.md": "upstream tester content",
      },
    });
    writeFile(adopter, ".claude/agents/tester.md", "locally diverged tester content\n");
    const out = runSync(sr, adopter);
    assert.equal(out.status, 0, why(out));
    assert.equal(read(adopter, ".claude/agents/dev.md"), "upstream dev content");
    assert.ok(!exists(adopter, ".claude/agents/dev/AGENT.md"), "retired nested not removed");
    assert.ok(out.stdout.includes(removed(".claude/agents/dev/AGENT.md")), why(out));
    assert.equal(read(adopter, ".claude/agents/tester.md"), "upstream tester content");
    assert.ok(out.stdout.includes(restored(".claude/agents/tester.md")), why(out));
  });

  test("fork directory form removed, flat file present (.agents/agents, spec 0053 delta-01 R21)", () => {
    const upstream = makeUpstream(sr, [
      { ".agents/agents/developer.md": "upstream flat developer content" },
    ]);
    const adopter = makeAdopter(sr, {
      upstream,
      manifest: [".agents/agents\tregenerable"],
      files: { ".agents/agents/developer/AGENT.md": "retired nested developer content" },
    });
    const out = runSync(sr, adopter);
    assert.equal(out.status, 0, why(out));
    assert.equal(read(adopter, ".agents/agents/developer.md"), "upstream flat developer content");
    assert.ok(!exists(adopter, ".agents/agents/developer/AGENT.md"), "retired nested not removed");
    assert.ok(out.stdout.includes(removed(".agents/agents/developer/AGENT.md")), why(out));
  });
});

describe("organization-owned compiled outputs", () => {
  test("xx org skill (source + compiled) and core skill kept, no Removed line", () => {
    const upstream = makeUpstream(sr, [
      { ".claude/skills/developer/SKILL.md": "upstream developer skill content" },
    ]);
    const adopter = makeAdopter(sr, {
      upstream,
      manifest: [".claude/skills\tstrict"],
      files: {
        ".claude/skills/developer/SKILL.md": "upstream developer skill content",
        "artifacts/org/skills/org-helper/SKILL.md": "org helper source",
        ".claude/skills/org-helper/SKILL.md": "org helper compiled output",
      },
    });
    const out = runSync(sr, adopter);
    assert.equal(out.status, 0, why(out));
    assert.ok(exists(adopter, ".claude/skills/org-helper/SKILL.md"), "org skill removed");
    assert.ok(!out.stdout.includes(removed(".claude/skills/org-helper/SKILL.md")), why(out));
    assert.ok(exists(adopter, ".claude/skills/developer/SKILL.md"), "core skill removed");
  });

  test("yy org command (source + compiled) kept, no Removed line", () => {
    const upstream = makeUpstream(sr, [
      { ".gemini/commands/core-cmd.toml": "upstream core command" },
    ]);
    const adopter = makeAdopter(sr, {
      upstream,
      manifest: [".gemini/commands\tstrict"],
      files: {
        ".gemini/commands/core-cmd.toml": "upstream core command",
        "artifacts/org/commands/org-cmd.md": "org command source",
        ".gemini/commands/org-cmd.toml": "org command compiled output",
      },
    });
    const out = runSync(sr, adopter);
    assert.equal(out.status, 0, why(out));
    assert.ok(exists(adopter, ".gemini/commands/org-cmd.toml"), "org command removed");
    assert.ok(!out.stdout.includes(removed(".gemini/commands/org-cmd.toml")), why(out));
  });

  test("zz upstream-deleted core skill removed and reported", () => {
    const files = {
      ".claude/skills/active-core/SKILL.md": "active core content",
      ".claude/skills/retired-core/SKILL.md": "retired core content",
    };
    const upstream = upstreamDeleting(files, ".claude/skills/retired-core");
    const adopter = makeAdopter(sr, { upstream, manifest: [".claude/skills\tstrict"], files });
    const out = runSync(sr, adopter);
    assert.equal(out.status, 0, why(out));
    assert.ok(!exists(adopter, ".claude/skills/retired-core/SKILL.md"), "core skill not removed");
    assert.ok(out.stdout.includes(removed(".claude/skills/retired-core/SKILL.md")), why(out));
    assert.ok(exists(adopter, ".claude/skills/active-core/SKILL.md"), "active removed");
  });

  test("aaa compiled skill with no org source is removed and reported", () => {
    const upstream = makeUpstream(sr, [
      { ".claude/skills/active-core/SKILL.md": "active core content" },
    ]);
    const adopter = makeAdopter(sr, {
      upstream,
      manifest: [".claude/skills\tstrict"],
      files: {
        ".claude/skills/active-core/SKILL.md": "active core content",
        ".claude/skills/retired-org/SKILL.md": "stale compiled output with no source",
      },
    });
    const out = runSync(sr, adopter);
    assert.equal(out.status, 0, why(out));
    assert.ok(!exists(adopter, ".claude/skills/retired-org/SKILL.md"), "retired org skill kept");
    assert.ok(out.stdout.includes(removed(".claude/skills/retired-org/SKILL.md")), why(out));
  });
});
