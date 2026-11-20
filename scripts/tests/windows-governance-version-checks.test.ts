// windows-governance-version-checks.test.ts — the cross-system proof of the version-checks group
// (spec 0259 R26-R28): check-skill-versions, check-extension-provenance
// and check-extension-pivot run from PowerShell on Windows (the default shell elsewhere), against the
// real repository and against a fixture that makes each of them fail. Interpreters are resolved from
// the PARENT PATH before the child PATH is narrowed. The checks read the current directory, so each
// run changes into its repository for the duration of the synchronous spawn.
// The `windows-governance-checks` job runs every `windows-governance-*.test.ts` file.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { defaultIsFile, resolveOnPath } from "../lib/worktree-claim/launch-windows.ts";
import {
  expectStatus,
  resolveInterpreters,
  spawnEntry,
  WIN,
  why,
} from "./lib/windows-proof-support.ts";
import type { Run } from "./lib/windows-proof-support.ts";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKILL = "artifacts/core/skills/demo/SKILL.md";
const EXT = "extensions/core/skills/demo/SKILL.md";
const GIT = [
  "-c",
  "user.name=gov",
  "-c",
  "user.email=gov@example.invalid",
  "-c",
  "core.autocrlf=false",
];

/**
 * `git` must stay reachable once spawnEntry narrows the child PATH to node, System32 and the stubs:
 * on Windows its directory (found on the PARENT PATH) is prepended to the stub directory.
 */
function withGitDir(bin: string): string {
  if (!WIN) return bin;
  const git = resolveOnPath("git", {
    platform: process.platform,
    env: process.env,
    isFile: defaultIsFile,
  });
  return git === undefined ? bin : [path.win32.dirname(git), bin].join(path.delimiter);
}

function withBox<T>(body: (home: string, bin: string) => T): T {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "windows-governance-vc-")),
  );
  try {
    const bin = path.join(root, "bin");
    fs.mkdirSync(bin);
    return body(root, bin);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function run(
  entry: string,
  cwd: string,
  home: string,
  bin: string,
  env: Record<string, string> = {},
): Run {
  // Resolved from the parent environment, before spawnEntry narrows the child PATH.
  const interpreters = resolveInterpreters({
    platform: process.platform,
    env: process.env,
    isFile: defaultIsFile,
  });
  console.log(`windows-governance-version-checks: ${entry}: ${interpreters.notes.join("; ")}`);
  const before = process.cwd();
  process.chdir(cwd);
  try {
    return spawnEntry({
      entry,
      script: path.join(repo, "scripts", `${entry}.ts`),
      args: [],
      shell: "pwsh",
      env: {
        GIT_CONFIG_NOSYSTEM: "1",
        NODE_OPTIONS: "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
        ...env,
      },
      home,
      bin: withGitDir(bin),
      interpreters,
    });
  } finally {
    process.chdir(before);
  }
}

function write(root: string, rel: string, content: string): void {
  const file = path.join(root, ...rel.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function git(root: string, ...args: string[]): void {
  const r = spawnSync("git", [...GIT, ...args], { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
}

/** A temp repository with two commits; the second rewrites `rel` from `first` to `second`. */
function twoCommits(root: string, rel: string, first: string, second: string): string {
  const dir = path.join(root, "fixture");
  fs.mkdirSync(dir);
  git(dir, "init", "-q");
  write(dir, rel, first);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "first");
  write(dir, rel, second);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "second");
  return dir;
}

const out = (r: Run): string => r.out.replaceAll("\r\n", "\n");
const err = (r: Run): string => r.err.replaceAll("\r\n", "\n");

/** Collect every failed assertion of a group and report them together. */
function aggregate(r: Run, checks: ReadonlyArray<[string, () => void]>): void {
  const failures: string[] = [];
  for (const [what, check] of checks) {
    try {
      check();
    } catch (e) {
      failures.push(`${what}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  assert.equal(failures.length, 0, `${why(r, "assertions")}\n${failures.join("\n")}`);
}

describe("windows governance version-checks: real repository", () => {
  for (const [entry, verdict] of [
    ["check-skill-versions", /^OK: .+\n$/m],
    ["check-extension-provenance", /^OK: \d+ upstream-owned extension skill\/agent\(s\) carry/m],
    ["check-extension-pivot", /^OK: every upstream-owned extension component is pivot-authored/m],
  ] as const) {
    it(`${entry} accepts the repository`, () => {
      withBox((home, bin) => {
        const r = run(entry, repo, home, bin, { BASE_REF: "HEAD" });
        aggregate(r, [
          ["exit status", () => expectStatus(r, 0)],
          ["verdict line", () => assert.match(out(r), verdict)],
          ["no diagnostic", () => assert.equal(err(r), "")],
        ]);
      });
    });
  }
});

describe("windows governance version-checks: failing fixtures", () => {
  it("check-skill-versions rejects an unbumped skill", () => {
    withBox((home, bin) => {
      const body = (text: string): string =>
        `---\nname: demo\n---\n    version: "1.0.0"\n${text}\n`;
      const dir = twoCommits(home, SKILL, body("one"), body("two"));
      const r = run("check-skill-versions", dir, home, bin, { BASE_REF: "HEAD~1" });
      aggregate(r, [
        ["exit status", () => expectStatus(r, 1)],
        [
          "FAIL line",
          () =>
            assert.ok(
              out(r).includes(`  FAIL ${SKILL} — metadata.provenance.version not bumped\n`),
              out(r),
            ),
        ],
        [
          "summary",
          () => assert.match(out(r), /^FAILED: 1 source\(s\) changed without a version bump:$/m),
        ],
      ]);
    });
  });

  it("check-extension-provenance rejects a skill without the carrier", () => {
    withBox((home, bin) => {
      const dir = path.join(home, "tree");
      write(dir, EXT, "---\nname: demo\n---\nNo carrier here.\n");
      const r = run("check-extension-provenance", dir, home, bin);
      aggregate(r, [
        ["exit status", () => expectStatus(r, 1)],
        [
          "FAIL line",
          () =>
            assert.ok(
              out(r).includes(
                `  FAIL ${EXT} — missing crewrig-provenance carrier on first body line (R7)\n`,
              ),
              out(r),
            ),
        ],
        [
          "summary",
          () => assert.match(out(r), /^FAILED: 1 upstream-owned extension component\(s\)/m),
        ],
      ]);
    });
  });

  it("check-extension-pivot rejects a command .toml without its .md sibling", () => {
    withBox((home, bin) => {
      const dir = path.join(home, "tree");
      const toml = "extensions/core/hello-world/commands/orphan.toml";
      write(dir, toml, 'description = "x"\nprompt = "y"\n');
      const r = run("check-extension-pivot", dir, home, bin);
      aggregate(r, [
        ["exit status", () => expectStatus(r, 1)],
        [
          "FAIL line",
          () =>
            assert.ok(
              out(r).includes(
                `  FAIL ${toml} — generated Gemini .toml has no pivot sibling commands/orphan.md (authored-native command)\n`,
              ),
              out(r),
            ),
        ],
        [
          "summary",
          () =>
            assert.match(out(r), /^FAILED: 1 extension component\(s\) are authored CLI-native/m),
        ],
      ]);
    });
  });
});
