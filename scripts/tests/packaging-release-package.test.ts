// packaging-release-package.test.ts — the five assertions of the release packager and the archive
// it writes (spec 0257 R9, R10), run through the sandbox's own copy of the entry module so the
// real builder renders. Twin of the cases of the retired Bash suite test-release-package-extension.sh; the gemini
// validation, the argument parsing and the differential run against the shell are in
// packaging-release-package-cli.test.ts.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  baseEnv,
  emptyPath,
  makeSandbox,
  runPackager,
  treeOfArchive,
  treeOfDir,
} from "./lib/release-sandbox.ts";
import { readTarGz } from "./lib/tar-reader.ts";

const NAME = "hello-world";

function run(sandbox: ReturnType<typeof makeSandbox>, version: string, out: string) {
  return runPackager(sandbox, [NAME, "--version", version, "--out", out], baseEnv(emptyPath()));
}

test("packages hello-world at its own version into a single archive without a wrapper", () => {
  const sandbox = makeSandbox();
  const out = path.join(sandbox.root, "release-out");
  const res = run(sandbox, sandbox.version, out);
  assert.equal(res.status, 0, res.stderr);

  const archive = path.join(out, `${NAME}-${sandbox.version}.tar.gz`);
  assert.deepEqual(fs.readdirSync(out), [`${NAME}-${sandbox.version}.tar.gz`]);

  const lines = res.stdout.split("\n");
  assert.ok(lines.includes(`Packaged: ${archive}`), res.stdout);
  assert.ok(lines.includes(`  Version: ${sandbox.version}`));
  assert.ok(
    lines.includes(
      `  Archive root: build/extensions/${NAME}'s CONTENTS, no wrapper directory (byte-for-byte — Ruling A, single-tool; see the R20 probe runbook for why no wrapper)`,
    ),
  );
  assert.ok(
    lines.includes(
      "  gemini CLI not on PATH — skipping the best-effort 'gemini extensions validate' check.",
    ),
  );

  const paths = readTarGz(archive).map((record) => record.path);
  assert.equal(paths[0], "./");
  assert.ok(paths.every((p) => p.startsWith("./")));
  assert.ok(paths.includes("./gemini-extension.json"));
  assert.ok(!paths.some((p) => p.startsWith(`./${NAME}/`) || p.startsWith(`${NAME}/`)));

  // What extracting the archive would produce is the fresh build tree, entry for entry.
  assert.deepEqual(treeOfArchive(archive), treeOfDir(sandbox.resolve(`build/extensions/${NAME}`)));
});

test("a version mismatch fails naming both versions and writes no archive", () => {
  const sandbox = makeSandbox();
  const out = path.join(sandbox.root, "release-out");
  const res = run(sandbox, "9.9.9", out);
  assert.equal(res.status, 1);
  const built = path.join(sandbox.root, "build", "extensions", NAME, "gemini-extension.json");
  assert.ok(
    res.stderr.includes(
      `Error: ${built} declares version '${sandbox.version}', which does not equal the requested release version '9.9.9' (spec 0183 R22).`,
    ),
    res.stderr,
  );
  assert.equal(fs.existsSync(out), false);
});

test("refuses an output directory that already holds a file and leaves it intact", () => {
  const sandbox = makeSandbox();
  const out = path.join(sandbox.root, "release-out");
  fs.mkdirSync(out);
  const stray = path.join(out, "stray-checksums.txt");
  fs.writeFileSync(stray, "keep me");
  const res = run(sandbox, sandbox.version, out);
  assert.equal(res.status, 1);
  assert.ok(
    res.stderr.includes(
      `Error: ${out} already carries 1 file(s) — a release publishes exactly ONE asset`,
    ),
  );
  assert.ok(res.stderr.includes(`Clear ${out} before packaging.`));
  assert.deepEqual(fs.readdirSync(out), ["stray-checksums.txt"]);
  assert.equal(fs.readFileSync(stray, "utf8"), "keep me");
});

test("a subdirectory of the output directory is not an asset", () => {
  const sandbox = makeSandbox();
  const out = path.join(sandbox.root, "release-out");
  fs.mkdirSync(path.join(out, "nested"), { recursive: true });
  const res = run(sandbox, sandbox.version, out);
  assert.equal(res.status, 0, res.stderr);
  assert.ok(fs.existsSync(path.join(out, `${NAME}-${sandbox.version}.tar.gz`)));
});

test("a .releaserc.json in the extension source never reaches the archive (spec 0235)", () => {
  const sandbox = makeSandbox();
  sandbox.write(
    `extensions/core/${NAME}/.releaserc.json`,
    '{"extends": "semantic-release-monorepo", "branches": ["main"]}\n',
  );
  const out = path.join(sandbox.root, "release-out");
  const res = run(sandbox, sandbox.version, out);
  assert.equal(res.status, 0, res.stderr);
  const paths = readTarGz(path.join(out, `${NAME}-${sandbox.version}.tar.gz`)).map((r) => r.path);
  assert.ok(!paths.some((p) => p.endsWith(".releaserc.json")), paths.join("\n"));
});

/** What a workspace install leaves in an extension directory, plus a built `dist/`. */
function pollute(sandbox: ReturnType<typeof makeSandbox>): void {
  const base = `extensions/core/${NAME}`;
  sandbox.write(`${base}/node_modules/some-package/index.js`, "host package\n");
  sandbox.write(`${base}/node_modules/.bin/tool`, "#!/bin/sh\n");
  sandbox.write(`${base}/tools/node_modules/other/index.js`, "nested host package\n");
  sandbox.write(`${base}/dist/index.js`, "built\n");
}

