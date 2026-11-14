// skill-evals-hash.test.ts — the content hash (spec 0290 R32, R35, R25 as narrowed by #1963).

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  contentHash,
  installFiles,
  readRevision,
  readWorkingTree,
  withoutVersionLine,
} from "../lib/skill-evals/hash.ts";
import type { Snapshot } from "../lib/skill-evals/hash.ts";
import { commitAll, makeRepo, skillRel, tmpDir, writeSkill } from "./lib/skill-evals-fixtures.ts";
import type { Repo } from "./lib/skill-evals-fixtures.ts";

const hashOf = (repo: Repo, name = "demo"): string => {
  const s = readWorkingTree(repo.root, skillRel(name));
  assert.equal(s.kind, "ok", JSON.stringify(s));
  return contentHash((s as Extract<Snapshot, { kind: "ok" }>).files);
};
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

test("fixed vector: path NUL flag NUL size NUL bytes NUL, sorted by UTF-8 bytes, over SKILL.md and evals/evals.json only (#1963)", () => {
  withRepo((repo) => {
    const snap = readWorkingTree(repo.root, skillRel("demo")) as Extract<Snapshot, { kind: "ok" }>;
    const h = createHash("sha256");
    for (const rel of ["SKILL.md", "evals/evals.json"]) {
      const bytes = fs.readFileSync(path.join(repo.root, skillRel("demo"), rel));
      h.update(
        Buffer.concat([
          Buffer.from(rel),
          Buffer.from([0]),
          Buffer.from("0"),
          Buffer.from([0]),
          Buffer.from(String(bytes.length)),
          Buffer.from([0]),
          bytes,
          Buffer.from([0]),
        ]),
      );
    }
    assert.equal(contentHash(snap.files), `sha256:${h.digest("hex")}`);
    assert.match(contentHash(snap.files), /^sha256:[0-9a-f]{64}$/);
  });
});

test("a byte of SKILL.md or of evals.json changes the hash; scripts, references, assets and unhashed files do not (#1963)", () => {
  withRepo((repo) => {
    const base = hashOf(repo);
    const dir = path.join(repo.root, skillRel("demo"));
    fs.writeFileSync(path.join(dir, "references", "ref.md"), "referencf\n");
    fs.appendFileSync(path.join(dir, "scripts", "run.sh"), "echo more\n");
    fs.mkdirSync(path.join(dir, "assets"));
    fs.writeFileSync(path.join(dir, "assets", "a.txt"), "x");
    fs.writeFileSync(path.join(dir, "evals", "results.json"), "{}");
    fs.writeFileSync(path.join(dir, "notes.md"), "n");
    fs.writeFileSync(path.join(dir, "evals", "files", "in.txt"), "changed");
    repo.git("add", "-A");
    assert.equal(hashOf(repo), base, "a script, reference or asset change selects no paid run");
    fs.appendFileSync(path.join(dir, "SKILL.md"), "one more line\n");
    const edited = hashOf(repo);
    assert.notEqual(edited, base);
    fs.appendFileSync(path.join(dir, "evals", "evals.json"), "\n");
    assert.notEqual(hashOf(repo), edited);
  });
});

test("the metadata.provenance.version line is not hashed; any other frontmatter line is (#1963)", () => {
  const md = (v: string, extra = "") =>
    `---\nname: demo\ndescription: A test skill.\nmetadata:\n  provenance:\n    version: "${v}"\n    source: x${extra}\n---\n\n# demo\n`;
  const repo = makeRepo();
  try {
    writeSkill(repo, "demo", { "SKILL.md": md("1.0.0") });
    commitAll(repo, "base");
    const base = hashOf(repo);
    writeSkill(repo, "demo", { "SKILL.md": md("1.0.1") });
    assert.equal(hashOf(repo), base, "a version bump keeps the hash");
    writeSkill(repo, "demo", { "SKILL.md": md("1.0.1", "y") });
    assert.notEqual(hashOf(repo), base, "another frontmatter byte changes it");
    assert.deepEqual(
      withoutVersionLine(Buffer.from("no frontmatter\n    version: 1\n")).toString(),
      "no frontmatter\n    version: 1\n",
    );
  } finally {
    repo.cleanup();
  }
});

test("the filesystem mode and core.fileMode never change the hash", () => {
  withRepo((repo) => {
    const base = hashOf(repo);
    const file = path.join(repo.root, skillRel("demo"), "SKILL.md");
    fs.chmodSync(file, 0o755); // filesystem permission change, index mode untouched
    assert.equal(hashOf(repo), base);
    repo.git("config", "core.fileMode", "false");
    assert.equal(hashOf(repo), base);
  });
});

test("the hash equals the same content read from a git revision, whatever the creation order", () => {
  withRepo((repo) => {
    const head = repo.git("rev-parse", "HEAD").trim();
    const rev = readRevision(repo.root, head, skillRel("demo")) as Extract<
      Snapshot,
      { kind: "ok" }
    >;
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

test("an uncommitted edit to SKILL.md changes the hash of a dirty tree, with no commit", () => {
  withRepo((repo) => {
    const base = hashOf(repo);
    fs.appendFileSync(path.join(repo.root, skillRel("demo"), "SKILL.md"), "more\n");
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

test("a tracked file under scripts/ is installed even when an ignore rule matches it, and is not hashed", () => {
  withRepo((repo) => {
    const dir = path.join(repo.root, skillRel("demo"));
    const base = hashOf(repo);
    fs.mkdirSync(path.join(dir, "scripts", "__pycache__"));
    fs.writeFileSync(path.join(dir, "scripts", "__pycache__", "x.pyc"), "bytecode");
    repo.git("add", "-f", `${skillRel("demo")}/scripts/__pycache__/x.pyc`);
    assert.equal(hashOf(repo), base);
    const snap = readWorkingTree(repo.root, skillRel("demo")) as Extract<Snapshot, { kind: "ok" }>;
    assert.ok(snap.files.some((f) => f.rel === "scripts/__pycache__/x.pyc"));
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
    const snap = readRevision(repo.root, head, skillRel("demo")) as Extract<
      Snapshot,
      { kind: "ok" }
    >;
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
