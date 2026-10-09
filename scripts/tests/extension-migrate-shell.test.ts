// extension-migrate-shell.test.ts — migrateExtension against the real scripts/migrate-extension.sh
// over fixture trees: same converted tree, stdout, stderr and status (spec 0254 R20, R22).
// Linux and macOS only; skipped when bash or jq is missing.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import { migrateExtension } from "../lib/extension/migrate.ts";
import { copyTree } from "../lib/extension/tree-copy.ts";

const REPO = path.resolve(import.meta.dirname, "../..");
const probe = (cmd: string): boolean => spawnSync(cmd, ["--version"]).error === undefined;
const skip =
  process.platform === "win32" || !probe("bash") || !probe("jq")
    ? "skipped: needs bash and jq on PATH"
    : false;
const scratch: string[] = [];

after(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

/** A mini repository: the shell tool and the descriptors it reads, nothing else. */
function miniRepo(): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ext-migrate-sh-")));
  scratch.push(root);
  fs.mkdirSync(`${root}/scripts/lib`, { recursive: true });
  fs.copyFileSync(`${REPO}/scripts/migrate-extension.sh`, `${root}/scripts/migrate-extension.sh`);
  for (const f of ["extension-legacy-shape.json", "extension-generated-class.json"])
    fs.copyFileSync(`${REPO}/scripts/lib/${f}`, `${root}/scripts/lib/${f}`);
  return root;
}

type Files = Record<string, string>;

const fixtures: Record<string, Files> = {
  "components and per-CLI keys and generated files": {
    "extension.json": JSON.stringify({
      name: "e",
      version: "1.0.0",
      components: {
        commands: { enabled: true, location: "cmds" },
        skills: { enabled: false },
        hooks: { enabled: true },
      },
      claude: { skills: "x", rules: "y", author: "me" },
      copilot: { pluginName: "p" },
      antigravity: { pluginName: "q" },
    }),
    "CLAUDE.md": "g",
    "GEMINI.md": "g",
    "commands/a.toml": "x",
    "commands/.hidden.toml": "dot",
    "commands/sub/c.toml": "nested",
    "hooks/hooks.json": "{}",
    "skills/a-context/SKILL.md": "g",
    "skills/a/SKILL.md": "keep",
    ".github/copilot/extension.json": "{}",
  },
  "only per-CLI keys": {
    "extension.json": '{ "name": "e", "claude": { "agents": "a" }, "gemini": { "x": 1 } }\n',
    "README.md": "r",
  },
  "conflict leaves the tree unchanged": {
    "extension.json": JSON.stringify({
      name: "e",
      agents: { location: "top" },
      components: { agents: { enabled: true }, skills: { enabled: true } },
      claude: { skills: "s" },
    }),
    "CLAUDE.md": "g",
  },
  "only generated files": {
    "extension.json": '{"name":"e",  "version":"1"}',
    "observed-gaps.json": "[]",
    "rules/AGENTS.md": "g",
    "skills/x-context/SKILL.md": "g",
  },
  "already migrated and non-object components": {
    "extension.json": JSON.stringify({ name: "e", skills: { location: "s" }, components: null }),
    "src/file.txt": "t",
  },
};

function lay(dir: string, files: Files): void {
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
}

describe("migrateExtension vs migrate-extension.sh", { skip }, () => {
  for (const [label, files] of Object.entries(fixtures)) {
    it(label, () => {
      const root = miniRepo();
      const a = path.join(root, "extensions/org/a");
      const b = path.join(root, "extensions/org/b");
      lay(a, files);
      copyTree(a, b);
      const sh = spawnSync("bash", [`${root}/scripts/migrate-extension.sh`, a], {
        encoding: "utf8",
      });
      const out: string[] = [];
      const err: string[] = [];
      const status = migrateExtension(
        {
          repoDir: root,
          libDir: `${root}/scripts/lib`,
          io: {
            out: (l) => void out.push(l),
            err: (l) => void err.push(l),
            errRaw: (t) => void err.push(t),
          },
        },
        b,
      );
      const norm = (s: string, dir: string): string => s.split(dir).join("<DIR>");
      const lines = (xs: string[]): string => xs.map((l) => `${l}\n`).join("");
      assert.equal(status, sh.status);
      assert.equal(norm(lines(out), b), norm(sh.stdout, a));
      assert.equal(norm(lines(err), b), norm(sh.stderr, a));
      const diff = spawnSync("diff", ["-r", a, b], { encoding: "utf8" });
      assert.equal(diff.status, 0, diff.stdout);
    });
  }
});
