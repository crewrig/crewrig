// skill-evals-shared-references.test.ts — the snapshot carries the shared references the skill
// cites (spec 0290 delta-07: R51, and the R32 / R35 additions; issue #1917).

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { citedTopics } from "../lib/build-components/shared-references.ts";
import { bodyOfText } from "../lib/render-command.ts";
import { contentHash, installFiles, readRevision, readWorkingTree } from "../lib/skill-evals/hash.ts";
import type { SnapFile, Snapshot } from "../lib/skill-evals/hash.ts";
import { selectChanged } from "../lib/skill-evals/select.ts";
import type { Selection } from "../lib/skill-evals/select.ts";
import {
  commitAll,
  makeRepo,
  markOrigin,
  selectionOf,
  skillRel,
  tmpDir,
  writeSkill,
} from "./lib/skill-evals-fixtures.ts";
import type { Repo } from "./lib/skill-evals-fixtures.ts";

const SHARED = "artifacts/core/shared/references";
const FRONT = "---\nname: demo\ndescription: A test skill.\n---\n";
const cite = (topic: string): string => `See \`references/shared-${topic}.md\` for the rule.\n`;

/** Write (and stage) the shared source of a topic. */
function writeShared(repo: Repo, topic: string, content: string, stage = true): void {
  const abs = path.join(repo.root, SHARED, `${topic}.md`);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  if (stage) repo.git("add", "-A");
}

const skillMd = (body: string): string => `${FRONT}\n# demo\n\n${body}`;

function withRepo(f: (repo: Repo) => void): void {
  const repo = makeRepo();
  try {
    f(repo);
  } finally {
    repo.cleanup();
  }
}

function ok(s: Snapshot): SnapFile[] {
  assert.equal(s.kind, "ok", JSON.stringify(s));
  return (s as Extract<Snapshot, { kind: "ok" }>).files;
}
const head = (repo: Repo, name = "demo", layer = "core"): Snapshot =>
  readWorkingTree(repo.root, skillRel(name, layer));
const virtuals = (files: SnapFile[]): string[] =>
  files
    .map((f) => f.rel)
    .filter((r) => /^references\/shared-/.test(r))
    .sort();
const bytesOf = (files: SnapFile[], rel: string): string | undefined =>
  files.find((f) => f.rel === rel)?.bytes.toString("utf8");
const problems = (s: Snapshot): string => {
  assert.equal(s.kind, "invalid", JSON.stringify(s));
  return (s as { problems: string[] }).problems.join("\n");
};

/** Hash the plain files of a skill directory the way R35 did before delta-07 (SKILL.md, scripts, references, evals). */
function plainHash(repo: Repo, name = "demo"): string {
  const dir = path.join(repo.root, skillRel(name));
  const rels = ["SKILL.md", "evals/evals.json", "references/ref.md", "scripts/run.sh"];
  const h = createHash("sha256");
  for (const rel of rels) {
    const bytes = fs.readFileSync(path.join(dir, rel));
    h.update(
      Buffer.concat([
        Buffer.from(rel),
        Buffer.from([0]),
        Buffer.from(rel === "scripts/run.sh" ? "1" : "0"),
        Buffer.from([0]),
        Buffer.from(String(bytes.length)),
        Buffer.from([0]),
        bytes,
        Buffer.from([0]),
      ]),
    );
  }
  return `sha256:${h.digest("hex")}`;
}

test("head snapshot holds references/shared-X.md with the working-tree bytes of the shared source", () => {
  withRepo((repo) => {
    writeShared(repo, "friction-reporting", "shared v1\n");
    writeSkill(repo, "demo", { "SKILL.md": skillMd(cite("friction-reporting")) });
    commitAll(repo, "base");
    const files = ok(head(repo));
    assert.deepEqual(virtuals(files), ["references/shared-friction-reporting.md"]);
    assert.equal(bytesOf(files, "references/shared-friction-reporting.md"), "shared v1\n");
    assert.equal(files.find((f) => f.rel === "references/shared-friction-reporting.md")?.exec, false);
  });
});

