// windows-install-entries.test.ts — runs the cross-system proof of the install, manage and link entries
// (spec 0255 R28) on Windows only; elsewhere it is skipped, as the proof's POSIX leg is the Linux
// black-box suites' job. The `windows-install-entries` job runs the proof as its own step too.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, it } from "node:test";

const PROOF = path.resolve(import.meta.dirname, "lib", "windows-install-proof.ts");

describe("windows install entries proof", { skip: process.platform !== "win32" }, () => {
  it("passes under PowerShell and cmd.exe", () => {
    const res = spawnSync(
      process.execPath,
      ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", PROOF],
      { encoding: "utf8" },
    );
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.match(res.stdout, /windows-install-proof: OK/);
  });
});
