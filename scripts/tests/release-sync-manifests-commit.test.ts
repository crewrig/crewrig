// release-sync-manifests-commit.test.ts — the release commit stages the two manifests and the
// changelog only; a skill or agent carrying an old carrier stays unrewritten and unstaged
// (spec 0316 R17: the source carriers are retired). Loads the real @semantic-release/git, a devDependency, so the CI job that
// runs it installs with `install: ci`.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { gitLeg } from "../lib/monorepo-release/releaserc-legs.ts";
import type { ReleasercInput } from "../lib/monorepo-release/releaserc-types.ts";
import { syncManifests } from "../lib/packaging/sync-manifests.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..");

const prepare = createRequire(path.join(REPO, "noop.js"))(
  "@semantic-release/git/lib/prepare.js",
) as (config: Record<string, unknown>, context: Record<string, unknown>) => Promise<void>;

const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.invalid",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.invalid",
  GIT_CONFIG_GLOBAL: os.devNull,
  GIT_CONFIG_NOSYSTEM: "1",
};

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", args, { cwd, env: ENV, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

const carrier = (version: string): string =>
  `---\nname: x\n---\n<!-- crewrig-provenance: extension="hello" version="${version}" canonical="u" feedback="u" -->\n`;

test("gitLeg assets cover the manifests and the changelog", () => {
  const [, options] = gitLeg({ ext: "hello", mode: "publish" } as unknown as ReleasercInput);
  assert.deepEqual((options as { assets: string[] }).assets, [
    "package.json",
    "extension.json",
    "CHANGELOG.md",
  ]);
});

test("the release commit holds the two manifests only", async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "git-leg-assets-")));
  try {
    const remote = path.join(root, "remote.git");
    const work = path.join(root, "work");
    fs.mkdirSync(remote);
    git(remote, "init", "-q", "--bare", "-b", "main");
    fs.mkdirSync(work);
    git(work, "init", "-q", "-b", "main");
    const ext = path.join(work, "extensions", "core", "hello");
    fs.mkdirSync(path.join(ext, "skills", "s"), { recursive: true });
    fs.mkdirSync(path.join(ext, "agents", "a"), { recursive: true });
    fs.writeFileSync(
      path.join(ext, "package.json"),
      '{"name":"hello-extension","version":"1.0.0"}\n',
    );
    fs.writeFileSync(path.join(ext, "extension.json"), '{"name":"hello","version":"1.0.0"}\n');
    fs.writeFileSync(path.join(ext, "skills", "s", "SKILL.md"), carrier("1.0.0"));
    fs.writeFileSync(path.join(ext, "agents", "a", "AGENT.md"), carrier("1.0.0"));
    fs.writeFileSync(path.join(ext, "notes.txt"), "unrelated\n");
    git(work, "add", "-A");
    git(work, "commit", "-q", "-m", "init");
    git(work, "remote", "add", "origin", remote);
    git(work, "push", "-q", "origin", "main");

    syncManifests(ext, "1.1.0");
    fs.writeFileSync(path.join(ext, "notes.txt"), "changed but not an asset\n");
    const [, options] = gitLeg({ ext: "hello", mode: "publish" } as unknown as ReleasercInput);
    const noop = { log: () => undefined };
    await prepare(options as Record<string, unknown>, {
      env: ENV,
      cwd: ext,
      branch: { name: "main" },
      options: { repositoryUrl: remote },
      lastRelease: {},
      nextRelease: { version: "1.1.0", gitTag: "hello-v1.1.0", notes: "n" },
      logger: noop,
    });

    const files = git(work, "show", "--name-only", "--pretty=format:", "HEAD")
      .split("\n")
      .filter((l) => l !== "")
      .sort();
    assert.deepEqual(files, [
      "extensions/core/hello/extension.json",
      "extensions/core/hello/package.json",
    ]);
    for (const rel of ["skills/s/SKILL.md", "agents/a/AGENT.md"]) {
      assert.equal(
        fs.readFileSync(path.join(ext, rel), "utf8"),
        carrier("1.0.0"),
        `${rel} untouched`,
      );
    }
    assert.equal(git(work, "status", "--porcelain", "--", "extensions/core/hello/skills"), "");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
