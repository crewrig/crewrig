// install-claude-plugin-marketplace.test.ts — end-to-end regression of install-claude-plugin
// (spec 0045, shared plugin marketplace), ported from test-install-claude-plugin-marketplace.sh
// (spec 0263 row C). The shared registry lives in ${CLAUDE_CONFIG_DIR}/local-marketplace/ with one
// marketplace.json that upserts each extension by name. The real extension
// extensions/core/hello-world is the subject; `claude` is a stub recording its argv.
//
// Cases -> spec 0045 scenarios:
//   1. Out-of-tree location          -> R4 + "survives a branch switch"
//   2. Coexistence / upsert          -> R1 + R2 + "two extensions coexist"
//   3. Idempotent re-install         -> R5
//   4. Failed install leaves registry intact
// POSIX only: the stub `claude` is a shell shim reached through bash scripts/install-claude-plugin.sh.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";

import { REPO } from "./lib/build-fixture-tree.ts";
import { createHermeticEnv, writeStub } from "./lib/hermetic-env.ts";
import type { HermeticEnv } from "./lib/hermetic-env.ts";

const SUBJECT = "hello-world";
const SEED = {
  name: "seeded-local",
  owner: { name: "crewrig contributors" },
  plugins: [
    {
      name: "other-ext",
      description: "Synthetic prior install",
      author: { name: "seed" },
      source: "./other-ext",
    },
  ],
};

const live: HermeticEnv[] = [];
after(() => live.forEach((h) => h.dispose()));

interface Rig {
  readonly h: HermeticEnv;
  readonly config: string;
  readonly manifest: string;
  readonly argvLog: string;
}

function rig(): Rig {
  const h = createHermeticEnv({ poisonPython: false });
  live.push(h);
  const argvLog = path.join(h.root, "claude-argv");
  writeStub(h, "claude", `printf '%s\\n' "$*" >> '${argvLog}'\nexit 0\n`);
  const config = path.join(h.root, "cfg");
  fs.mkdirSync(config);
  const manifest = path.join(config, "local-marketplace", ".claude-plugin", "marketplace.json");
  return { h, config, manifest, argvLog };
}

function seed(r: Rig): void {
  fs.mkdirSync(path.dirname(r.manifest), { recursive: true });
  fs.writeFileSync(r.manifest, `${JSON.stringify(SEED, null, 2)}\n`);
}

function install(r: Rig, ext: string): number | null {
  const res = spawnSync("bash", [path.join(REPO, "scripts", "install-claude-plugin.sh"), ext], {
    encoding: "utf8",
    cwd: REPO,
    env: { ...r.h.env, CLAUDE_CONFIG_DIR: r.config, LC_ALL: "C" },
  });
  return res.status;
}

function names(manifest: string): string[] {
  const doc = JSON.parse(fs.readFileSync(manifest, "utf8")) as { plugins: { name: string }[] };
  return doc.plugins.map((p) => p.name);
}

const sha256 = (file: string): string =>
  crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

/** Every `dist-claude-plugin` directory under the repository (not descending into .git or node_modules). */
function strayDirs(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name === ".git" || e.name === "node_modules") continue;
      const full = path.join(dir, e.name);
      if (e.name === "dist-claude-plugin") found.push(full);
      walk(full);
    }
  };
  walk(REPO);
  return found.sort();
}

describe(
  "install-claude-plugin shared marketplace (spec 0045)",
  {
    skip: process.platform === "win32" && "POSIX only: stub claude is a shell shim",
  },
  () => {
    it("case 1: installs out of tree, without a repository build directory (R4)", () => {
      const r = rig();
      const before = strayDirs();
      assert.equal(install(r, SUBJECT), 0);
      assert.ok(fs.statSync(r.manifest).isFile(), `manifest missing at ${r.manifest}`);
      assert.ok(names(r.manifest).includes(SUBJECT));
      assert.deepEqual(strayDirs(), before, "dist-claude-plugin appeared in the repository");
      const argv = fs.readFileSync(r.argvLog, "utf8");
      assert.ok(
        argv.includes(`plugin marketplace add ${path.join(r.config, "local-marketplace")}`),
        argv,
      );
    });

    it("case 2: a prior entry survives and the new one is listed (R1, R2)", () => {
      const r = rig();
      seed(r);
      assert.equal(install(r, SUBJECT), 0);
      const listed = names(r.manifest);
      assert.ok(listed.includes("other-ext"), "prior entry lost");
      assert.ok(listed.includes(SUBJECT), "new entry missing");
    });

    it("case 3: re-installing is idempotent (R5)", () => {
      const r = rig();
      assert.equal(install(r, SUBJECT), 0);
      assert.equal(install(r, SUBJECT), 0);
      assert.equal(names(r.manifest).filter((n) => n === SUBJECT).length, 1);
    });

    it("case 4: a failed install leaves the registry byte-identical", () => {
      const r = rig();
      seed(r);
      const before = sha256(r.manifest);
      assert.notEqual(install(r, "definitely-not-an-extension"), 0);
      assert.equal(sha256(r.manifest), before);
    });
  },
);
