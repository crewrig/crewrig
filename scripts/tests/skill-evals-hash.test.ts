// skill-evals-hash.test.ts — the content hash (spec 0290 R32, R35, R25).

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { contentHash, installedContentHash, installFiles, readRevision, readWorkingTree } from "../lib/skill-evals/hash.ts";
import type { Snapshot } from "../lib/skill-evals/hash.ts";
import { commitAll, makeRepo, skillRel, tmpDir, writeSkill } from "./lib/skill-evals-fixtures.ts";
import type { Repo } from "./lib/skill-evals-fixtures.ts";

const hashOf = (repo: Repo, name = "demo"): string => {
  const s = readWorkingTree(repo.root, skillRel(name));
  assert.equal(s.kind, "ok", JSON.stringify(s));
  return contentHash((s as Extract<Snapshot, { kind: "ok" }>).files);
};
const installedOf = (repo: Repo): string => installedContentHash((readWorkingTree(repo.root, skillRel("demo")) as Extract<Snapshot, { kind: "ok" }>).files);
const withRepo = (f: (repo: Repo) => void) => {
  const repo = makeRepo();
  try {
    writeSkill(repo, "demo");
    commitAll(repo, "base");
    f(repo);
  } finally {
    repo.cleanup();
  }
};

test("fixed vector: path NUL flag NUL size NUL bytes NUL, sorted by UTF-8 bytes", () => {
  withRepo((repo) => {
    const snap = readWorkingTree(repo.root, skillRel("demo")) as Extract<Snapshot, { kind: "ok" }>;
    const h = createHash("sha256");
    const records = [
      ["SKILL.md", "0"],
      ["evals/evals.json", "0"],
      ["references/ref.md", "0"],
      ["scripts/run.sh", "1"],
    ] as const;
    for (const [rel, flag] of records) {
      const bytes = fs.readFileSync(path.join(repo.root, skillRel("demo"), rel));
      h.update(Buffer.concat([Buffer.from(rel), Buffer.from([0]), Buffer.from(flag), Buffer.from([0]), Buffer.from(String(bytes.length)), Buffer.from([0]), bytes, Buffer.from([0])]));
    }
    assert.equal(contentHash(snap.files), `sha256:${h.digest("hex")}`);
    assert.match(contentHash(snap.files), /^sha256:[0-9a-f]{64}$/);
  });
});

test("one byte, an added, a deleted and a renamed hashed file change the hash; unhashed files do not", () => {
  withRepo((repo) => {
    const base = hashOf(repo);
    const dir = path.join(repo.root, skillRel("demo"));
    fs.writeFileSync(path.join(dir, "references", "ref.md"), "referencf\n");
    repo.git("add", "-A");
    const h1 = hashOf(repo);
    assert.notEqual(h1, base);
    fs.writeFileSync(path.join(dir, "references", "ref.md"), "reference\n");
    assert.equal(hashOf(repo), base);
    fs.writeFileSync(path.join(dir, "assets-new.txt"), "x");
    fs.mkdirSync(path.join(dir, "assets"));
    fs.writeFileSync(path.join(dir, "assets", "a.txt"), "x");
    repo.git("add", "-A");
    const added = hashOf(repo);
    assert.notEqual(added, base);
    repo.git("mv", `${skillRel("demo")}/assets/a.txt`, `${skillRel("demo")}/assets/b.txt`);
    assert.notEqual(hashOf(repo), added);
    repo.git("rm", "-q", "-f", `${skillRel("demo")}/assets/b.txt`);
    assert.equal(hashOf(repo), base);
    // unhashed: results.json, evals/files, a stray notes.md
    fs.writeFileSync(path.join(dir, "evals", "results.json"), "{}");
    fs.writeFileSync(path.join(dir, "notes.md"), "n");
    fs.writeFileSync(path.join(dir, "evals", "files", "in.txt"), "changed");
    repo.git("add", "-A");
    assert.equal(hashOf(repo), base);
  });
});

test("the installed-content hash ignores evals/evals.json and follows every other change", () => {
  withRepo((repo) => {
    const dir = path.join(repo.root, skillRel("demo"));
    const inst = installedOf(repo);
    const full = hashOf(repo);
    fs.writeFileSync(path.join(dir, "evals", "evals.json"), "{\"changed\":true}\n");
    repo.git("add", "-A");
    assert.equal(installedOf(repo), inst);
    assert.notEqual(hashOf(repo), full);
    fs.writeFileSync(path.join(dir, "scripts", "run.sh"), "#!/bin/sh\necho changed\n");
    repo.git("add", "-A");
    assert.notEqual(installedOf(repo), inst);
  });
});

test("the git index mode is hashed; the filesystem mode and core.fileMode are not", () => {
  withRepo((repo) => {
    const base = hashOf(repo);
    const inst = installedOf(repo);
    const file = path.join(repo.root, skillRel("demo"), "scripts", "run.sh");
    fs.chmodSync(file, 0o644); // filesystem permission change, index mode untouched
    assert.equal(hashOf(repo), base);
    repo.git("config", "core.fileMode", "false");
    assert.equal(hashOf(repo), base);
    repo.git("config", "core.fileMode", "true");
    repo.git("update-index", "--chmod=-x", `${skillRel("demo")}/scripts/run.sh`);
    assert.notEqual(hashOf(repo), base);
    assert.notEqual(installedOf(repo), inst);
    repo.git("update-index", "--chmod=+x", `${skillRel("demo")}/scripts/run.sh`);
    assert.equal(hashOf(repo), base);
  });
});

