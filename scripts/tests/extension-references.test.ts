// extension-references.test.ts — no live instruction still tells a reader to run one of the five
// extension and plugin builder shell scripts, or names the deleted shared render library (spec
// 0254 R29). The builders are `node scripts/<name>.ts` behind the Node.js floor guard; the `.sh`
// files are only forwarding shims. The suite scans every tracked and untracked text file and
// fails on a file that carries the old invocation and is not on the reasoned allowlist
// (scripts/tests/fixtures/extension/old-invocation-allowlist.txt). The allowlist is
// audited too: every entry exists, still has a hit (no stale entry), appears once, and carries
// a reason comment.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { git, repoRoot, trackedFiles } from "../lib/ts-scope.ts";

// Assembled so this file does not name the invocations it scans for.
const NAMES = [
  "build-extension",
  "build-claude-plugin",
  "build-copilot-plugin",
  "build-antigravity-extension",
  "migrate-extension",
];
const RUN = ["bash", String.raw`\s+(?:\S*/)?scripts/(?:`, NAMES.join("|"), String.raw`)\.sh`].join(
  "",
);
const DELETED = ["render", "-context.sh"].join("");
const PATTERN = new RegExp(`${RUN}|${DELETED}`);
const ALLOWLIST = "scripts/tests/fixtures/extension/old-invocation-allowlist.txt";
const SAMPLE_RUN = ["bash", "scripts/build-extension.sh"].join(" ");

interface Entry {
  readonly path: string;
  readonly hasReason: boolean;
}

/** Parse the allowlist: `#` lines are comments; a path line needs a comment in its blank-line-free block. */
function parseAllowlist(text: string): Entry[] {
  const entries: Entry[] = [];
  let previousIsComment = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") {
      previousIsComment = false;
      continue;
    }
    if (line.startsWith("#")) {
      previousIsComment = true;
      continue;
    }
    entries.push({ path: line, hasReason: previousIsComment });
  }
  return entries;
}

function covers(entry: string, file: string): boolean {
  return entry.endsWith("/") ? file.startsWith(entry) : entry === file;
}

/** Tracked files unioned with untracked, non-ignored ones, sorted and de-duplicated. */
function candidateFiles(): string[] {
  const untracked = git(["ls-files", "-z", "--others", "--exclude-standard"]);
  assert.equal(untracked.status, 0, untracked.stderr);
  const more = untracked.stdout.split("\0").filter((p) => p !== "");
  return [...new Set([...trackedFiles(), ...more])].sort();
}

/** Text of a regular, non-binary file; `null` for a missing file, a link or binary content. */
function readText(rel: string): string | null {
  const abs = path.join(repoRoot(), rel);
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(abs);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  const buf = fs.readFileSync(abs);
  if (buf.subarray(0, 8192).includes(0)) return null;
  return buf.toString("utf8");
}

/** Files whose text carries the old invocation. */
function filesWithHits(files: readonly string[], read: (rel: string) => string | null): string[] {
  return files.filter((f) => PATTERN.test(read(f) ?? ""));
}

/** Hits outside the allowlist. */
function unlisted(hits: readonly string[], entries: readonly Entry[]): string[] {
  return hits.filter((f) => !entries.some((e) => covers(e.path, f)));
}

/** Allowlist entries that match no file with a hit. */
function stale(hits: readonly string[], entries: readonly Entry[]): string[] {
  return entries.filter((e) => !hits.some((f) => covers(e.path, f))).map((e) => e.path);
}

function duplicates(entries: readonly Entry[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.path)) dup.add(e.path);
    seen.add(e.path);
  }
  return [...dup];
}

const files = candidateFiles();
const hits = filesWithHits(files, readText);
const entries = parseAllowlist(fs.readFileSync(path.join(repoRoot(), ALLOWLIST), "utf8"));

describe("no live instruction runs an extension builder shell script", () => {
  test("every file naming it is on the allowlist", () => {
    assert.deepEqual(unlisted(hits, entries), []);
  });

  test("every allowlist entry still matches a file with a hit", () => {
    assert.deepEqual(stale(hits, entries), []);
  });

  test("the allowlist has no duplicate entry and every entry carries a reason", () => {
    assert.deepEqual(duplicates(entries), []);
    assert.deepEqual(
      entries.filter((e) => !e.hasReason).map((e) => e.path),
      [],
    );
  });

  test("an allowlist entry names a tracked or untracked file or directory", () => {
    const missing = entries.map((e) => e.path).filter((e) => !files.some((f) => covers(e, f)));
    assert.deepEqual(missing, []);
  });
});

describe("the scan detects what it must", () => {
  const fake = new Map<string, string | null>([
    ["docs/live.md", `Run \`${SAMPLE_RUN} --check\``],
    [
      "docs/task.md",
      `cmd: ${["bash", "{{.REPO_DIR}}/scripts/migrate-extension.sh"].join(" ")} {{.EXT}}`,
    ],
    ["docs/deleted.md", `sourced ${DELETED} here`],
    ["docs/clean.md", "Run `node scripts/build-extension.ts --check`"],
    ["docs/mention.md", "the shim scripts/build-extension.sh forwards"],
    ["bin/blob", null],
    ["specs/old.md", SAMPLE_RUN],
  ]);
  const read = (rel: string): string | null => fake.get(rel) ?? null;
  const all = [...fake.keys()];

  test("a text file naming the invocation is a hit; a clean or binary file is not", () => {
    assert.deepEqual(filesWithHits(all, read), [
      "docs/live.md",
      "docs/task.md",
      "docs/deleted.md",
      "specs/old.md",
    ]);
  });

  test("an unlisted hit, a stale entry and a duplicate are each reported", () => {
    const list = parseAllowlist(
      "# reason\nspecs/\n\n# reason\ngone.md\n\n# reason\ngone.md\n\nnoreason.md\n",
    );
    const found = filesWithHits(all, read);
    assert.deepEqual(unlisted(found, list), ["docs/live.md", "docs/task.md", "docs/deleted.md"]);
    assert.deepEqual(stale(found, list), ["gone.md", "gone.md", "noreason.md"]);
    assert.deepEqual(duplicates(list), ["gone.md"]);
    assert.deepEqual(
      list.filter((e) => !e.hasReason).map((e) => e.path),
      ["noreason.md"],
    );
  });
});
