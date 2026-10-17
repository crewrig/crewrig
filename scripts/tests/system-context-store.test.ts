// system-context-store.test.ts — content guards of the user-space system-context store (spec 0068,
// ported from test-system-context-store.sh groups 1, 3 and 4(c); spec 0263 row C). Pure reads of
// the committed files: no spawn, all platforms. The install_dir half lives in
// system-context-install-dir-common-sh.test.ts; the declared store guidance is pinned by
// setup-retarget-others.test.ts and the no-durable-trust-write runs by
// setup-retarget-gemini-copilot-run.test.ts.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { REPO } from "./lib/build-fixture-tree.ts";

const STORE = path.join(REPO, "artifacts", "core", "system-context");
const TOOLS = fs.readFileSync(path.join(REPO, "artifacts", "core", "rules", "60-tools.md"), "utf8");
const storeFiles = fs
  .readdirSync(STORE, { withFileTypes: true })
  .filter((e) => e.isFile() && e.name.endsWith(".md"))
  .map((e) => e.name)
  .sort();

describe("zero rule loss (stub to store)", () => {
  it("has non-empty store files", () => {
    assert.ok(storeFiles.length > 0, `no *.md files in ${STORE}`);
    for (const name of storeFiles) {
      assert.ok(fs.statSync(path.join(STORE, name)).size > 0, `empty store file: ${name}`);
    }
  });

  it("resolves every stub reference of 60-tools.md to a non-empty store file", () => {
    const refs = [
      ...new Set(
        (TOOLS.match(/~\/\.crewrig\/system-context\/[A-Za-z0-9._-]+\.md/g) ?? []).map((r) =>
          path.posix.basename(r),
        ),
      ),
    ];
    assert.ok(refs.length > 0, "no store references found in 60-tools.md");
    for (const ref of refs) {
      const file = path.join(STORE, ref);
      assert.ok(fs.existsSync(file) && fs.statSync(file).size > 0, `missing/empty: ${ref}`);
    }
  });

  it("leaves no orphan store file (every one is referenced by a stub)", () => {
    for (const name of storeFiles) {
      assert.ok(TOOLS.includes(`system-context/${name}`), `orphan store file: ${name}`);
    }
  });
});

describe("retrieval protocol presence", () => {
  const lower = TOOLS.toLowerCase();
  it("documents the retrieval section, direct read, optional enhancement, explicit signal", () => {
    assert.ok(TOOLS.includes("## Retrieving the system-context store"), "section heading (R2)");
    assert.ok(lower.includes("direct file read"), "direct-read default (R2)");
    assert.ok(lower.includes("optional enhancement"), "MemPalace optional enhancement (R3)");
    assert.ok(lower.includes("explicit signal"), "explicit-signal fallback (R4)");
  });

  it("carries the Session Start store-mirror step", () => {
    assert.ok(TOOLS.includes("System-context store mirror"));
  });
});

describe("no durable trust write: delegation stays non-vacuous", () => {
  it("keeps the two test titles the delegation relies on", () => {
    const run = fs.readFileSync(
      path.join(REPO, "scripts", "tests", "setup-retarget-gemini-copilot-run.test.ts"),
      "utf8",
    );
    const others = fs.readFileSync(
      path.join(REPO, "scripts", "tests", "setup-retarget-others.test.ts"),
      "utf8",
    );
    assert.ok(run.includes("no durable trust write"));
    assert.ok(others.includes("storeGuidance is declared true on gemini and copilot only"));
  });
});
