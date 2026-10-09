// extension-migrate.test.ts — the migration tool, migrateExtension (spec 0254 R20).

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import { migrateExtension } from "../lib/extension/migrate.ts";

const LIB = path.resolve(import.meta.dirname, "../lib");
const scratch: string[] = [];

function tmp(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ext-migrate-")));
  scratch.push(dir);
  return dir;
}

after(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

function put(root: string, rel: string, text: string): void {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
}

function run(dir: string, libDir = LIB) {
  const out: string[] = [];
  const err: string[] = [];
  const io = {
    out: (l: string) => void out.push(l),
    err: (l: string) => void err.push(l),
    errRaw: (t: string) => void err.push(t),
  };
  const status = migrateExtension({ repoDir: path.dirname(dir), libDir, io }, dir);
  return { status, out, err };
}

function checksum(root: string): string {
  const h = createHash("sha256");
  const walk = (rel: string): void => {
    for (const name of fs.readdirSync(path.join(root, rel)).sort()) {
      const r = rel === "" ? name : `${rel}/${name}`;
      h.update(r);
      if (fs.statSync(path.join(root, r)).isDirectory()) walk(r);
      else h.update(fs.readFileSync(path.join(root, r)));
    }
  };
  walk("");
  return h.digest("hex");
}

function ext(manifest: unknown): string {
  const dir = path.join(tmp(), "my-ext");
  put(dir, "extension.json", JSON.stringify(manifest));
  return dir;
}

describe("migrateExtension", () => {
  it("converts components, drops per-CLI keys, de-commits generated files, then reports migrated", () => {
    const dir = ext({
      name: "e",
      components: { skills: { enabled: true, location: "s" }, hooks: { enabled: false } },
      claude: { skills: "x" },
      gemini: { keep: 1 },
    });
    put(dir, "CLAUDE.md", "generated");
    put(dir, "commands/a.toml", "x");
    put(dir, "commands/sub/b.toml", "stays");
    put(dir, "skills/real/SKILL.md", "stays");
    const first = run(dir);
    assert.equal(first.status, 0);
    assert.deepEqual(first.out, [
      `Migrated: ${dir}`,
      "  - converted the retired 'components' object to generic top-level sections",
      "  - dropped retired per-CLI keys: claude.skills",
      "  - de-committed generated-output-class file(s): CLAUDE.md commands/a.toml",
    ]);
    assert.equal(
      fs.readFileSync(`${dir}/extension.json`, "utf8"),
      '{\n  "name": "e",\n  "gemini": {\n    "keep": 1\n  },\n  "skills": {\n    "location": "s"\n  }\n}\n',
    );
    assert.equal(fs.existsSync(`${dir}/CLAUDE.md`), false);
    assert.equal(fs.existsSync(`${dir}/commands/a.toml`), false);
    assert.equal(fs.existsSync(`${dir}/commands/sub/b.toml`), true);
    assert.equal(fs.existsSync(`${dir}/skills/real/SKILL.md`), true);
    const second = run(dir);
    assert.equal(second.status, 0);
    assert.deepEqual(second.out, [
      `Already migrated: ${dir} carries none of the retired declaration forms.`,
    ]);
  });

  it("leaves the tree byte-unchanged and exits 1 on a conflict", () => {
    const dir = ext({
      name: "e",
      skills: { location: "top" },
      components: { skills: { enabled: true }, agents: { enabled: true } },
      claude: { agents: "x" },
    });
    put(dir, "CLAUDE.md", "generated");
    const before = checksum(dir);
    const r = run(dir);
    assert.equal(r.status, 1);
    assert.deepEqual(r.out, []);
    assert.deepEqual(r.err, [
      `Error: ${dir} could not be fully converted; the source tree was left unchanged.`,
      "  - components.skills (enabled) conflicts with an existing top-level 'skills' section",
    ]);
    assert.equal(checksum(dir), before);
  });

  it("de-commits a tree that carries only generated files, leaving the manifest bytes", () => {
    const text = '{"name":"e"}';
    const dir = path.join(tmp(), "gen");
    put(dir, "extension.json", text);
    put(dir, "hooks/hooks.json", "{}");
    put(dir, "skills/x-context/SKILL.md", "g");
    const r = run(dir);
    assert.equal(r.status, 0);
    assert.equal(
      r.out[1],
      "  - de-committed generated-output-class file(s): hooks/hooks.json skills/x-context/SKILL.md",
    );
    assert.equal(fs.readFileSync(`${dir}/extension.json`, "utf8"), text);
    assert.equal(fs.existsSync(`${dir}/hooks`), true);
  });

  it("fails when the legacy-shape enumeration is missing, before reading the extension", () => {
    const lib = tmp();
    const r = run("/nonexistent", lib);
    assert.equal(r.status, 1);
    assert.deepEqual(r.err, [
      `Error: legacy-shape enumeration not found at ${lib}/extension-legacy-shape.json (spec 0183 R12).`,
    ]);
  });

  it("reports a missing manifest", () => {
    const empty = path.join(tmp(), "nomanifest");
    fs.mkdirSync(empty);
    assert.deepEqual(run(empty).err, [
      `Error: No extension.json found in ${empty} — nothing to migrate.`,
    ]);
  });
});
