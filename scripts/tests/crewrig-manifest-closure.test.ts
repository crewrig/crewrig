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
import { spawnSync } from "node:child_process";
import { isStrippedVariable } from "../lib/crewrig-cli/env.ts";
import { parseManifest, MANIFEST_FILE } from "../lib/framework-release/manifest.ts";
import {
  checkScopes,
  envNamesOf,
  topLevelEnvReads,
  uncoveredEnvNames,
  walkClosure,
} from "./lib/closure-walk.ts";
import { classifyEnvName } from "./lib/env-classes.ts";
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

// ------------------------------------------------------------------------------------ the static closure

/** The archive as a map of path to bytes, read with the independent reader of the tests. */
function archiveFiles(): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  for (const record of readTarGz(archive.file)) {
    if (record.type === "file") files.set(record.path, record.data);
  }
  return files;
}

const tracked = (() => {
  const listed = spawnSync("git", ["ls-files", "-z"], { cwd: REPO, encoding: "utf8" });
  const names = new Set(listed.stdout.split("\0"));
  return (rel: string): boolean => names.has(rel);
})();

/** The entry files of the closure: the commands, the four hooks, and what `setup` spawns by path. */
const ENTRIES = [
  "scripts/crewrig-cli.ts",
  "hooks/usage-capture.ts",
  "hooks/antigravity-statusline-shim.ts",
  "hooks/mempalace-transcript.ts",
  "hooks/worktree-git-guard.ts",
  "scripts/session-check-hooks.ts",
  "scripts/lib/node-floor-guard.js",
];

/** A reference a command makes on purpose to a checkout-only file: `build-components.ts` is only named for diagnostics. */
const UNSHIPPED = new Set(["scripts/build-components.ts"]);

describe("R10: the static closure of build, setup, update and the hooks, over the archive", () => {
  test("follows module-path strings and spawned scripts, not only import specifiers", () => {
    const { reached } = walkClosure(archiveFiles(), ENTRIES, tracked, UNSHIPPED);

    for (const [file, how] of [
      ["scripts/lib/crewrig-cli/build.ts", "a dynamic import() of the entry point"],
      [
        "scripts/lib/setup/mcp-claude-step.ts",
        "a module-path string of a strategy table (steps-mcp.ts)",
      ],
      [
        "scripts/lib/setup/mcp-agy-step.ts",
        "a module-path string of a strategy table (steps-mcp.ts)",
      ],
      ["scripts/tls-exec.ts", "a spawned script: path.join(<root>, 'scripts', 'tls-exec.ts')"],
      ["scripts/session-check-hooks.ts", "a spawned script"],
      ["scripts/lib/build-components/main.ts", "the compile that build and setup share"],
      ["scripts/lib/setup/steps-distribution.ts", "the distribution-only step"],
      ["scripts/lib/service/exec.ts", "the service manager seam"],
      ["scripts/lib/usage-capture/index.js", "a CommonJS require without an extension"],
    ] as const) {
      assert.ok(reached.includes(file), `${file} is reached (${how})`);
    }
    assert.ok(reached.length > 150, `${reached.length} files reached`);
  });

  test("every reached file that the checkout tracks is in the archive", () => {
    const { missing } = walkClosure(archiveFiles(), ENTRIES, tracked, UNSHIPPED);

    assert.deepEqual(missing, []);
  });

  test("removing any file of the closure from the archive is reported, naming the file", () => {
    const files = archiveFiles();
    const { reached } = walkClosure(files, ENTRIES, tracked, UNSHIPPED);

    for (const file of reached) {
      const without = new Map(files);
      without.delete(file);

      const { missing } = walkClosure(without, ENTRIES, tracked, UNSHIPPED);

      assert.ok(
        missing.some((hole) => hole === file || hole.endsWith(`-> ${file}`)),
        `removing ${file} is not reported`,
      );
    }
  });

  test("the R41(c) scopes hold over the whole closure: CommonJS files in commonjs scopes, ECMAScript files in the root", () => {
    const files = archiveFiles();
    const { reached } = walkClosure(files, ENTRIES, tracked, UNSHIPPED);

    assert.deepEqual(
      checkScopes(files, reached).map((finding) => `${finding.file}: ${finding.problem}`),
      [],
    );
  });

  test("fails on a scope file removed, and on an ECMAScript file put in a scoped directory", () => {
    const files = archiveFiles();
    files.delete("scripts/lib/usage-store/package.json");
    files.set("scripts/lib/usage-capture/esm.ts", Buffer.from("export const x = 1;\n"));
    const index = (files.get("scripts/lib/usage-capture/index.js") as Buffer).toString("utf8");
    files.set(
      "scripts/lib/usage-capture/index.js",
      Buffer.from(`${index}\nrequire('./esm.ts');\n`),
    );

    const { reached } = walkClosure(files, ENTRIES, tracked, UNSHIPPED);
    const problems = checkScopes(files, reached).map((finding) => finding.file);

    assert.ok(problems.includes("scripts/lib/usage-store/mcp.js"));
    assert.ok(problems.includes("scripts/lib/usage-capture/esm.ts"));
  });
});

