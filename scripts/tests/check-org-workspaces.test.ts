// check-org-workspaces.test.ts — spec 0311 (issue #2073), plan step 3: the root workspace set must
// stay narrowed to the upstream tiers so an adopter's org extension never desynchronises the root
// lockfile. The entry under test is `scripts/check-org-workspaces.ts` (exit 0 ok, 1 finding,
// 2 usage; `REPO_DIR` overrides the repository root).
//
// Failing-before: the real-tree and scaffold cases also run `npm ci --dry-run` themselves (the
// `frozenInstallWithProbe` helper), so they go red with npm's `Missing: …@0.1.0 from lock file` on
// the unfixed tree, not only because the entry is absent.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import {
  REPO,
  cloneTemplate,
  createTemplate,
  runEntry,
  treeDigest,
} from "./lib/extension-sandbox.ts";

const ENTRY = path.join(REPO, "scripts", "check-org-workspaces.ts");
const NARROWED = ["extensions/core/*", "extensions/library/*"];
const scratch: string[] = [];

after(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${label}-`));
  scratch.push(dir);
  return dir;
}

function write(root: string, rel: string, content: string): void {
  const file = path.join(root, ...rel.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/** A minimal root: `workspaces` as given, one core extension `c`, and a lock in sync with them. */
function fixtureRoot(
  workspaces: readonly string[],
  lockedCore: readonly string[] = ["c"],
): string {
  const root = tempDir("org-ws-fixture");
  write(
    root,
    "package.json",
    JSON.stringify({ name: "fx", version: "1.0.0", private: true, workspaces }),
  );
  for (const name of ["c", "d"])
    write(
      root,
      `extensions/core/${name}/package.json`,
      JSON.stringify({ name: `${name}-extension`, version: "0.1.0" }),
    );
  const packages: Record<string, unknown> = {
    "": { name: "fx", version: "1.0.0", workspaces },
  };
  for (const name of lockedCore) {
    packages[`extensions/core/${name}`] = {
      name: `${name}-extension`,
      version: "0.1.0",
    };
    packages[`node_modules/${name}-extension`] = {
      resolved: `extensions/core/${name}`,
      link: true,
    };
  }
  write(
    root,
    "package-lock.json",
    JSON.stringify({
      name: "fx",
      version: "1.0.0",
      lockfileVersion: 3,
      requires: true,
      packages,
    }),
  );
  return root;
}

function check(root: string): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const run = spawnSync(process.execPath, [ENTRY], {
    cwd: REPO,
    encoding: "utf8",
    env: { ...process.env, REPO_DIR: root, LC_ALL: "C" },
  });
  if (run.error !== undefined) throw run.error;
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

/**
 * Independent oracle of the bug: copy the root manifests and every workspace `package.json` of
 * `root` into a temp dir, add a skeleton-shaped org extension `probe`, and run the frozen dry-run
 * install. Returns npm's status and output.
 */
function frozenInstallWithProbe(root: string): {
  status: number | null;
  output: string;
} {
  const dir = tempDir("org-ws-probe");
  for (const rel of ["package.json", "package-lock.json"])
    fs.copyFileSync(path.join(root, rel), path.join(dir, rel));
  for (const tier of fs.readdirSync(path.join(root, "extensions"), {
    withFileTypes: true,
  })) {
    if (!tier.isDirectory()) continue;
    for (const ext of fs.readdirSync(path.join(root, "extensions", tier.name), {
      withFileTypes: true,
    })) {
      const src = path.join(
        root,
        "extensions",
        tier.name,
        ext.name,
        "package.json",
      );
      if (ext.isDirectory() && fs.existsSync(src))
        write(
          dir,
          `extensions/${tier.name}/${ext.name}/package.json`,
          fs.readFileSync(src, "utf8"),
        );
    }
  }
  const skeleton = fs
    .readFileSync(
      path.join(REPO, "extension-skeleton", "base", "package.json"),
      "utf8",
    )
    .replaceAll("${SKELETON_NAME}", "probe");
  write(dir, "extensions/org/probe/package.json", skeleton);
  const run = spawnSync(
    "npm",
    ["ci", "--dry-run", "--ignore-scripts", "--offline"],
    {
      cwd: dir,
      encoding: "utf8",
    },
  );
  if (run.error !== undefined) throw run.error;
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

describe("spec 0311 — org extensions stay outside the root workspace set", () => {
  // Failure path: a root pattern that reaches extensions/org/<x> is a finding naming the pattern.
  for (const pattern of [
    "extensions/*/*",
    "extensions/**",
    "extensions/org/*",
  ]) {
    test(`check-org-workspaces::pattern ${pattern} reaching extensions/org exits 1 and names the pattern`, () => {
      const root = fixtureRoot([...NARROWED, pattern]);

      const result = check(root);

      assert.equal(
        result.status,
        1,
        `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      );
      assert.ok(
        result.stderr.includes(pattern),
        `stderr must name "${pattern}":\n${result.stderr}`,
      );
      assert.match(result.stderr, /0311/);
    });
  }

  // A narrowed set whose lock lacks a core workspace is a stale-lock finding with its cause.
  test("check-org-workspaces::narrowed set with a stale lock for a core workspace exits 1 with the cause", () => {
    const root = fixtureRoot(NARROWED, ["c"]); // `d` exists on disk but is missing from the lock

    const result = check(root);

    assert.equal(
      result.status,
      1,
      `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
    assert.match(result.stderr, /Missing: d-extension@0\.1\.0 from lock file/);
    assert.match(result.stderr, /restore/i);
  });

  test("check-org-workspaces::a narrowed, in-sync fixture exits 0", () => {
    const result = check(fixtureRoot(NARROWED));

    assert.equal(
      result.status,
      0,
      `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  });

  // Regression of #2073: the real repository must accept a skeleton-shaped org extension.
  test("check-org-workspaces::the real repository exits 0 and a frozen install tolerates an org probe", () => {
    const probe = frozenInstallWithProbe(REPO);
    assert.equal(
      probe.status,
      0,
      `npm ci --dry-run with an org probe failed:\n${probe.output}`,
    );

    const result = check(REPO);

    assert.equal(
      result.status,
      0,
      `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  });

  // The check is read-only on the repository it inspects.
  test("check-org-workspaces::running the check leaves the real tree unchanged", () => {
    const before = spawnSync("git", ["status", "--porcelain"], {
      cwd: REPO,
      encoding: "utf8",
    }).stdout;

    check(REPO);

    const after = spawnSync("git", ["status", "--porcelain"], {
      cwd: REPO,
      encoding: "utf8",
    }).stdout;
    assert.equal(after, before);
  });

  // R6, R2: the scaffold of an org extension (TIER unset) must leave the root lock valid.
  test("check-org-workspaces::scaffolding an org extension with create-extension then checking exits 0", () => {
    const root = cloneTemplate(createTemplate());
    fs.copyFileSync(
      ENTRY,
      path.join(root, "scripts", "check-org-workspaces.ts"),
    );

    const scaffold = runEntry(root, "create-extension.ts", ["--components="], {
      NAME: "probe",
    });
    assert.equal(scaffold.status, 0, `scaffold failed:\n${scaffold.combined}`);
    assert.ok(
      fs.existsSync(
        path.join(root, "extensions", "org", "probe", "package.json"),
      ),
    );
    const lockBefore = treeDigest(root)["package-lock.json"];

    const frozen = frozenInstallWithProbe(root);
    assert.equal(
      frozen.status,
      0,
      `frozen install after scaffold failed:\n${frozen.output}`,
    );
    const result = runEntry(root, "check-org-workspaces.ts");

    assert.equal(result.status, 0, result.combined);
    assert.equal(
      treeDigest(root)["package-lock.json"],
      lockBefore,
      "the check rewrote the lock",
    );
  });
});
