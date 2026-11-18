// Spec 0310 R2: an extension directory named `crewrig` is refused (exit 2, nothing written);
// without one the driver behaves as before.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { checkout, GITHUB, initRepo, run, useCheckout } from "./lib/release-main-fixture.ts";

useCheckout();

describe("extension named crewrig", () => {
  it("is refused with exit 2 before any output", async () => {
    initRepo("main");
    fs.mkdirSync(path.join(checkout, "extensions", "core", "crewrig"), { recursive: true });
    const result = await run(GITHUB);
    assert.equal(result.code, 2);
    assert.equal(result.err.length, 1);
    assert.match(result.err[0] ?? "", /^Error: extension directory named crewrig \(extensions\/core\/crewrig\)/);
    assert.deepEqual(result.out, []);
  });

  it("does not refuse other names, even crewrig-prefixed ones", async () => {
    initRepo("main");
    fs.mkdirSync(path.join(checkout, "extensions", "core", "crewrigx"), { recursive: true });
    const result = await run({ ...GITHUB, RELEASE_DRY_RUN: "true" });
    assert.notEqual(result.code, 2, result.err.join("\n"));
  });
});