test("the base snapshot holds the shared bytes at the revision, even when the working copy differs", () => {
  withRepo((repo) => {
    writeShared(repo, "friction-reporting", "shared v1\n");
    writeSkill(repo, "demo", { "SKILL.md": skillMd(cite("friction-reporting")) });
    const base = commitAll(repo, "base");
    writeShared(repo, "friction-reporting", "shared v2\n");
    const baseFiles = ok(readRevision(repo.root, base, skillRel("demo")));
    assert.equal(bytesOf(baseFiles, "references/shared-friction-reporting.md"), "shared v1\n");
    assert.equal(
      bytesOf(ok(head(repo)), "references/shared-friction-reporting.md"),
      "shared v2\n",
    );
  });
});

test("identical content hashes identically on head and base", () => {
  withRepo((repo) => {
    writeShared(repo, "friction-reporting", "shared v1\n");
    writeSkill(repo, "demo", { "SKILL.md": skillMd(cite("friction-reporting")) });
    const base = commitAll(repo, "base");
    assert.equal(
      contentHash(ok(readRevision(repo.root, base, skillRel("demo")))),
      contentHash(ok(head(repo))),
    );
  });
});

test("editing the shared source changes the content hash of the citing skill", () => {
  withRepo((repo) => {
    writeShared(repo, "friction-reporting", "shared v1\n");
    writeSkill(repo, "demo", { "SKILL.md": skillMd(cite("friction-reporting")) });
    commitAll(repo, "base");
    const before = contentHash(ok(head(repo)));
    writeShared(repo, "friction-reporting", "shared v1 edited\n");
    assert.notEqual(contentHash(ok(head(repo))), before);
  });
});

test("installFiles writes a byte-identical references/shared-X.md from the snapshot", () => {
  withRepo((repo) => {
    writeShared(repo, "friction-reporting", "shared v1\r\nwith é bytes\n");
    writeSkill(repo, "demo", { "SKILL.md": skillMd(cite("friction-reporting")) });
    commitAll(repo, "base");
    const files = ok(head(repo));
    // mutate the source after the read: the install must still write the hashed bytes
    writeShared(repo, "friction-reporting", "changed after read\n");
    const dest = tmpDir();
    try {
      installFiles(files, dest);
      assert.deepEqual(
        fs.readFileSync(path.join(dest, "references", "shared-friction-reporting.md")),
        Buffer.from("shared v1\r\nwith é bytes\n"),
      );
      assert.equal(fs.existsSync(path.join(dest, "evals")), false);
      assert.equal(
        fs.statSync(path.join(dest, "references", "shared-friction-reporting.md")).mode & 0o111,
        0,
      );
    } finally {
      fs.rmSync(dest, { recursive: true, force: true });
    }
  });
});

test("a topic named only in the frontmatter, or never cited, adds no file", () => {
  withRepo((repo) => {
    writeShared(repo, "friction-reporting", "shared\n");
    writeShared(repo, "other-topic", "other\n");
    const fm =
      "---\nname: demo\ndescription: See references/shared-friction-reporting.md here.\n---\n\n# demo\n\nNo citation in the body.\n";
    writeSkill(repo, "demo", { "SKILL.md": fm });
    commitAll(repo, "base");
    assert.deepEqual(virtuals(ok(head(repo))), []);
  });
});

test("a skill citing no topic keeps the hash it had before this change", () => {
  withRepo((repo) => {
    writeShared(repo, "friction-reporting", "shared\n");
    writeSkill(repo, "demo");
    commitAll(repo, "base");
    assert.equal(contentHash(ok(head(repo))), plainHash(repo));
  });
});

test("a skill in a layer other than core reads the shared source of the core layer", () => {
  withRepo((repo) => {
    writeShared(repo, "friction-reporting", "core shared\n");
    const dir = path.join(repo.root, "artifacts", "library", "skills", "libby");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), skillMd(cite("friction-reporting")));
    commitAll(repo, "base");
    const files = ok(head(repo, "libby", "library"));
    assert.equal(bytesOf(files, "references/shared-friction-reporting.md"), "core shared\n");
    const base = repo.git("rev-parse", "HEAD").trim();
    assert.equal(
      bytesOf(
        ok(readRevision(repo.root, base, skillRel("libby", "library"))),
        "references/shared-friction-reporting.md",
      ),
      "core shared\n",
    );
  });
});

