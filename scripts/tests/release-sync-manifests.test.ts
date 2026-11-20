// release-sync-manifests.test.ts — the manifest synchronisation helper and its command
// (spec 0257 R16, D2). The jq comparison runs the real `jq` when it is on the PATH.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { Io } from "../lib/extension/types.ts";
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
