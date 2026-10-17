// governance-suite-extension-provenance-r4.test.ts — Replaces scripts/tests/test-check-extension-provenance.sh
// (Part B). R4 byte identity (spec 0043): the greeter SKILL.md provenance carrier survives, byte
// for byte, the install copy (cp -rf of install-extension), the link (ln -s) and the Claude plugin
// build (copy of the skill dir in build-claude-plugin). Runs against the REAL greeter source.
// B3 drives scripts/build-claude-plugin.ts directly (no bash, no jq); only B2 needs POSIX symlinks.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { makeSandbox, REPO, runEntry } from "./lib/governance-sandbox.ts";

const GREETER = path.join(REPO, "extensions/core/hello-world/skills/greeter/SKILL.md");

/** First non-blank line after the second `---` fence (the carrier line). */
function carrierOf(text: string): string {
  let fences = 0;
  for (const line of text.split("\n")) {
    if (line === "---") {
      fences += 1;
      continue;
    }
    if (fences === 2 && line.trim() !== "") return line;
  }
  return "";
}

const source = fs.readFileSync(GREETER);
const expected = carrierOf(source.toString("utf8"));

describe("check-extension-provenance, Part B (R4 byte identity)", () => {
  it("R4 setup - greeter carrier extractable", () => {
    assert.notEqual(expected, "", "a missing carrier must FAIL, not skip");
  });

  it("R4 (B1) carrier survives cp -rf (install copy) byte-for-byte", () => {
    const dst = path.join(makeSandbox("r4-cp-"), "SKILL.md");
    fs.cpSync(GREETER, dst, { force: true, recursive: true });
    assert.equal(carrierOf(fs.readFileSync(dst, "utf8")), expected);
    assert.ok(source.equals(fs.readFileSync(dst)), "whole file identical");
  });

  it(
    "R4 (B2) carrier survives ln -s (link) byte-for-byte",
    { skip: process.platform === "win32" ? "symlinkSync needs privileges on win32" : false },
    () => {
      const link = path.join(makeSandbox("r4-ln-"), "SKILL.md");
      fs.symlinkSync(GREETER, link);
      assert.equal(carrierOf(fs.readFileSync(link, "utf8")), expected);
      assert.ok(source.equals(fs.readFileSync(link)), "dereferenced bytes identical");
    },
  );

  it("R4 (B3) carrier survives Claude plugin build (cp -r) byte-for-byte", () => {
    const out = makeSandbox("r4-plugin-");
    const entry = path.join(REPO, "scripts", "build-claude-plugin.ts");
    const res = runEntry(entry, { cwd: REPO, args: ["hello-world", out] });
    assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
    const built = path.join(out, "skills", "greeter", "SKILL.md");
    assert.ok(fs.existsSync(built), `${built} must exist`);
    assert.equal(carrierOf(fs.readFileSync(built, "utf8")), expected);
    assert.ok(source.equals(fs.readFileSync(built)), "whole file identical");
  });
});
