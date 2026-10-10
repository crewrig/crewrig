// component-install.test.ts — unit suite for scripts/lib/component-install.ts (spec 0255, row F2).
//
// Written from reading `component_install_named` and `component_install_all` in
// scripts/lib/component-resolve.sh (the oracle): the miss-only rebuild of the named path,
// the unconditional rebuild of the all path, the per-name collision refusal with a deferred
// status, and the unresolved report.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { componentInstallAll, componentInstallNamed } from "../lib/component-install.ts";
import type { SpawnFn } from "../lib/component-overlay.ts";
import { setStagingRoots } from "../lib/component-roots.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "component-install-test-"));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** A repository root with `rels` created under it (a trailing `/` makes a directory). */
function repo(...rels: string[]): string {
  const root = fs.mkdtempSync(path.join(tmp, "r"));
  for (const rel of rels) {
    const target = path.join(root, rel);
    if (rel.endsWith("/")) fs.mkdirSync(target, { recursive: true });
    else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, "x");
    }
  }
  return root;
}

function harness(): {
  err: string[];
  installed: string[];
  install: (p: string) => number;
  spawned: string[][];
  spawn: SpawnFn;
  stderr: (t: string) => void;
} {
  const h = {
    err: [] as string[],
    installed: [] as string[],
    spawned: [] as string[][],
    install: (p: string): number => {
      h.installed.push(p);
      return 0;
    },
    spawn: ((command, args) => {
      h.spawned.push([command, ...args]);
      return { status: 0, output: "" };
    }) as SpawnFn,
    stderr: (t: string): void => {
      h.err.push(t);
    },
  };
  return h;
}

describe("componentInstallNamed", () => {
  test("a single match installs without rebuilding", () => {
    const r = repo("dist/org/.claude/skills/foo/SKILL.md");
    const roots = setStagingRoots(r, ".claude/skills");
    const h = harness();
    const status = componentInstallNamed(h.install, "foo", "skills", "claude", roots, {
      repoDir: r,
      spawn: h.spawn,
      stderr: h.stderr,
    });
    assert.equal(status, 0);
    assert.deepEqual(h.installed, [`${r}/dist/org/.claude/skills/foo`]);
    assert.equal(h.spawned.length, 0);
    assert.deepEqual(h.err, []);
  });

  test("the installer's status is returned", () => {
    const r = repo("dist/org/.claude/skills/foo/");
    const roots = setStagingRoots(r, ".claude/skills");
    const status = componentInstallNamed(() => 7, "foo", "skills", "", roots, { repoDir: r });
    assert.equal(status, 7);
  });

  test("a miss rebuilds once, searches again and reports unresolved", () => {
    const r = repo("dist/org/.claude/skills/other/");
    const roots = setStagingRoots(r, ".claude/skills");
    const h = harness();
    const status = componentInstallNamed(h.install, "nope", "skills", "claude", roots, {
      repoDir: r,
      spawn: h.spawn,
      stderr: h.stderr,
    });
    assert.equal(status, 1);
    assert.equal(h.spawned.length, 1);
    assert.equal(h.installed.length, 0);
    assert.equal(h.err.length, 1);
    assert.match(h.err[0] ?? "", /^Error: no component named 'nope' of type 'skills' resolved/);
  });

  test("a miss without a refresh CLI does not rebuild", () => {
    const r = repo();
    const h = harness();
    const roots = setStagingRoots(r, ".claude/skills");
    assert.equal(
      componentInstallNamed(h.install, "nope", "skills", "", roots, {
        repoDir: r,
        spawn: h.spawn,
        stderr: h.stderr,
      }),
      1,
    );
    assert.equal(h.spawned.length, 0);
    assert.match(h.err.join(""), /No served tier of this type was available at all/);
  });

  test("a refused rebuild returns its status and installs nothing", () => {
    const r = repo();
    const roots = setStagingRoots(r, ".claude/skills");
    const err: string[] = [];
    const status = componentInstallNamed(() => 0, "x", "skills", "bogus", roots, {
      repoDir: r,
      stderr: (t) => err.push(t),
    });
    assert.equal(status, 2);
    assert.equal(err.join(""), "Internal error: no staging root is defined for CLI 'bogus'.\n");
  });

  test("a collision across roots is refused with every source and nothing installed", () => {
    const r = repo("dist/library/.claude/skills/foo/", "dist/org/.claude/skills/foo/");
    const roots = setStagingRoots(r, ".claude/skills");
    const h = harness();
    const status = componentInstallNamed(h.install, "foo", "skills", "claude", roots, {
      repoDir: r,
      spawn: h.spawn,
      stderr: h.stderr,
    });
    assert.equal(status, 1);
    assert.equal(h.installed.length, 0);
    assert.equal(
      h.err.join(""),
      "Refusing 'foo': one installed name is claimed by more than one component.\n" +
        "Every source presenting it, in no significant order:\n" +
        `  - ${r}/dist/library/.claude/skills/foo\n` +
        `  - ${r}/dist/org/.claude/skills/foo\n`,
    );
  });

  test("kind handling: a command file resolves by its .md extension", () => {
    const r = repo("artifacts/org/commands/go.md");
    const roots = [`${r}/artifacts/org/commands`];
    const h = harness();
    assert.equal(componentInstallNamed(h.install, "go", "commands", "", roots, { repoDir: r }), 0);
    assert.deepEqual(h.installed, [`${r}/artifacts/org/commands/go.md`]);
  });
});

