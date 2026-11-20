// release-sync-manifests.test.ts — the manifest synchronisation helper and its command
// (spec 0257 R16, D2). The jq comparison runs the real `jq` when it is on the PATH.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { Io } from "../lib/extension/types.ts";
import { gitLeg } from "../lib/monorepo-release/releaserc-legs.ts";
import type { ReleasercInput } from "../lib/monorepo-release/releaserc-types.ts";
import { main } from "../lib/packaging/sync-manifests-main.ts";
import { syncManifests } from "../lib/packaging/sync-manifests.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..");

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sync-manifests-"));
}

function read(dir: string, name: string): string {
  return fs.readFileSync(path.join(dir, name), "utf8");
}

function capture(): { io: Io; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      out: (line) => out.push(line),
      err: (line) => err.push(line),
      errRaw: (text) => err.push(text),
    },
  };
}

test("rewrites with two-space indentation, a final LF and the key order kept", () => {
  const dir = tmpDir();
  fs.writeFileSync(
    path.join(dir, "package.json"),
    '{"name":"x","version":"1.0.0","scripts":{"b":"1","a":"2"}}',
  );
  const done = syncManifests(dir, "2.3.4");
  assert.deepEqual(done, [path.join(dir, "package.json")]);
  assert.equal(
    read(dir, "package.json"),
    '{\n  "name": "x",\n  "version": "2.3.4",\n  "scripts": {\n    "b": "1",\n    "a": "2"\n  }\n}\n',
  );
});

test("adds the version at the end when it is missing", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "extension.json"), '{"name":"x"}\n');
  syncManifests(dir, "0.0.1");
  assert.equal(read(dir, "extension.json"), '{\n  "name": "x",\n  "version": "0.0.1"\n}\n');
});

test("rewrites both manifests", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "package.json"), '{"version":"1.0.0"}');
  fs.writeFileSync(path.join(dir, "extension.json"), '{"version":"1.0.0"}');
  const done = syncManifests(dir, "1.1.0");
  assert.deepEqual(done, [path.join(dir, "package.json"), path.join(dir, "extension.json")]);
  for (const name of ["package.json", "extension.json"]) {
    assert.deepEqual(JSON.parse(read(dir, name)), { version: "1.1.0" });
  }
});

test("succeeds with only package.json present", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "package.json"), '{"version":"1.0.0"}');
  assert.equal(syncManifests(dir, "1.1.0").length, 1);
  assert.equal(fs.existsSync(path.join(dir, "extension.json")), false);
});

test("succeeds silently when no manifest exists", () => {
  const dir = tmpDir();
  assert.deepEqual(syncManifests(dir, "1.1.0"), []);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test("invalid JSON fails naming the file and leaves it untouched", () => {
  const dir = tmpDir();
  const broken = "{ not json";
  fs.writeFileSync(path.join(dir, "extension.json"), broken);
  fs.writeFileSync(path.join(dir, "package.json"), '{"version":"1.0.0"}');
  assert.throws(() => syncManifests(dir, "2.0.0"), /extension\.json/);
  assert.equal(read(dir, "extension.json"), broken);
  // The sibling is not half-synced either: every manifest is parsed before the first write.
  assert.equal(read(dir, "package.json"), '{"version":"1.0.0"}');
  assert.deepEqual(fs.readdirSync(dir).sort(), ["extension.json", "package.json"]);
});

test("a manifest that is not a JSON object fails naming the file", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "package.json"), "[1]");
  assert.throws(() => syncManifests(dir, "2.0.0"), /package\.json/);
  assert.equal(read(dir, "package.json"), "[1]");
});

test("CRLF input is accepted and written back as LF", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "package.json"), '{\r\n  "version": "1.0.0"\r\n}\r\n');
  syncManifests(dir, "1.0.1");
  const text = read(dir, "package.json");
  assert.equal(text, '{\n  "version": "1.0.1"\n}\n');
  assert.equal(text.includes("\r"), false);
});

test("main: one version rewrites the manifests of cwd and exits 0", async () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "package.json"), '{"version":"1.0.0"}');
  const cap = capture();
  assert.equal(await main({ argv: ["3.0.0"], cwd: dir, io: cap.io }), 0);
  assert.deepEqual(JSON.parse(read(dir, "package.json")), { version: "3.0.0" });
  assert.deepEqual([cap.out, cap.err], [[], []]);
});

test("main: a directory without manifest succeeds silently", async () => {
  const cap = capture();
  assert.equal(await main({ argv: ["3.0.0"], cwd: tmpDir(), io: cap.io }), 0);
  assert.deepEqual([cap.out, cap.err], [[], []]);
});

test("main: missing, extra and empty versions print the usage and exit 1", async () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "package.json"), '{"version":"1.0.0"}');
  for (const argv of [[], [""], ["1.0.0", "2.0.0"]]) {
    const cap = capture();
    assert.equal(await main({ argv, cwd: dir, io: cap.io }), 1);
    assert.deepEqual(cap.err, ["Usage: release-sync-manifests <version>"]);
  }
  assert.equal(read(dir, "package.json"), '{"version":"1.0.0"}');
});

test("main: a failing rewrite prints Error: <message> naming the file and exits 1", async () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "package.json"), "oops");
  const cap = capture();
  assert.equal(await main({ argv: ["1.0.0"], cwd: dir, io: cap.io }), 1);
  assert.equal(cap.err.length, 1);
  assert.match(cap.err[0] ?? "", /^Error: .*package\.json/);
});