// Parity with the build: the topics of the snapshot are those of citedTopics(bodyOfText(LF text)).
const FENCES =
  "Prose cites `references/shared-alpha.md` and again `references/shared-alpha.md`.\n\n" +
  "```sh\ncat references/shared-beta.md\n```\n\n" +
  "```yaml\nuses: references/shared-gamma.md\n```\n\n" +
  "<!-- crewrig-repo-only:start -->\n`references/shared-delta.md`\n<!-- crewrig-repo-only:end -->\n";
const parityCases: { name: string; text: string; expected: string[] }[] = [
  {
    name: "CRLF line endings",
    text: skillMd(cite("alpha")).replaceAll("\n", "\r\n"),
    expected: ["alpha"],
  },
  { name: "a leading BOM", text: `﻿${skillMd(cite("alpha"))}`, expected: ["alpha"] },
  {
    name: "lone CR line endings",
    text: skillMd(cite("alpha")).replaceAll("\n", "\r"),
    expected: ["alpha"],
  },
  {
    name: "a BOM with CRLF",
    text: `﻿${skillMd(cite("alpha"))}`.replaceAll("\n", "\r\n"),
    expected: ["alpha"],
  },
  {
    name: "citations in a plain fence, a yaml fence, a repo-only block and a duplicate",
    text: skillMd(FENCES),
    expected: ["alpha", "beta"],
  },
];
for (const c of parityCases) {
  test(`parity with citedTopics: ${c.name}`, () => {
    withRepo((repo) => {
      for (const t of ["alpha", "beta", "gamma", "delta"]) writeShared(repo, t, `${t} bytes\n`);
      writeSkill(repo, "demo", { "SKILL.md": c.text });
      commitAll(repo, "base");
      const lf = c.text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
      const build = citedTopics(bodyOfText(lf)).sort();
      assert.deepEqual(build, c.expected, "the fixture itself states what the build cites");
      const files = ok(head(repo));
      assert.deepEqual(
        virtuals(files),
        build.map((t) => `references/shared-${t}.md`),
      );
      for (const t of build) assert.equal(bytesOf(files, `references/shared-${t}.md`), `${t} bytes\n`);
      const base = repo.git("rev-parse", "HEAD").trim();
      assert.deepEqual(virtuals(ok(readRevision(repo.root, base, skillRel("demo")))), virtuals(files));
    });
  });
}

test("a cited topic without a tracked source file makes the snapshot invalid, naming the topic", () => {
  withRepo((repo) => {
    writeSkill(repo, "demo", { "SKILL.md": skillMd(cite("missing-topic")) });
    commitAll(repo, "base");
    assert.match(problems(head(repo)), /missing-topic/);
    assert.equal(readRevision(repo.root, "HEAD", skillRel("demo")).kind, "invalid");
  });
});

test("a git-ignored untracked shared source counts as absent: invalid, naming the topic", () => {
  withRepo((repo) => {
    fs.appendFileSync(path.join(repo.root, ".gitignore"), `${SHARED}/ignored-topic.md\n`);
    writeShared(repo, "ignored-topic", "ignored\n");
    writeSkill(repo, "demo", { "SKILL.md": skillMd(cite("ignored-topic")) });
    commitAll(repo, "base");
    assert.match(problems(head(repo)), /ignored-topic/);
  });
});

test("a tracked shared source deleted in the working tree counts as absent: invalid", () => {
  withRepo((repo) => {
    writeShared(repo, "friction-reporting", "shared\n");
    writeSkill(repo, "demo", { "SKILL.md": skillMd(cite("friction-reporting")) });
    commitAll(repo, "base");
    fs.rmSync(path.join(repo.root, SHARED, "friction-reporting.md"));
    assert.match(problems(head(repo)), /friction-reporting/);
  });
});

test("an untracked non-ignored shared source makes the snapshot invalid, naming the path", () => {
  withRepo((repo) => {
    writeSkill(repo, "demo", { "SKILL.md": skillMd(cite("fresh")) });
    commitAll(repo, "base");
    writeShared(repo, "fresh", "untracked\n", false);
    const p = problems(head(repo));
    assert.match(p, /artifacts\/core\/shared\/references\/fresh\.md/);
  });
});

