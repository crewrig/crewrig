// build-extension-suite-check.test.ts — the `--check` arms of the render entry through the real
// `node scripts/build-extension.ts` in a sandbox: Cases 6a-f, 7, 9a-c, 10a-b, 11(i) and 11(ii).
// Replaces scripts/tests/test-build-extension.sh (cases 6, 7, 9-11).
//
// The sub-cases of 6 and 10 are cumulative by design: sequential tests over one sandbox.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { before, describe, test } from "node:test";

import {
  check,
  cloneTemplate,
  createTemplate,
  fixtureManifest,
  realSkeletonScan,
  runEntry,
  writeFile,
  writeManifest,
} from "./lib/extension-sandbox.ts";

let template = "";
before(() => {
  template = createTemplate();
});

const has = (text: string, ...needles: string[]): void => {
  for (const needle of needles) assert.ok(text.includes(needle), `missing ${needle} in:\n${text}`);
};

describe("Case 6 — COMMITTED fires on a generated-output-class file, with a paired negative", () => {
  let root = "";
  let fix = "";
  let skeleton = "";
  before(() => {
    root = cloneTemplate(template);
    fix = writeManifest(root, "committedfix", fixtureManifest("committedfix"));
    skeleton = path.join(root, "extension-skeleton");
  });
  const drop = (...files: string[]): void => {
    for (const file of files) fs.rmSync(file, { force: true, recursive: true });
  };

  test("Case 6a — a committed manifest_class member fails as COMMITTED, pointing away from regeneration", () => {
    writeFile(fix, "claude-extension.json", '{"name":"stray"}\n');
    const res = check(root, "committedfix");
    assert.notEqual(res.status, 0);
    has(res.combined, "COMMITTED", "claude-extension.json");
    assert.ok(!/regenerat/i.test(res.combined), res.combined);
    drop(path.join(fix, "claude-extension.json"));
  });

  for (const file of ["CLAUDE.md", "GEMINI.md", "copilot-instructions.md"]) {
    test(`Case 6b (${file}) — a committed per-CLI context file fails as COMMITTED, class membership`, () => {
      writeFile(fix, file, "context\n");
      const res = check(root, "committedfix");
      assert.notEqual(res.status, 0);
      has(res.combined, "COMMITTED", file);
      drop(path.join(fix, file));
    });
  }

  test("Case 6b (rules/AGENTS.md) — a committed root-anchored Antigravity context file fails as COMMITTED", () => {
    writeFile(fix, "rules/AGENTS.md", "context\n");
    const res = check(root, "committedfix");
    assert.notEqual(res.status, 0);
    has(res.combined, "COMMITTED", "rules/AGENTS.md");
    drop(path.join(fix, "rules"));
  });

  test("Case 6b (.geminiignore) — a committed .geminiignore fails as COMMITTED on the name axis", () => {
    writeFile(fix, ".geminiignore", "*.md\n");
    const res = check(root, "committedfix");
    assert.notEqual(res.status, 0);
    has(res.combined, "COMMITTED", ".geminiignore");
    drop(path.join(fix, ".geminiignore"));
  });

  test("Case 6b (accepted-gaps.json) — stays green: outside BOTH the class-membership and the name-axis charge", () => {
    writeFile(fix, "accepted-gaps.json", "[]\n");
    const res = check(root, "committedfix");
    assert.equal(res.status, 0, res.combined);
    has(res.combined, "OK   COMMITTED");
    drop(path.join(fix, "accepted-gaps.json"));
  });

  test("Case 6c (mutation 1) — a tool-designated file with no generating declaration turns the capability red", () => {
    writeFile(fix, "antigravity-notes.md", "notes\n");
    const res = check(root, "committedfix");
    assert.notEqual(res.status, 0);
    has(res.combined, "COMMITTED", "antigravity-notes.md");
    drop(path.join(fix, "antigravity-notes.md"));
  });

  test("Case 6d (mutation 2) — the same file committed into extension-skeleton/ also turns it red", () => {
    writeFile(skeleton, "antigravity-notes.md", "notes\n");
    const res = check(root, "committedfix");
    assert.notEqual(res.status, 0);
    has(res.combined, "COMMITTED extension-skeleton", "antigravity-notes.md");
    drop(path.join(skeleton, "antigravity-notes.md"));
  });

  test("Case 6e (mutation 3, near-miss) — regeminate.md (substring, not prefix) stays green in both locations", () => {
    writeFile(fix, "regeminate.md", "notes\n");
    writeFile(skeleton, "regeminate.md", "notes\n");
    const res = check(root, "committedfix");
    assert.equal(res.status, 0, res.combined);
    has(res.combined, "OK   COMMITTED committedfix", "OK   COMMITTED extension-skeleton");
    drop(path.join(fix, "regeminate.md"), path.join(skeleton, "regeminate.md"));
  });

  test("Case 6f (mutation 4, growth) — a file bearing a synthetic 5th target-descriptor token is charged", () => {
    const targets = path.join(root, "scripts", "lib", "extension-targets.json");
    const parsed = JSON.parse(fs.readFileSync(targets, "utf8")) as Record<string, unknown>;
    fs.writeFileSync(targets, JSON.stringify({ ...parsed, syntheticcli: { shellTool: "x" } }));
    writeFile(fix, "syntheticcli-notes.md", "notes\n");
    const res = check(root, "committedfix");
    assert.notEqual(res.status, 0);
    has(res.combined, "COMMITTED", "syntheticcli-notes.md");
  });
});

