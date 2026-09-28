// release-changelog.test.ts — regression tests for the lint-safe changelog
// facade scripts/lib/release-notes/changelog-plugin.ts (issue #1364).
//
// The bug: the first extension release with a non-empty note (hello-world
// v2.1.0) prepended semantic-release-gitmoji's raw note to CHANGELOG.md and
// committed it with `[skip ci]`, so a file failing MD022/MD032 reached `main`
// unlinted. Every case below lints the produced CHANGELOG.md with the
// repository's own .markdownlintrc — the same check `lint-markdown` runs.
//
// Needs node_modules (@semantic-release/changelog, markdownlint): run after
// `npm install --include=dev`, as .github/workflows/release-tests.yml does.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { CHANGELOG_TITLE, lintChangelog, prepare } from "../lib/release-notes/changelog-plugin.ts";

const temps: string[] = [];
after(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "release-changelog-"));
  temps.push(dir);
  return dir;
}

const logger = { log: () => {} };

async function release(cwd: string, notes: string): Promise<void> {
  await prepare({}, { cwd, logger, nextRelease: { notes } });
}

const URL = "https://github.com/crewrig/crewrig";
const issue = (n: number) => `[\`#${n}\`](${URL}/issues/${n})`;

// The note hello-world v2.1.0 shipped with (release commit 500d2a5).
const V2_1_0 = [
  `# [hello-world-extension-v2.1.0](${URL}/compare/hello-world-v2.0.0...hello-world-v2.1.0) (2026-09-28)`,
  "",
  "## ✨ New Features",
  `- [\`fb8fec5\`](${URL}/commit/fb8fec5)  Add shell ratchet and TypeScript toolchain gate (spec 0238) (#1362) ` +
    `(Issues: ${issue(1362)}${` ${issue(1321)}`.repeat(9)})`,
  "",
].join("\n");

// Every section and partial shape the gitmoji template can render: a subject
// without issues (trailing space), a WIP nested list (4-space indent), and a
// subject carrying raw HTML.
const EVERY_SECTION = [
  `# [v2.2.0](${URL}/compare/a...b) (2026-10-01)`,
  "",
  "",
  "## ✨ New Features",
  `- [\`aaaaaaa\`](${URL}/commit/aaaaaaa) Add a feature `,
  `- [\`bbbbbbb\`](${URL}/commit/bbbbbbb) Support <br> in \`<code>\` `,
  `    - [\`ccccccc\`](${URL}/commit/ccccccc) wip step`,
  "",
  "",
  "## 🐛 Bug Fixes",
  `- [\`ddddddd\`](${URL}/commit/ddddddd) Fix a defect (Issues: ${issue(7)} ${issue(7)})`,
  "",
  "## 💥 Breaking Changes",
  `- [\`eeeeeee\`](${URL}/commit/eeeeeee) Drop a flag `,
  "",
].join("\n");

describe("changelog facade (issue #1364)", () => {
  test("the raw v2.1.0 note fails lint-markdown (reproduces the bug)", () => {
    const file = path.join(tempDir(), "CHANGELOG.md");
    fs.writeFileSync(file, `${V2_1_0.trim()}\n`);
    const findings = lintChangelog(file).join("\n");
    assert.match(findings, /MD022/);
    assert.match(findings, /MD032/);
  });

  test("the v2.1.0 note is written lint-clean, titled and deduplicated", async () => {
    const dir = tempDir();
    await release(dir, V2_1_0);
    const file = path.join(dir, "CHANGELOG.md");
    const text = fs.readFileSync(file, "utf8");
    assert.deepEqual(lintChangelog(file), []);
    assert.ok(text.startsWith(`${CHANGELOG_TITLE}\n\n## [hello-world-extension-v2.1.0]`));
    assert.match(text, /\n### ✨ New Features\n\n- /);
    assert.equal(text.split("issues/1321").length - 1, 1);
    assert.equal(text.split("issues/1362").length - 1, 1);
  });

  test("successive releases keep a single H1 and stay lint-clean", async () => {
    const dir = tempDir();
    await release(dir, V2_1_0);
    await release(dir, EVERY_SECTION);
    const file = path.join(dir, "CHANGELOG.md");
    const text = fs.readFileSync(file, "utf8");
    assert.deepEqual(lintChangelog(file), []);
    assert.equal(text.match(/^# /gm)?.length, 1);
    assert.ok(text.indexOf("## [v2.2.0]") < text.indexOf("## [hello-world-extension-v2.1.0]"));
    assert.match(text, /Support &lt;br> in `<code>`/);
    assert.match(text, /\n {2}- \[`ccccccc`\]/);
  });

  test("an already-repaired changelog is extended, not re-titled", async () => {
    const dir = tempDir();
    await release(dir, V2_1_0);
    await release(dir, EVERY_SECTION);
    const text = fs.readFileSync(path.join(dir, "CHANGELOG.md"), "utf8");
    assert.equal(text.split(CHANGELOG_TITLE).length - 1, 1);
  });

  test("the committed hello-world CHANGELOG.md is lint-clean", () => {
    const repo = path.resolve(import.meta.dirname, "..", "..");
    const file = path.join(repo, "extensions", "core", "hello-world", "CHANGELOG.md");
    assert.deepEqual(lintChangelog(file), []);
  });

  test("a note the normaliser cannot make lint-safe fails the release", async () => {
    const dir = tempDir();
    await assert.rejects(
      release(dir, "# v9.9.9 (2026-10-01)\n\n**Emphasis used as a heading**\n"),
      /would fail lint-markdown[\s\S]*MD036/,
    );
  });

  test("an empty note writes nothing", async () => {
    const dir = tempDir();
    await release(dir, "");
    assert.equal(fs.existsSync(path.join(dir, "CHANGELOG.md")), false);
  });
});