function realManifests(): string[] {
  const res = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: REPO,
    encoding: "utf8",
  });
  assert.equal(res.status, 0, res.stderr);
  return res.stdout
    .split("\n")
    .filter((rel) =>
      /^(extensions|extension-skeleton)\/.*(^|\/)(package|extension)\.json$/.test(rel),
    )
    .map((rel) => path.join(REPO, rel));
}

const JQ = spawnSync("jq", ["--version"], { encoding: "utf8" });
const manifests = realManifests();

test(
  `jq and the helper agree on ${manifests.length} real manifest(s)`,
  { skip: JQ.status === 0 ? false : "jq is not available" },
  () => {
    assert.ok(manifests.length > 0, "no real manifest found: the comparison would be vacuous");
    const scratch = tmpDir();
    for (const file of manifests) {
      const rel = path.relative(REPO, file);
      const name = path.basename(file);
      const dir = path.join(scratch, rel.replaceAll(path.sep, "_"));
      fs.mkdirSync(dir);
      fs.copyFileSync(file, path.join(dir, name));
      const jq = spawnSync("jq", ["--arg", "v", "9.8.7-test.1", ".version=$v", file], {
        encoding: "utf8",
      });
      assert.equal(jq.status, 0, `${rel}: ${jq.stderr}`);
      syncManifests(dir, "9.8.7-test.1");
      assert.equal(read(dir, name), jq.stdout, `${rel} differs from jq output`);
    }
  },
);

test("a manifest keeps the permission bits it had", { skip: process.platform === "win32" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-mode-"));
  try {
    for (const [name, mode] of [
      ["package.json", 0o644],
      ["extension.json", 0o664],
    ] as const) {
      fs.writeFileSync(path.join(dir, name), '{"version":"1.0.0"}\n');
      fs.chmodSync(path.join(dir, name), mode);
    }
    syncManifests(dir, "1.2.3");
    assert.equal(fs.statSync(path.join(dir, "package.json")).mode & 0o777, 0o644);
    assert.equal(fs.statSync(path.join(dir, "extension.json")).mode & 0o777, 0o664);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Spec 0312 R6/R12 (issue #2075): the release step rewrites the carrier `version` of every
// skill and agent of the extension along with both manifests.
const carrierText = (version: string): string =>
  `---\nname: x\n---\n<!-- crewrig-provenance: extension="hello" version="${version}" canonical="https://github.com/crewrig/crewrig" feedback="https://github.com/crewrig/crewrig" -->\n\n# body version="9.9.9"\n`;

function extensionWithCarriers(dir: string): void {
  fs.writeFileSync(
    path.join(dir, "package.json"),
    '{"name":"hello-extension","version":"1.0.0"}\n',
  );
  fs.writeFileSync(path.join(dir, "extension.json"), '{"name":"hello","version":"1.0.0"}\n');
  for (const [rel, file] of [
    ["skills/s1", "SKILL.md"],
    ["skills/s2", "SKILL.md"],
    ["agents/a1", "AGENT.md"],
  ] as const) {
    fs.mkdirSync(path.join(dir, rel), { recursive: true });
    fs.writeFileSync(path.join(dir, rel, file), carrierText("1.0.0"));
  }
}

test("an extension with carriers: every skill and agent carrier ends at the new version", () => {
  const dir = tmpDir();
  extensionWithCarriers(dir);
  syncManifests(dir, "2.5.0");
  for (const rel of ["skills/s1/SKILL.md", "skills/s2/SKILL.md", "agents/a1/AGENT.md"]) {
    // only the carrier's version moves; the other fields and the body stay byte for byte
    assert.equal(read(dir, rel), carrierText("2.5.0"), rel);
  }
  assert.match(read(dir, "package.json"), /"version": "2.5.0"/);
  assert.match(read(dir, "extension.json"), /"version": "2.5.0"/);
});

test("an extension without carriers: the output is byte-identical to the manifests-only run", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "package.json"), '{"name":"x","version":"1.0.0"}\n');
  fs.mkdirSync(path.join(dir, "skills", "s"), { recursive: true });
  const plain = "---\nname: x\n---\n\n# no carrier\n";
  fs.writeFileSync(path.join(dir, "skills", "s", "SKILL.md"), plain);
  const done = syncManifests(dir, "2.5.0");
  assert.deepEqual(done, [path.join(dir, "package.json")]);
  assert.equal(read(dir, "package.json"), '{\n  "name": "x",\n  "version": "2.5.0"\n}\n');
  assert.equal(read(dir, "skills/s/SKILL.md"), plain);
});

test("a failing manifest parse leaves every carrier untouched", () => {
  const dir = tmpDir();
  extensionWithCarriers(dir);
  fs.writeFileSync(path.join(dir, "extension.json"), "{not json");
  assert.throws(() => syncManifests(dir, "2.5.0"), /extension\.json/);
  assert.equal(read(dir, "skills/s1/SKILL.md"), carrierText("1.0.0"));
});

// Spec 0312 R6: the release commit stages the carriers (real @semantic-release/git prepare).
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

test("gitLeg assets cover the manifests, the changelog and every carrier", () => {
  const [, options] = gitLeg({ ext: "hello", mode: "publish" } as unknown as ReleasercInput);
  assert.deepEqual((options as { assets: string[] }).assets, [
    "package.json",
    "extension.json",
    "CHANGELOG.md",
    "skills/*/SKILL.md",
    "agents/*/AGENT.md",
  ]);
});

test("the release commit holds exactly the manifests and the carriers it rewrote", async () => {
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
      "extensions/core/hello/agents/a/AGENT.md",
      "extensions/core/hello/extension.json",
      "extensions/core/hello/package.json",
      "extensions/core/hello/skills/s/SKILL.md",
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
