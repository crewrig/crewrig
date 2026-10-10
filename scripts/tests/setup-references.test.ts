// setup-references.test.ts — no live instruction still tells a reader to run one of the four setup
// shell scripts through `bash` (spec 0256 R33, R34). The entries are `node scripts/setup-<cli>-
// interactive.ts` behind the Node.js floor guard (or the Taskfile); the `.sh` files are only
// forwarding shims that keep a caller of the old path working. The suite scans every tracked and
// untracked text file outside `specs/` and `docs/adr/` (history) and fails on a file that names
// the old invocation and is not on the reasoned allowlist
// (scripts/tests/fixtures/setup/old-invocation-allowlist.txt). The allowlist is audited too: every
// entry exists, still has a hit (no stale entry), appears once, and carries a reason comment. A
// second check keeps the CI files honest: they may name a shim path in a `paths:` filter, but no
// line of a CI configuration or of the Taskfile runs a shim through `bash`.
// Model: install-references.test.ts.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { git, repoRoot, trackedFiles } from "../lib/ts-scope.ts";

const CLIS = ["claude", "gemini", "copilot", "antigravity"];
const ALLOWLIST = "scripts/tests/fixtures/setup/old-invocation-allowlist.txt";
const EXCLUDED = ["specs/", "docs/adr/"];
// The invocation: `bash` followed by a path ending in a setup shim. A shell variable or a `<cli>`
// placeholder stands for a CLI name, so a templated instruction is a hit as well.
const NAME = `(?:${CLIS.join("|")}|\\$\\{\\w+\\}|<cli>)`;
const OLD_INVOCATION = new RegExp(
  `\\bbash\\s+["']?[^\\s"']*scripts/setup-${NAME}-interactive\\.sh`,
);
const BASH_RUN = new RegExp(`\\bbash\\s+\\S*scripts/setup-(${CLIS.join("|")})-interactive\\.sh\\b`);
const CI_CONFIGS = [
  "ci/ci-capabilities.yml",
  ".gitlab-ci.yml",
  "Taskfile.yml",
  ".github/workflows/build.yml",
];

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

/** Scanned files whose text names the old invocation (history under `specs/` and `docs/adr/` excluded). */
function filesWithHits(files: readonly string[], read: (rel: string) => string | null): string[] {
  return files.filter((f) => {
    if (EXCLUDED.some((prefix) => f.startsWith(prefix))) return false;
    const text = read(f);
    return text !== null && OLD_INVOCATION.test(text);
  });
}

function unlisted(hits: readonly string[], entries: readonly Entry[]): string[] {
  return hits.filter((f) => !entries.some((e) => covers(e.path, f)));
}

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

/** `file:line` of every line of the given files that runs a shim through `bash`. */
function bashRuns(files: readonly string[], read: (rel: string) => string | null): string[] {
  const found: string[] = [];
  for (const file of files) {
    (read(file) ?? "").split("\n").forEach((line, i) => {
      if (BASH_RUN.test(line)) found.push(`${file}:${i + 1}`);
    });
  }
  return found;
}

const files = candidateFiles();
const hits = filesWithHits(files, readText);
const entries = parseAllowlist(fs.readFileSync(path.join(repoRoot(), ALLOWLIST), "utf8"));

describe("no live instruction names the old setup invocation", () => {
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

  test("no CI configuration or Taskfile line runs a shim through bash", () => {
    const workflows = files.filter((f) => /^\.github\/workflows\/.*\.ya?ml$/.test(f));
    assert.deepEqual(bashRuns([...new Set([...CI_CONFIGS, ...workflows])], readText), []);
  });
});

describe("the scan detects what it must", () => {
  const live = `Run \`bash scripts/setup-${CLIS[0]}-interactive.sh\``;
  const fake = new Map<string, string | null>([
    ["docs/live.md", live],
    ["docs/templated.md", "run `bash scripts/setup-${cli}-interactive.sh`"],
    ["docs/quoted.md", `bash "$ROOT/scripts/setup-${CLIS[1]}-interactive.sh"`],
    ["docs/clean.md", "Run `node scripts/setup-claude-interactive.ts`"],
    ["docs/path-only.md", "the file scripts/setup-claude-interactive.sh is a shim"],
    ["bin/blob", null],
    ["specs/old.md", live],
    ["docs/adr/0001.md", live],
  ]);
  const read = (rel: string): string | null => fake.get(rel) ?? null;
  const all = [...fake.keys()];

  test("a text file naming the invocation is a hit; a clean, path-only, binary or history file is not", () => {
    assert.deepEqual(filesWithHits(all, read), [
      "docs/live.md",
      "docs/templated.md",
      "docs/quoted.md",
    ]);
  });

  test("an unlisted hit, a stale entry and a duplicate are each reported", () => {
    const list = parseAllowlist(
      "# reason\ndocs/quoted.md\n\n# reason\ngone.md\n\n# reason\ngone.md\n\nnoreason.md\n",
    );
    const found = filesWithHits(all, read);
    assert.deepEqual(unlisted(found, list), ["docs/live.md", "docs/templated.md"]);
    assert.deepEqual(stale(found, list), ["gone.md", "gone.md", "noreason.md"]);
    assert.deepEqual(duplicates(list), ["gone.md"]);
    assert.deepEqual(
      list.filter((e) => !e.hasReason).map((e) => e.path),
      ["noreason.md"],
    );
  });

  test("a bash run of a shim is reported with its line; a path filter is not", () => {
    const ci = new Map<string, string | null>([
      [
        "ci/a.yml",
        `paths:\n  - "scripts/setup-gemini-interactive.sh"\ncommand:\n  - bash scripts/setup-gemini-interactive.sh`,
      ],
    ]);
    assert.deepEqual(
      bashRuns(["ci/a.yml"], (rel) => ci.get(rel) ?? null),
      ["ci/a.yml:4"],
    );
  });
});
