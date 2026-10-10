// link-or-copy-classify.test.ts — tests for scripts/lib/link-or-copy-classify.ts (spec 0255 R15, R21).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  FALLBACK_ANYWHERE,
  FALLBACK_WIN32_ONLY,
  FORCED_REFUSAL_ENV,
  classifyRefusal,
  forcedRefusal,
} from "../lib/link-or-copy-classify.ts";

const libDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "lib");

const TABLE: ReadonlyArray<readonly [string, "fallback" | "rethrow", "fallback" | "rethrow"]> = [
  // code, on win32, on linux
  ["EPERM", "fallback", "rethrow"],
  ["ENOTSUP", "fallback", "fallback"],
  ["EOPNOTSUPP", "fallback", "fallback"],
  ["ENOSYS", "fallback", "fallback"],
  ["EACCES", "rethrow", "rethrow"],
  ["EEXIST", "rethrow", "rethrow"],
  ["ENOENT", "rethrow", "rethrow"],
  ["ELOOP", "rethrow", "rethrow"],
  ["ENAMETOOLONG", "rethrow", "rethrow"],
  ["EINVAL", "rethrow", "rethrow"],
  ["UNKNOWN", "rethrow", "rethrow"],
  ["", "rethrow", "rethrow"],
];

describe("classifyRefusal", () => {
  for (const [code, win, linux] of TABLE) {
    test(`${code || "(empty)"}: win32 ${win}, linux ${linux}`, () => {
      assert.equal(classifyRefusal(code, "win32"), win);
      assert.equal(classifyRefusal(code, "linux"), linux);
      assert.equal(classifyRefusal(code, "darwin"), linux);
    });
  }

  test("the exported constants are the whole fallback set", () => {
    assert.deepEqual([...FALLBACK_ANYWHERE].sort(), ["ENOSYS", "ENOTSUP", "EOPNOTSUPP"]);
    assert.deepEqual([...FALLBACK_WIN32_ONLY], ["EPERM"]);
  });
});

describe("forcedRefusal", () => {
  test("is honoured when set", () => {
    assert.equal(forcedRefusal({ [FORCED_REFUSAL_ENV]: "EPERM" }), "EPERM");
  });

  test("is ignored when unset or empty", () => {
    assert.equal(forcedRefusal({}), null);
    assert.equal(forcedRefusal({ [FORCED_REFUSAL_ENV]: "" }), null);
    assert.equal(forcedRefusal({ [FORCED_REFUSAL_ENV]: undefined }), null);
  });

  test("the seam name is read in exactly one module of scripts/lib", () => {
    const spelling = fs
      .readdirSync(libDir)
      .filter((name) => name.endsWith(".ts"))
      .filter((name) =>
        fs.readFileSync(path.join(libDir, name), "utf8").includes("CREWRIG_TEST_LINK_REFUSAL"),
      );
    assert.deepEqual(spelling, ["link-or-copy-classify.ts"]);
  });
});

describe("difference with LINK_REFUSALS of extension/tree-copy.ts", () => {
  test("pins both sets and why they differ", () => {
    const source = fs.readFileSync(path.join(libDir, "extension", "tree-copy.ts"), "utf8");
    const match = /const LINK_REFUSALS = new Set\(\[([^\]]*)\]\)/.exec(source);
    assert.notEqual(match, null, "LINK_REFUSALS declaration not found in tree-copy.ts");
    const treeCopy = (match?.[1] ?? "")
      .split(",")
      .map((s) => s.trim().replace(/"/g, ""))
      .filter(Boolean)
      .sort();
    assert.deepEqual(treeCopy, ["EACCES", "ENOTSUP", "EOPNOTSUPP", "EPERM", "UNKNOWN"]);
    // tree-copy guards the recreation of links inside a copied tree on any platform; here a POSIX
    // EPERM/EACCES is a wrong landing zone (ln -s fails under set -e) and ENOSYS is a link-less fs.
    for (const code of ["EPERM", "EACCES", "UNKNOWN"]) {
      assert.ok(treeCopy.includes(code));
      assert.equal(classifyRefusal(code, "linux"), "rethrow", `${code} on linux`);
    }
    assert.ok(!treeCopy.includes("ENOSYS"));
    assert.equal(classifyRefusal("ENOSYS", "linux"), "fallback");
  });
});
