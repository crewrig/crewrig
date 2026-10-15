// create-extension-skeleton-toolchain.test.ts — the scaffold carries the repository's own TypeScript
// toolchain pins (spec 0258 R26): `typescript` at the root's version, `@types/node` at the root's range.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const REPO = path.resolve(import.meta.dirname, "..", "..");

function devDependencies(file: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(fs.readFileSync(path.join(REPO, file), "utf8"));
  const deps: unknown =
    typeof parsed === "object" && parsed !== null ? Reflect.get(parsed, "devDependencies") : null;
  assert.ok(typeof deps === "object" && deps !== null, `${file} has devDependencies`);
  return deps as Record<string, unknown>;
}

test("the skeleton pins typescript and @types/node as the repository root does", () => {
  const root = devDependencies("package.json");
  const skeleton = devDependencies("extension-skeleton/base/package.json");
  assert.match(String(root["typescript"]), /^7\./);
  assert.equal(skeleton["typescript"], root["typescript"]);
  assert.equal(skeleton["@types/node"], root["@types/node"]);
});

test("the skeleton tsconfig declares the node types (TypeScript 7 includes no @types implicitly)", () => {
  const parsed: unknown = JSON.parse(
    fs.readFileSync(path.join(REPO, "extension-skeleton/base/tsconfig.json"), "utf8"),
  );
  const options: unknown =
    typeof parsed === "object" && parsed !== null ? Reflect.get(parsed, "compilerOptions") : null;
  const types: unknown =
    typeof options === "object" && options !== null ? Reflect.get(options, "types") : null;
  assert.ok(Array.isArray(types) && types.includes("node"), "compilerOptions.types lists node");
});

const TSC = path.join(
  REPO,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "tsc.cmd" : "tsc",
);
const SDK = path.join(REPO, "node_modules", "@modelcontextprotocol", "sdk");
const NODE_TYPES = path.join(REPO, "node_modules", "@types", "node");
const COMPILE_SKIP = !fs.existsSync(TSC)
  ? "the root's tsc is not installed"
  : !fs.existsSync(SDK)
    ? "the root's @modelcontextprotocol/sdk is not installed"
    : !fs.existsSync(NODE_TYPES)
      ? "the root's @types/node is not installed"
      : false;

test(
  "a scaffold with the mcp-server component type-checks with the root tsc",
  {
    skip: COMPILE_SKIP,
  },
  () => {
    const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "skeleton-tsc-")));
    try {
      fs.copyFileSync(
        path.join(REPO, "extension-skeleton/base/tsconfig.json"),
        path.join(dir, "tsconfig.json"),
      );
      fs.cpSync(path.join(REPO, "extension-skeleton/mcp-server/src"), path.join(dir, "src"), {
        recursive: true,
      });
      const modules = path.join(dir, "node_modules");
      fs.mkdirSync(path.join(modules, "@types"), { recursive: true });
      fs.mkdirSync(path.join(modules, "@modelcontextprotocol"), { recursive: true });
      fs.symlinkSync(NODE_TYPES, path.join(modules, "@types", "node"), "junction");
      fs.symlinkSync(SDK, path.join(modules, "@modelcontextprotocol", "sdk"), "junction");
      const res = spawnSync(TSC, ["--noEmit", "-p", "tsconfig.json"], {
        cwd: dir,
        encoding: "utf8",
        shell: process.platform === "win32",
      });
      assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