test("the hash equals the same content read from a git revision, whatever the creation order", () => {
  withRepo((repo) => {
    const head = repo.git("rev-parse", "HEAD").trim();
    const rev = readRevision(repo.root, head, skillRel("demo")) as Extract<Snapshot, { kind: "ok" }>;
    assert.equal(contentHash(rev.files), hashOf(repo));
    const other = makeRepo();
    try {
      // same files created in the opposite order
      const files = ["scripts/run.sh", "references/ref.md", "evals/evals.json", "SKILL.md"];
      for (const f of files) {
        const abs = path.join(other.root, skillRel("demo"), f);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.copyFileSync(path.join(repo.root, skillRel("demo"), f), abs);
      }
      other.git("add", "-A");
      other.git("update-index", "--chmod=+x", `${skillRel("demo")}/scripts/run.sh`);
      assert.equal(hashOf(other), hashOf(repo));
    } finally {
      other.cleanup();
    }
  });
});

test("an uncommitted edit to scripts/ changes the hash of a dirty tree, with no commit", () => {
  withRepo((repo) => {
    const base = hashOf(repo);
    fs.appendFileSync(path.join(repo.root, skillRel("demo"), "scripts", "run.sh"), "echo more\n");
    assert.notEqual(hashOf(repo), base);
  });
});

test("a symlink makes the skill invalid naming the path; no hash is produced", () => {
  withRepo((repo) => {
    const dir = path.join(repo.root, skillRel("demo"));
    fs.symlinkSync("run.sh", path.join(dir, "scripts", "link.sh"));
    repo.git("add", "-A");
    const s = readWorkingTree(repo.root, skillRel("demo"));
    assert.equal(s.kind, "invalid");
    assert.ok((s as { problems: string[] }).problems.some((p) => p.includes("scripts/link.sh")));
  });
});

test("an untracked non-ignored file is invalid with a git add message; ignored files are skipped and never installed", () => {
  withRepo((repo) => {
    const dir = path.join(repo.root, skillRel("demo"));
    const base = hashOf(repo);
    fs.mkdirSync(path.join(dir, "scripts", "__pycache__"));
    fs.writeFileSync(path.join(dir, "scripts", "__pycache__", "x.pyc"), "bytecode");
    fs.writeFileSync(path.join(dir, "scripts", ".DS_Store"), "ds");
    assert.equal(hashOf(repo), base, "ignored files are excluded from the hash");
    const snap = readWorkingTree(repo.root, skillRel("demo")) as Extract<Snapshot, { kind: "ok" }>;
    const dest = tmpDir();
    installFiles(snap.files, dest);
    assert.equal(fs.existsSync(path.join(dest, "scripts", "__pycache__")), false);
    assert.equal(fs.existsSync(path.join(dest, "scripts", ".DS_Store")), false);
    fs.rmSync(dest, { recursive: true, force: true });
    fs.writeFileSync(path.join(dir, "scripts", "helper.sh"), "#!/bin/sh\n");
    const s = readWorkingTree(repo.root, skillRel("demo"));
    assert.equal(s.kind, "invalid");
    const problem = (s as { problems: string[] }).problems.join("\n");
    assert.match(problem, /scripts\/helper\.sh/);
    assert.match(problem, /git add/);
  });
});

test("a tracked file is hashed even when an ignore rule matches it", () => {
  withRepo((repo) => {
    const dir = path.join(repo.root, skillRel("demo"));
    const base = hashOf(repo);
    fs.mkdirSync(path.join(dir, "scripts", "__pycache__"));
    fs.writeFileSync(path.join(dir, "scripts", "__pycache__", "x.pyc"), "bytecode");
    repo.git("add", "-f", `${skillRel("demo")}/scripts/__pycache__/x.pyc`);
    assert.notEqual(hashOf(repo), base);
  });
});

test("install writes exactly the hashed files (never evals/), restoring the recorded exec bit; the install is byte-identical", () => {
  withRepo((repo) => {
    const dir = path.join(repo.root, skillRel("demo"));
    fs.writeFileSync(path.join(dir, "notes.md"), "stray");
    repo.git("add", "-A");
    const snap = readWorkingTree(repo.root, skillRel("demo")) as Extract<Snapshot, { kind: "ok" }>;
    // mutate the working tree after the read: the install must still equal the read bytes
    fs.writeFileSync(path.join(dir, "SKILL.md"), "changed after read\n");
    const dest = tmpDir();
    installFiles(snap.files, dest);
    assert.deepEqual(fs.readdirSync(dest).sort(), ["SKILL.md", "references", "scripts"]);
    assert.match(fs.readFileSync(path.join(dest, "SKILL.md"), "utf8"), /^---\nname: demo/);
    assert.equal(fs.statSync(path.join(dest, "scripts", "run.sh")).mode & 0o111, 0o111);
    assert.equal(fs.statSync(path.join(dest, "references", "ref.md")).mode & 0o111, 0);
    assert.equal(fs.existsSync(path.join(dest, "notes.md")), false);
    fs.rmSync(dest, { recursive: true, force: true });
  });
});

test("a revision install restores the exec bit from ls-tree, and a base symlink is invalid", () => {
  withRepo((repo) => {
    const head = repo.git("rev-parse", "HEAD").trim();
    const snap = readRevision(repo.root, head, skillRel("demo")) as Extract<Snapshot, { kind: "ok" }>;
    const dest = tmpDir();
    installFiles(snap.files, dest);
    assert.equal(fs.statSync(path.join(dest, "scripts", "run.sh")).mode & 0o100, 0o100);
    fs.rmSync(dest, { recursive: true, force: true });
    fs.symlinkSync("run.sh", path.join(repo.root, skillRel("demo"), "scripts", "l.sh"));
    commitAll(repo, "link");
    assert.equal(readRevision(repo.root, "HEAD", skillRel("demo")).kind, "invalid");
    assert.equal(readRevision(repo.root, head, skillRel("nope")).kind, "absent");
  });
});
