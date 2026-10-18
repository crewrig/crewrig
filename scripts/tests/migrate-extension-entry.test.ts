// migrate-extension-entry.test.ts — the migration tool and the reader through the real entries
// (`node scripts/migrate-extension.ts`, `node scripts/build-extension.ts --check`) in a sandbox
// per case: C1..C4 plus the forwarding shim. Replaces scripts/tests/test-migrate-extension.sh
// (spec 0265, row J2). `jq` and `cksum` become `JSON.parse` and a sha256 map of the whole tree.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { before, describe, test } from "node:test";

import {
  check,
  cloneTemplate,
  createTemplate,
  extDir,
  runEntry,
  treeDigest,
  writeFile,
  writeManifest,
} from "./lib/extension-sandbox.ts";

let template = "";
before(() => {
  template = createTemplate();
});

function migrate(root: string, dir: string) {
  return runEntry(root, "migrate-extension.ts", [dir]);
}

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
}

/** C1 fixture: enabled `components` AND per-CLI keys, not a minimal manifest. */
function oldShape(root: string): string {
  const dir = writeManifest(root, "oldshape", {
    name: "oldshape",
    version: "0.1.0",
    description: "fixture",
    components: {
      commands: { enabled: true, location: "commands/" },
      skills: { enabled: false, location: "skills/" },
      agents: { enabled: true, location: "agents/" },
      hooks: { enabled: false, location: "hooks/" },
    },
    claude: {
      author: { name: "test" },
      skills: ["skills/*/SKILL.md"],
      agents: [],
      rules: [],
      defaultAllowedTools: [],
    },
    copilot: { pluginName: "oldshape" },
    antigravity: { pluginName: "oldshape" },
  });
  writeFile(
    root,
    "extensions/core/oldshape/commands/hello.md",
    '---\nname: hello\ndescription: "hello command"\ntype: command\n---\nHello.\n',
  );
  writeFile(
    root,
    "extensions/core/oldshape/agents/demo/AGENT.md",
    '---\nname: demo\ndescription: "demo agent"\ntype: agent\n---\nDemo.\n',
  );
  return dir;
}

describe("C1 — conversion produces a tree that passes --check", () => {
  test("C1 (a) — migration exits 0 on an old-shape manifest with per-CLI keys", () => {
    const root = cloneTemplate(template);
    const dir = oldShape(root);
    const res = migrate(root, dir);
    assert.equal(res.status, 0, res.combined);
    const manifest = readJson(path.join(dir, "extension.json"));
    assert.equal("components" in manifest, false);
  });

  test("C1 (b) — the converted tree passes 'build-extension --check' from the sandbox root", () => {
    const root = cloneTemplate(template);
    const dir = oldShape(root);
    assert.equal(migrate(root, dir).status, 0);
    const res = check(root, "oldshape");
    assert.equal(res.status, 0, res.combined);
  });
});

describe("C2 — idempotence", () => {
  test("C2 (a) — a second run exits 0 and reports already migrated", () => {
    const root = cloneTemplate(template);
    const dir = oldShape(root);
    assert.equal(migrate(root, dir).status, 0);
    const again = migrate(root, dir);
    assert.equal(again.status, 0, again.combined);
    assert.match(again.combined, /already migrated/i);
  });

  test("C2 (b) — a second run leaves the tree byte-identical (path set and sha256)", () => {
    const root = cloneTemplate(template);
    const dir = oldShape(root);
    assert.equal(migrate(root, dir).status, 0);
    const before = treeDigest(dir);
    assert.equal(migrate(root, dir).status, 0);
    assert.deepEqual(treeDigest(dir), before);
  });
});

describe("C3 — an unconvertible form fails loudly and preserves the tree", () => {
  test("C3 — rc != 0, tree byte-identical, stderr names the conflict", () => {
    const root = cloneTemplate(template);
    const dir = writeManifest(root, "conflict", {
      name: "conflict",
      version: "0.1.0",
      description: "fixture: components.commands.enabled=true AND a top-level commands section",
      commands: { location: "commands/" },
      components: { commands: { enabled: true, location: "commands/", convertToSkills: true } },
    });
    const before = treeDigest(dir);
    const res = migrate(root, dir);
    assert.notEqual(res.status, 0, res.combined);
    assert.deepEqual(treeDigest(dir), before);
    assert.match(res.combined, /conflicts with an existing top-level 'commands' section/);
  });
});

describe("C4 — R12 growth mutation: one enumeration read by the reader and the tool", () => {
  const key = "claude.syntheticGrowthKey";

  function grown(): { root: string; dir: string } {
    const root = cloneTemplate(template);
    const shapeFile = path.join(root, "scripts", "lib", "extension-legacy-shape.json");
    const shape = readJson(shapeFile) as { perCliKeys: string[] };
    shape.perCliKeys.push(key);
    fs.writeFileSync(shapeFile, `${JSON.stringify(shape)}\n`);
    // Admit the key as per-CLI so the unrelated inadmissible-key check cannot be the failure.
    const allowFile = path.join(root, "scripts", "lib", "extension-percli-keys.json");
    const allow = JSON.parse(fs.readFileSync(allowFile, "utf8")) as unknown[];
    allow.push({ key, reason: "cli-only-concept", evidence: "test fixture" });
    fs.writeFileSync(allowFile, `${JSON.stringify(allow)}\n`);
    const dir = writeManifest(root, "growth", {
      name: "growth",
      version: "0.1.0",
      description: "fixture carrying the synthetic growth-mutation key",
      claude: {
        author: { name: "test" },
        syntheticGrowthKey: "should be rejected and stripped",
        defaultAllowedTools: [],
      },
    });
    return { root, dir };
  }

  test("C4 (reader) — --check fails a manifest carrying the grown key, with the shape diagnostic", () => {
    const { root } = grown();
    const res = check(root, "growth");
    assert.notEqual(res.status, 0, res.combined);
    assert.match(res.combined, /VALIDATION-ERROR/);
    assert.match(res.combined, /syntheticGrowthKey/);
  });

  test("C4 (tool) — migration exits 0 and strips the grown key with no code change", () => {
    const { root, dir } = grown();
    const res = migrate(root, dir);
    assert.equal(res.status, 0, res.combined);
    const claude = (readJson(path.join(dir, "extension.json"))["claude"] ?? {}) as object;
    assert.equal(Object.hasOwn(claude, "syntheticGrowthKey"), false);
  });
});

describe(
  "shim — the forwarding script reaches the same result as C1",
  { skip: process.platform === "win32" },
  () => {
    test("C1 through the Bash shim exits 0 and the tree passes --check", () => {
      const root = cloneTemplate(template);
      const dir = oldShape(root);
      const env: NodeJS.ProcessEnv = { ...process.env, LC_ALL: "C", GIT_CONFIG_NOSYSTEM: "1" };
      delete env["CI"];
      delete env["NODE_TEST_CONTEXT"];
      const shim = path.join("scripts", `migrate-extension${".sh"}`);
      const run = spawnSync("bash", [shim, dir], { cwd: root, encoding: "utf8", env });
      assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
      assert.equal(check(root, "oldshape").status, 0);
      assert.equal(fs.existsSync(extDir(root, "oldshape")), true);
    });
  },
);
