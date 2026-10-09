// extension-resolve.test.ts — extension directory resolution and discovery (spec 0254 R6).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { discoverDirs, resolveExtensionDir } from "../lib/extension/resolve.ts";

let repo = "";

function ext(tier: string, name: string, withManifest = true): void {
  const dir = path.join(repo, "extensions", tier, name);
  fs.mkdirSync(dir, { recursive: true });
  if (withManifest) fs.writeFileSync(path.join(dir, "extension.json"), "{}");
}

before(() => {
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ext-resolve-")));
  ext("core", "zeta");
  ext("core", "alpha");
  ext("core", "Beta");
  ext("core", ".hidden");
  ext("core", "nomanifest", false);
  ext("library", "lib-one");
  ext("org", "org-one");
  ext("library", "dup");
  ext("org", "dup");
});

after(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe("resolveExtensionDir", () => {
  it("makes an existing directory argument absolute", () => {
    const relative = path.relative(process.cwd(), path.join(repo, "extensions", "core", "alpha"));
    assert.deepEqual(resolveExtensionDir(relative, repo), {
      ok: true,
      dir: path.join(repo, "extensions", "core", "alpha"),
    });
  });

  it("looks a bare name up under the tiers", () => {
    assert.deepEqual(resolveExtensionDir("lib-one", repo), {
      ok: true,
      dir: path.join(repo, "extensions", "library", "lib-one"),
    });
    assert.deepEqual(resolveExtensionDir("org-one", repo), {
      ok: true,
      dir: path.join(repo, "extensions", "org", "org-one"),
    });
  });

  it("refuses a name that exists in two tiers", () => {
    assert.deepEqual(resolveExtensionDir("dup", repo), {
      ok: false,
      message: "Error: extension 'dup' exists in multiple tiers; names must be unique.",
    });
  });

  it("refuses an unknown name", () => {
    assert.deepEqual(resolveExtensionDir("ghost", repo), {
      ok: false,
      message: "Error: extension directory or name 'ghost' not found.",
    });
  });
});

describe("discoverDirs", () => {
  it("lists tiers in order, names in code-unit order, only directories with extension.json", () => {
    const e = (tier: string, name: string): string => path.join(repo, "extensions", tier, name);
    assert.deepEqual(discoverDirs(repo), [
      e("core", "Beta"),
      e("core", "alpha"),
      e("core", "zeta"),
      e("library", "dup"),
      e("library", "lib-one"),
      e("org", "dup"),
      e("org", "org-one"),
    ]);
  });

  it("is empty when no tier exists", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "ext-resolve-empty-"));
    try {
      assert.deepEqual(discoverDirs(empty), []);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});
