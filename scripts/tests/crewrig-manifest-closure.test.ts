// crewrig-manifest-closure.test.ts — the manifest closure of the framework entry point (spec 0314 R6
// and R18): `init` run from an archive built from scripts/lib/framework-release/manifest.txt alone must
// find every file it loads. The archive is extracted with the independent reader of the tests, into a
// directory with no node_modules and nothing else of the checkout above it, so a file the manifest
// forgets is a failure here and not on a user's machine. Each file of the closure is then removed in
// turn, to show the test bites.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { before, describe, test } from "node:test";
import { parseManifest, MANIFEST_FILE } from "../lib/framework-release/manifest.ts";
import { assertScaffold, runInit, templateOnlyDir } from "./lib/init-scaffold.ts";
import {
  REPO,
  manifestArchive,
  snapshot,
  testManifestEntries,
  trackRigs,
  type Archive,
  type Rig,
} from "./lib/launcher-rig.ts";
import { readTarGz } from "./lib/tar-reader.ts";

const rigs = trackRigs();
const FEEDBACK = "https://github.com/acme/crewrig-config";

let archive: Archive;

before(() => {
  archive = manifestArchive();
});

/** Extract the archive into a fresh directory; returns the root and the archive's paths. */
function extract(rig: Rig): { root: string; paths: string[] } {
  const root = rig.newDir("version");
  const paths: string[] = [];
  for (const record of readTarGz(archive.file)) {
    paths.push(record.path);
    if (record.type !== "file") continue;
    const target = path.join(root, ...record.path.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, record.data);
  }
  return { root, paths };
}

describe("R18: the manifest entries of WP3", () => {
  const entries = testManifestEntries();

  test("lists the entry descriptor, the entry point, its modules, and the templates and catalogs init copies", () => {
    for (const required of [
      "crewrig.entry.json",
      "scripts/crewrig-cli.ts",
      "scripts/lib/crewrig-cli",
      "config/ORGANIZATION.md.template",
      "config/TOOLS.md.template",
      "config/expertise",
      "config/teams",
      "config/level",
    ]) {
      assert.ok(entries.includes(required), `manifest.txt lists ${required}`);
    }
  });

  test("does not list the framework's own organization files or the personal seeds", () => {
    const forbidden = [
      "config/ORGANIZATION.md",
      "config/TOOLS.md",
      "config/SOUL.md",
      "config/PROFILE.md",
    ];
    for (const file of forbidden) {
      const covering = parseManifest(fs.readFileSync(MANIFEST_FILE, "utf8")).filter(
        (entry) => entry === file || file.startsWith(`${entry}/`),
      );
      assert.deepEqual(covering, [], `no entry ships ${file}`);
    }
  });

  test("the archive carries the descriptor at its root and naming a regular file of the archive", () => {
    const rig = rigs.make();
    const { root, paths } = extract(rig);

    const descriptor: unknown = JSON.parse(
      fs.readFileSync(path.join(root, "crewrig.entry.json"), "utf8"),
    );

    assert.ok(typeof descriptor === "object" && descriptor !== null);
    const entry = (descriptor as { entry?: unknown }).entry;
    assert.equal(typeof entry, "string");
    assert.ok(paths.includes(String(entry)), `the archive holds ${String(entry)}`);
    assert.ok(fs.statSync(path.join(root, String(entry))).isFile());
  });

  test("the archive holds no test and no checkout-only entry under scripts/", () => {
    const { paths } = extract(rigs.make());
    const scripts = paths.filter((p) => p.startsWith("scripts/"));

    assert.ok(scripts.length >= 2);
    for (const file of scripts) {
      assert.ok(
        !file.startsWith("scripts/tests/") && file !== "scripts/build-components.ts",
        `${file} is not shipped`,
      );
    }
  });
});

describe("R18: init run from an archive built from the manifest alone", () => {
  test("scaffolds the organization config repository with the files of the archive and nothing else", async () => {
    const rig = rigs.make();
    const { root } = extract(rig);
    const dir = templateOnlyDir(rig);

    const run = await runInit(rig, dir, ["--feedback-repo", FEEDBACK], {
      entry: path.join(root, "scripts", "crewrig-cli.ts"),
    });

    assert.equal(run.code, 0, run.out);
    assert.equal(run.stderr, "", "no warning, and no file of the checkout was needed");
    assertScaffold(dir, FEEDBACK, { source: root });
  });

  test("the extraction directory sees nothing of the checkout above it", () => {
    const rig = rigs.make();
    const { root } = extract(rig);

    assert.ok(!path.resolve(root).startsWith(REPO));
    assert.ok(!fs.existsSync(path.join(root, "node_modules")));
    assert.ok(!fs.existsSync(path.join(root, "scripts", "tests")));
  });

  // The modules `init` loads at import time (spec 0315 R12 keeps the entry's static graph small); the commands
  // build, setup and update load theirs on demand, and their own closure tests cover them.
  for (const module of [
    "scripts/crewrig-cli.ts",
    "scripts/lib/crewrig-cli/args.ts",
    "scripts/lib/crewrig-cli/command-args.ts",
    "scripts/lib/crewrig-cli/env.ts",
    "scripts/lib/crewrig-cli/exit.ts",
    "scripts/lib/crewrig-cli/org-dir.ts",
    "scripts/lib/crewrig-cli/origin.ts",
    "scripts/lib/crewrig-cli/plain-url.ts",
    "scripts/lib/crewrig-cli/scaffold.ts",
    "scripts/lib/crewrig-cli/toml.ts",
    "scripts/lib/crewrig-cli/toml-read.ts",
  ]) {
    test(`fails without ${module}, so a manifest that forgets it is caught`, async () => {
      const rig = rigs.make();
      const { root } = extract(rig);
      fs.rmSync(path.join(root, ...module.split("/")));
      const dir = templateOnlyDir(rig);
      const before = snapshot(dir);

      const run = await runInit(rig, dir, ["--feedback-repo", FEEDBACK], {
        entry: path.join(root, "scripts", "crewrig-cli.ts"),
      });

      assert.notEqual(run.code, 0, run.out);
      assert.ok(run.out.includes(path.basename(module)), run.out);
      assert.deepEqual(snapshot(dir), before, "nothing is written");
    });
  }

  for (const missing of [
    "config/ORGANIZATION.md.template",
    "config/TOOLS.md.template",
    "config/teams",
    "config/level",
    "config/expertise",
  ]) {
    test(`init refuses an archive without ${missing}: code 1, nothing written`, async () => {
      const rig = rigs.make();
      const { root } = extract(rig);
      fs.rmSync(path.join(root, ...missing.split("/")), { recursive: true });
      const dir = templateOnlyDir(rig);
      const before = snapshot(dir);

      const run = await runInit(rig, dir, ["--feedback-repo", FEEDBACK], {
        entry: path.join(root, "scripts", "crewrig-cli.ts"),
      });

      assert.equal(run.code, 1, run.out);
      assert.deepEqual(snapshot(dir), before);
    });
  }
});