test("an untracked node_modules reaches neither the build tree nor the archive (spec 0257 R33)", () => {
  const sandbox = makeSandbox();
  pollute(sandbox);
  const out = path.join(sandbox.root, "release-out");
  const res = run(sandbox, sandbox.version, out);
  assert.equal(res.status, 0, res.stderr);
  const archive = treeOfArchive(path.join(out, `${NAME}-${sandbox.version}.tar.gz`));
  const built = treeOfDir(sandbox.resolve(`build/extensions/${NAME}`));
  for (const tree of [archive, built]) {
    const bad = Object.keys(tree).filter((p) => p.split("/").includes("node_modules"));
    assert.deepEqual(bad, []);
    assert.ok("dist/index.js" in tree, "the declared dist/ still travels");
  }
});

test("the archive does not depend on the install state of the machine (spec 0257 R33)", () => {
  const clean = makeSandbox();
  clean.write(`extensions/core/${NAME}/dist/index.js`, "built\n");
  clean.write(`extensions/core/${NAME}/tools/lib.js`, "lib\n");
  const dirty = makeSandbox();
  pollute(dirty);
  dirty.write(`extensions/core/${NAME}/tools/lib.js`, "lib\n");
  const outA = path.join(clean.root, "release-a");
  const outB = path.join(dirty.root, "release-b");
  assert.equal(run(clean, clean.version, outA).status, 0);
  assert.equal(run(dirty, dirty.version, outB).status, 0);
  const file = `${NAME}-${clean.version}.tar.gz`;
  assert.deepEqual(treeOfArchive(path.join(outB, file)), treeOfArchive(path.join(outA, file)));
});

test("a builder that fails refuses the release", () => {
  const sandbox = makeSandbox();
  sandbox.write("scripts/build-extension.ts", "process.exitCode = 1;\n");
  const out = path.join(sandbox.root, "release-out");
  const res = run(sandbox, sandbox.version, out);
  assert.equal(res.status, 1);
  assert.ok(
    res.stderr.includes(
      `Error: a fresh --target gemini render failed for '${NAME}' — refusing to publish a release artifact for a tree that does not build.`,
    ),
    res.stderr,
  );
  assert.equal(fs.existsSync(out), false);
});

test("a source-only tree without a rendered gemini-extension.json is refused", () => {
  const sandbox = makeSandbox();
  sandbox.write(
    "scripts/build-extension.ts",
    [
      'const fs = require("node:fs");',
      'const path = require("node:path");',
      'const root = path.resolve(__dirname, "..");',
      "const name = process.argv[4];",
      'fs.cpSync(path.join(root, "extensions", "core", name), path.join(root, "build", "extensions", name), { recursive: true });',
      "",
    ].join("\n"),
  );
  const res = run(sandbox, sandbox.version, path.join(sandbox.root, "release-out"));
  assert.equal(res.status, 1);
  const built = path.join(sandbox.root, "build", "extensions", NAME);
  assert.ok(
    res.stderr.includes(
      `Error: ${built} carries no gemini-extension.json at its root — a source-only tree is not a publishable release artifact (spec 0183 R17).`,
    ),
    res.stderr,
  );
});

test("an old-shape extension.json is refused before any render", () => {
  const sandbox = makeSandbox();
  const file = `extensions/core/${NAME}/extension.json`;
  const manifest = JSON.parse(sandbox.read(file)) as Record<string, unknown>;
  manifest.components = { skills: { enabled: true } };
  sandbox.write(file, `${JSON.stringify(manifest, null, 2)}\n`);
  const res = run(sandbox, sandbox.version, path.join(sandbox.root, "release-out"));
  assert.equal(res.status, 1);
  assert.ok(res.stderr.includes("VALIDATION-ERROR: "), res.stderr);
  assert.ok(res.stderr.includes("declares the retired 'components' object"), res.stderr);
  assert.equal(fs.existsSync(path.join(sandbox.root, "build")), false);
});

test("an extension directory without extension.json is refused", () => {
  const sandbox = makeSandbox();
  fs.mkdirSync(sandbox.resolve("extensions/org/bare"));
  const res = runPackager(
    sandbox,
    ["bare", "--version", "1.0.0", "--out", "o"],
    baseEnv(emptyPath()),
  );
  assert.equal(res.status, 1);
  assert.ok(
    res.stderr.includes(
      `Error: no extension.json found in ${sandbox.root}/extensions/org/bare — run scripts/migrate-extension.sh if this is an old-shape extension.`,
    ),
    res.stderr,
  );
});

test("an unknown extension and a name present in two tiers are refused", () => {
  const sandbox = makeSandbox();
  const missing = runPackager(
    sandbox,
    ["nope", "--version", "1.0.0", "--out", "o"],
    baseEnv(emptyPath()),
  );
  assert.equal(missing.status, 1);
  assert.equal(missing.stderr, "Error: extension 'nope' not found in extensions/.\n");

  fs.cpSync(
    sandbox.resolve(`extensions/core/${NAME}`),
    sandbox.resolve(`extensions/library/${NAME}`),
    { recursive: true },
  );
  const twice = run(sandbox, sandbox.version, path.join(sandbox.root, "release-out"));
  assert.equal(twice.status, 1);
  assert.equal(
    twice.stderr,
    `Error: extension '${NAME}' exists in multiple tiers; names must be unique.\n`,
  );
});