describe("delta-01 R12: the environment names of the closure are all covered by the strip", () => {
  test("the closure mentions the variables of the classes, so the check is not vacuous", () => {
    const files = archiveFiles();
    const { reached } = walkClosure(files, ENTRIES, tracked, UNSHIPPED);
    const names = new Set(
      reached.flatMap((file) => envNamesOf((files.get(file) as Buffer).toString("utf8"))),
    );

    for (const name of [
      "CREWRIG_TLS_CA",
      "CREWRIG_USAGE_ROOT",
      "MEMPALACE_MCP_EVICT_CMD",
      "MEMPALACE_MCP_HOST",
      "MEMPALACE_PYTHON",
      "MEMPALACE_CHROMA_PORT",
    ]) {
      assert.ok(names.has(name), `${name} is read somewhere in the closure`);
    }
  });

  test("no name of the neighbourhood of the classes is left to neither the strip nor the allowlist", () => {
    const files = archiveFiles();
    const { reached } = walkClosure(files, ENTRIES, tracked, UNSHIPPED);

    assert.deepEqual(uncoveredEnvNames(files, reached), []);
  });

  test("env.ts strips every name of the classes that the closure reads, except the six and the launcher variable", () => {
    const files = archiveFiles();
    const { reached } = walkClosure(files, ENTRIES, tracked, UNSHIPPED);
    const names = new Set(
      reached.flatMap((file) => envNamesOf((files.get(file) as Buffer).toString("utf8"))),
    );

    for (const name of names) {
      const cls = classifyEnvName(name);
      assert.equal(isStrippedVariable(name), cls === "stripped", `${name} (${cls})`);
    }
  });

  test("fails on a new variable of the neighbourhood that no class covers", () => {
    const files = archiveFiles();
    files.set(
      "scripts/lib/setup/new-reader.ts",
      Buffer.from('export const f = (env: NodeJS.ProcessEnv) => env["MCP_DAEMON_NEW_SEAM"];\n'),
    );

    assert.deepEqual(uncoveredEnvNames(files, ["scripts/lib/setup/new-reader.ts"]), [
      "MCP_DAEMON_NEW_SEAM (scripts/lib/setup/new-reader.ts)",
    ]);
  });

  test("no module of the commands reads process.env while it loads", () => {
    const files = archiveFiles();
    const { reached } = walkClosure(files, ["scripts/crewrig-cli.ts"], tracked, UNSHIPPED);

    const reads = reached.flatMap((file) =>
      topLevelEnvReads(file, (files.get(file) as Buffer).toString("utf8")),
    );

    assert.deepEqual(reads, []);
  });

  test("fails on a top-level read, and ignores a parameter default and a read inside a function", () => {
    assert.deepEqual(topLevelEnvReads("a.ts", "const home = process.env.HOME;\n"), [
      "a.ts: const home = process.env.HOME;",
    ]);
    assert.deepEqual(
      topLevelEnvReads(
        "b.ts",
        "export function f(env: NodeJS.ProcessEnv = process.env) {\n  return process.env.X ?? env.Y;\n}\n",
      ),
      [],
    );
  });
});
