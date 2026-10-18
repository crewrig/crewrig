// create-extension-combinations.test.ts — for EVERY combination of the six components the
// scaffolder offers (the 64 subsets, the empty one included), the produced tree renders for every
// target and passes the single check capability with no edit, and no placeholder literal survives
// in it. Replaces scripts/tests/test-create-extension-combinations.sh (spec 0265, row J2; spec
// 0183 R2). The `fzf` stub is gone: the selection is `--components <csv>` (the shim test keeps the
// env channel and proves a stub `fzf` on PATH is ignored). The gap-derivation groups (G3-G5) are
// in create-extension-gap-derivation.test.ts.
//
// Budget: the Bash suite warned above 300 s; here the whole file is a hard 300 s `describe`
// timeout. On win32 only masks 0, 21, 42 and 63 run: 64 clones of the tree are not affordable
// on windows-latest, and windows-create-extension.test.ts proves the scaffolder there.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import {
  check,
  cloneTemplate,
  createTemplate,
  extDir,
  runEntry,
  selectionOf,
} from "./lib/extension-sandbox.ts";

const BUDGET_MS = 300_000;
const ALL_MASKS = Array.from({ length: 64 }, (_, mask) => mask);
const MASKS = process.platform === "win32" ? [0, 21, 42, 63] : ALL_MASKS;

let template = "";
before(() => {
  template = createTemplate();
});

/** True when any file under `dir` (binary included) holds the literal `${SKELETON_`. */
function placeholderHits(dir: string): string[] {
  const needle = Buffer.from("${SKELETON_");
  const hits: string[] = [];
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && fs.readFileSync(full).includes(needle)) hits.push(full);
    }
  };
  walk(dir);
  return hits;
}

describe(
  "G1 — every component subset scaffolds, renders and passes --check",
  { timeout: BUDGET_MS },
  () => {
    for (const mask of MASKS) {
      const selection = selectionOf(mask).split("\n").filter(Boolean);
      const label = `mask ${mask} (${selection.join(",") || "base-only"})`;
      test(`combinations::${label} scaffolds, has a manifest name, no placeholder, passes --check`, () => {
        const root = cloneTemplate(template);
        const scaffold = runEntry(
          root,
          "create-extension.ts",
          [`--components=${selection.join(",")}`],
          { NAME: `combo${mask}`, TIER: "org" },
        );
        assert.equal(scaffold.status, 0, `scaffold failed:\n${scaffold.combined}`);

        // G1 manifest: the name is read from the produced manifest, never assumed from NAME.
        const manifest = path.join(extDir(root, `combo${mask}`, "org"), "extension.json");
        assert.ok(fs.existsSync(manifest), "no extension.json produced");
        const realName = (JSON.parse(fs.readFileSync(manifest, "utf8")) as { name: string }).name;
        assert.equal(typeof realName, "string");

        // G1 placeholders: a recursive sweep over every file, binary included.
        assert.deepEqual(placeholderHits(path.dirname(manifest)), []);

        // G1 check: ONE combined --check, never a preceding `--target all`: that would leave
        // dist-claude-plugin/ in the extension source and make --check charge it as an
        // undeclared tool-designated file, a false failure of the test's own making. --check's
        // own RENDER-FAIL arm already forces a fresh render.
        const res = check(root, realName);
        assert.equal(res.status, 0, `--check failed:\n${res.combined}`);
      });
    }
  },
);

describe(
  "shim — the Bash forwarder on the env channel ignores a stub fzf",
  { skip: process.platform === "win32" ? "POSIX shim" : false, timeout: BUDGET_MS },
  () => {
    test("combinations::mask 63 through the shim with CREWRIG_TEST_FZF_SELECTION", () => {
      const root = cloneTemplate(template);
      const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "fzf-stub-"));
      after(() => fs.rmSync(stubDir, { recursive: true, force: true }));
      const stub = path.join(stubDir, "fzf");
      fs.writeFileSync(stub, "#!/bin/sh\ncat >/dev/null\nprintf 'mcp-server'\n");
      fs.chmodSync(stub, 0o755);
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        LC_ALL: "C",
        GIT_CONFIG_NOSYSTEM: "1",
        NAME: "combo63",
        TIER: "org",
        CREWRIG_TEST_FZF_SELECTION: selectionOf(63),
        PATH: `${stubDir}${path.delimiter}${process.env["PATH"] ?? ""}`,
      };
      delete env["CI"];
      delete env["NODE_TEST_CONTEXT"];
      const shim = path.join("scripts", `create-extension${".sh"}`);
      const run = spawnSync("bash", [shim], { cwd: root, encoding: "utf8", env });
      assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
      // All six components were added: the env selection won, the stub was not consulted.
      for (const comp of selectionOf(63).split("\n"))
        assert.ok(`${run.stdout}${run.stderr}`.includes(`Added: ${comp}`), `missing ${comp}`);
      const res = check(root, "combo63");
      assert.equal(res.status, 0, res.combined);
    });
  },
);