describe("componentInstallAll", () => {
  test("rebuilds first, then installs every component once, in name order", () => {
    const r = repo("dist/org/.claude/skills/stale/");
    const roots = setStagingRoots(r, ".claude/skills");
    const h = harness();
    // The stand-in build repopulates the pruned roots, as the real one would.
    const spawn: SpawnFn = (command, args) => {
      h.spawned.push([command, ...args]);
      for (const rel of [
        "org/.claude/skills/b/",
        "library/.claude/skills/a/",
        "org/.claude/skills/.gitkeep",
      ]) {
        const target = `${r}/dist/${rel}`;
        if (rel.endsWith("/")) fs.mkdirSync(target, { recursive: true });
        else fs.writeFileSync(target, "");
      }
      return { status: 0, output: "" };
    };
    const status = componentInstallAll(h.install, "claude", roots, {
      repoDir: r,
      spawn,
      stderr: h.stderr,
    });
    assert.equal(status, 0);
    assert.equal(h.spawned.length, 1);
    assert.deepEqual(h.installed, [
      `${r}/dist/library/.claude/skills/a`,
      `${r}/dist/org/.claude/skills/b`,
    ]);
  });

  test("a colliding name installs nothing, defers a non-zero status, siblings install", () => {
    const r = repo(
      "dist/library/.claude/skills/dup/",
      "dist/org/.claude/skills/dup/",
      "dist/org/.claude/skills/ok/",
    );
    const roots = setStagingRoots(r, ".claude/skills");
    const h = harness();
    const status = componentInstallAll(h.install, "", roots, { repoDir: r, stderr: h.stderr });
    assert.equal(status, 1);
    assert.deepEqual(h.installed, [`${r}/dist/org/.claude/skills/ok`]);
    assert.equal(
      h.err.join(""),
      "Refusing 'dup': one installed name is claimed by more than one component.\n" +
        "Every source presenting it, in no significant order:\n" +
        `  - ${r}/dist/library/.claude/skills/dup\n` +
        `  - ${r}/dist/org/.claude/skills/dup\n`,
    );
  });

  test("a failing installer sets the status but the rest still install", () => {
    const r = repo("artifacts/org/themes/a.json", "artifacts/org/themes/b.json");
    const seen: string[] = [];
    const status = componentInstallAll(
      (p) => {
        seen.push(p);
        return p.endsWith("a.json") ? 4 : 0;
      },
      "",
      [`${r}/artifacts/org/themes`],
      { repoDir: r },
    );
    assert.equal(status, 1);
    assert.equal(seen.length, 2);
  });

  test("a refused rebuild returns its status before any install", () => {
    const r = repo("dist/org/.claude/skills/a/");
    const h = harness();
    const status = componentInstallAll(h.install, "bogus", setStagingRoots(r, ".claude/skills"), {
      repoDir: r,
      stderr: h.stderr,
    });
    assert.equal(status, 2);
    assert.equal(h.installed.length, 0);
  });

  test("no root present returns 0", () => {
    const r = repo();
    const h = harness();
    assert.equal(
      componentInstallAll(h.install, "", setStagingRoots(r, ".claude/skills"), { repoDir: r }),
      0,
    );
    assert.equal(h.installed.length, 0);
  });
});
