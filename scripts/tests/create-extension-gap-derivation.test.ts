// create-extension-gap-derivation.test.ts — non-vacuity of the scaffolder's gap derivation (spec
// 0183 R2): an EMPTY derived accepted-gaps.json passes --check exactly like a correct one, so
// presence proves nothing. Neither `hook` nor `mcp-server` produces a real gap against the
// skeleton's own content, so a sandboxed extension-targets.json mutation (`copilot.mcpDelivery =
// false`) forces one. Replaces groups G3-G5 of scripts/tests/test-create-extension-combinations.sh
// (spec 0265, row J2).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { before, describe, test } from "node:test";

import { check, cloneTemplate, createTemplate, extDir, runEntry } from "./lib/extension-sandbox.ts";

let root = "";
let gapFile = "";

before(() => {
  root = cloneTemplate(createTemplate());
  const targets = path.join(root, "scripts", "lib", "extension-targets.json");
  const json = JSON.parse(fs.readFileSync(targets, "utf8")) as {
    copilot: Record<string, unknown>;
  };
  json.copilot["mcpDelivery"] = false;
  fs.writeFileSync(targets, `${JSON.stringify(json, null, 2)}\n`);
  const scaffold = runEntry(root, "create-extension.ts", ["--components=mcp-server"], {
    NAME: "gapcombo",
    TIER: "org",
  });
  assert.equal(scaffold.status, 0, scaffold.combined);
  gapFile = path.join(extDir(root, "gapcombo", "org"), "accepted-gaps.json");
});

describe("gap derivation — content, not presence", () => {
  test("G3 — the derived accepted-gaps.json has exactly one entry: subject mcpServers on copilot", () => {
    assert.ok(fs.existsSync(gapFile), "accepted-gaps.json missing");
    const gaps = JSON.parse(fs.readFileSync(gapFile, "utf8")) as {
      subject?: string;
      target?: string;
    }[];
    const hits = gaps.filter((g) => g.subject === "mcpServers" && g.target === "copilot");
    assert.equal(hits.length, 1, JSON.stringify(gaps));
  });

  test("G4 — --check passes on the derived (non-empty) accepted-gaps.json", () => {
    const res = check(root, "gapcombo");
    assert.equal(res.status, 0, res.combined);
  });

  test("G5 — emptying the derived file turns --check red with GAP-UNDECLARED", () => {
    fs.writeFileSync(gapFile, "[]\n");
    const res = check(root, "gapcombo");
    assert.notEqual(res.status, 0, res.combined);
    assert.match(res.combined, /GAP-UNDECLARED/);
  });
});
