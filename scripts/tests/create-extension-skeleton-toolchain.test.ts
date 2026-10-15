// create-extension-skeleton-toolchain.test.ts — the scaffold carries the repository's own TypeScript
// toolchain pins (spec 0258 R26): `typescript` at the root's version, `@types/node` at the root's range.

import assert from "node:assert/strict";
import fs from "node:fs";
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