describe("Case 7 — a stale declared gap fails GAP-STALE", () => {
  test("Case 7 — an accepted gap the render no longer observes fails as GAP-STALE", () => {
    const root = cloneTemplate(template);
    const dir = writeManifest(root, "stalegap", fixtureManifest("stalegap"));
    writeFile(
      dir,
      "accepted-gaps.json",
      '[{"subject":"context","target":"gemini","reason":"accepted for the fixture"}]\n',
    );
    const res = check(root, "stalegap");
    assert.notEqual(res.status, 0);
    has(res.combined, "GAP-STALE", "context@gemini");
  });
});

describe("Case 9 — no subject declared stays valid; the retired shape fails loudly", () => {
  let root = "";
  before(() => {
    root = cloneTemplate(template);
  });

  test("Case 9a — an extension declaring no subject at all still renders/checks cleanly", () => {
    writeManifest(root, "bare", fixtureManifest("bare"));
    const res = check(root, "bare");
    assert.equal(res.status, 0, res.combined);
  });

  test("Case 9b — an old-shape manifest (retired 'components' object) fails loudly, naming scripts/migrate-extension.sh", () => {
    writeManifest(
      root,
      "strayhooks",
      fixtureManifest("strayhooks", {
        components: { hooks: { enabled: true, location: "hooks/" } },
      }),
    );
    const res = check(root, "strayhooks");
    assert.notEqual(res.status, 0);
    has(res.combined, "migrate-extension.sh");
  });

  test("Case 9c — a tree carrying only gemini-extension.json fails, naming scripts/migrate-extension.sh", () => {
    const dir = path.join(root, "extensions", "core", "geminionly");
    writeFile(
      dir,
      "gemini-extension.json",
      '{"name":"geminionly","version":"0.0.1","description":"fixture"}\n',
    );
    const out = path.join(root, "dist-claude-plugin", "geminionly");
    const res = runEntry(root, "build-claude-plugin.ts", [dir, out]);
    assert.notEqual(res.status, 0);
    has(res.combined, "migrate-extension.sh");
  });
});

describe("Case 10 — the guard tracks the declared set, not a fixed file list", () => {
  let root = "";
  let dir = "";
  const command = (name: string): string =>
    `---\nname: ${name}\ndescription: "${name} command"\ntype: command\n---\n${name[0]?.toUpperCase()}${name.slice(1)}.\n`;
  before(() => {
    root = cloneTemplate(template);
    dir = writeManifest(
      root,
      "grow",
      fixtureManifest("grow", { commands: { location: "commands/" } }),
    );
    writeFile(dir, "commands/first.md", command("first"));
  });

  test("Case 10a — baseline (one command) is clean", () => {
    const res = check(root, "grow");
    assert.equal(res.status, 0, res.combined);
  });

  test("Case 10b — adding a second pivot stays clean after a real render", () => {
    writeFile(dir, "commands/second.md", command("second"));
    const res = check(root, "grow");
    assert.equal(res.status, 0, res.combined);
  });
});

describe("Case 11 — R16, two arms because they certify different claims", () => {
  test("Case 11(i) — a restored .github/copilot/extension.json inside an extension fails as COMMITTED", () => {
    const root = cloneTemplate(template);
    const dir = writeManifest(root, "r16fix", fixtureManifest("r16fix"));
    writeFile(dir, ".github/copilot/extension.json", '{"name":"r16fix","version":"0.0.1"}\n');
    const res = check(root, "r16fix");
    assert.notEqual(res.status, 0);
    has(res.combined, "COMMITTED", ".github/copilot/extension.json");
  });

  test("Case 11(ii) — no file under extension-skeleton/ matches manifest_class at a component-dir root or generated_globs anywhere", () => {
    const scan = realSkeletonScan();
    assert.ok(scan.componentDirs > 0, "no skeleton component dir was scanned");
    assert.ok(scan.classEntries > 0, "no manifest_class entry was read");
    assert.deepEqual(scan.violations, []);
  });
});