test("a symlinked shared source makes the snapshot invalid, naming the path", () => {
  withRepo((repo) => {
    writeShared(repo, "real", "real bytes\n");
    fs.symlinkSync("real.md", path.join(repo.root, SHARED, "linked.md"));
    writeSkill(repo, "demo", { "SKILL.md": skillMd(cite("linked")) });
    commitAll(repo, "base");
    assert.match(problems(head(repo)), /artifacts\/core\/shared\/references\/linked\.md/);
    assert.equal(readRevision(repo.root, "HEAD", skillRel("demo")).kind, "invalid");
  });
});

test("a tracked top-level references/shared-*.md in the skill source is reserved: invalid, naming the path", () => {
  withRepo((repo) => {
    writeSkill(repo, "demo", { "references/shared-own.md": "mine\n" });
    commitAll(repo, "base");
    assert.match(problems(head(repo)), /references\/shared-own\.md/);
    assert.equal(readRevision(repo.root, "HEAD", skillRel("demo")).kind, "invalid");
  });
});

test("a tracked own shared- file deleted in the working tree does not count", () => {
  withRepo((repo) => {
    writeSkill(repo, "demo", { "references/shared-own.md": "mine\n" });
    commitAll(repo, "base");
    fs.rmSync(path.join(repo.root, skillRel("demo"), "references", "shared-own.md"));
    assert.equal(head(repo).kind, "ok");
  });
});

test("a nested references/sub/shared-x.md is not reserved", () => {
  withRepo((repo) => {
    writeSkill(repo, "demo", { "references/sub/shared-x.md": "nested\n" });
    commitAll(repo, "base");
    const files = ok(head(repo));
    assert.equal(bytesOf(files, "references/sub/shared-x.md"), "nested\n");
  });
});

test("no CLI build tree is read: decoy built copies with other bytes are ignored", () => {
  withRepo((repo) => {
    writeShared(repo, "friction-reporting", "source bytes\n");
    writeSkill(repo, "demo", { "SKILL.md": skillMd(cite("friction-reporting")) });
    for (const tree of [".claude", ".gemini", ".github", ".agents"]) {
      const abs = path.join(repo.root, tree, "skills", "demo", "references");
      fs.mkdirSync(abs, { recursive: true });
      fs.writeFileSync(path.join(abs, "shared-friction-reporting.md"), "DECOY bytes\n");
    }
    commitAll(repo, "base");
    const files = ok(head(repo));
    assert.equal(bytesOf(files, "references/shared-friction-reporting.md"), "source bytes\n");
    const base = repo.git("rev-parse", "HEAD").trim();
    assert.equal(
      bytesOf(
        ok(readRevision(repo.root, base, skillRel("demo"))),
        "references/shared-friction-reporting.md",
      ),
      "source bytes\n",
    );
  });
});

test("describeSkill selects a skill when only the shared source changed since the merge-base", () => {
  withRepo((repo) => {
    writeShared(repo, "friction-reporting", "v1\n");
    writeSkill(repo, "demo", { "SKILL.md": skillMd(cite("friction-reporting")) });
    writeSkill(repo, "other");
    commitAll(repo, "base");
    markOrigin(repo);
    const unchanged = selectChanged(repo.root, "origin/main");
    assert.deepEqual("error" in unchanged ? unchanged : unchanged.selections, []);

    writeShared(repo, "friction-reporting", "v2\n");
    commitAll(repo, "edit shared only");
    const r = selectChanged(repo.root, "origin/main");
    assert.ok(!("error" in r));
    assert.deepEqual(
      r.selections.map((s) => s.skill.name),
      ["demo"],
    );
    const sel = selectionOf(repo, "demo");
    assert.equal(sel.isNew, false);
    assert.notEqual(sel.baseHash, sel.headHash);
  });
});

test("an invalid base snapshot is selected as new", () => {
  withRepo((repo) => {
    writeSkill(repo, "demo", { "SKILL.md": skillMd(cite("late-topic")) }); // source missing at the base
    commitAll(repo, "base");
    markOrigin(repo);
    writeShared(repo, "late-topic", "now present\n");
    commitAll(repo, "add the source");
    const r = selectChanged(repo.root, "origin/main");
    assert.ok(!("error" in r));
    const sel = r.selections.find((s) => s.skill.name === "demo") as Selection;
    assert.ok(sel, "selected");
    assert.equal(sel.head.kind, "ok");
    assert.equal(sel.isNew, true);
  });
});
