// windows-governance-metadata-routing-layout.test.ts — the cross-system proof of the
// metadata-routing-layout group (spec 0259 R26-R28): check-component-metadata-keys,
// check-feedback-routing, check-core-paths, check-gemini-overlay-enrollment and
// check-claude-agent-layout run from PowerShell on Windows (the default shell elsewhere), against the
// real repository and against a fixture that makes each of them fail. Interpreters are resolved from
// the PARENT PATH before the child PATH is narrowed. The checks read the current directory, so each
// run changes into its tree for the duration of the synchronous spawn.
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
  WIN,
  expectStatus,
  resolveInterpreters,
  spawnEntry,
  why,
} from "./lib/windows-proof-support.ts";
import type { Run } from "./lib/windows-proof-support.ts";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
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
    fs.mkdtempSync(path.join(os.tmpdir(), "windows-governance-mrl-")),
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
  console.log(`windows-governance-mrl: ${entry}: ${interpreters.notes.join("; ")}`);
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

const skillWith = (metadata: string): string =>
  `---\nname: demo\nmetadata:\n${metadata}---\nBody.\n`;

describe("windows governance metadata-routing-layout: real repository", () => {
  const cases: ReadonlyArray<readonly [string, RegExp]> = [
    ["check-component-metadata-keys", /^OK: .+\n$/m],
    ["check-feedback-routing", /^OK: \d+ upstream-owned source\(s\) route feedback to canonical/m],
    ["check-core-paths", /^OK: all \d+ supported target\(s\) carry an excluded org channel/m],
    [
      "check-gemini-overlay-enrollment",
      /^OK: all \d+ deployed Gemini overlays are enrolled in context\.fileName\.$/m,
    ],
    ["check-claude-agent-layout", /^OK: .+\n$/m],
  ];
  for (const [entry, verdict] of cases) {
    it(`${entry} accepts the repository`, () => {
      withBox((home, bin) => {
        const r = run(entry, repo, home, bin);
        aggregate(r, [
          ["exit status", () => expectStatus(r, 0)],
          ["verdict line", () => assert.match(out(r), verdict)],
          ["no FAILED block", () => assert.doesNotMatch(out(r) + err(r), /FAILED:/)],
        ]);
      });
    });
  }
});

describe("windows governance metadata-routing-layout: failing fixtures", () => {
  it("check-component-metadata-keys rejects an inadmissible metadata key", () => {
    withBox((home, bin) => {
      const tree = path.join(home, "tree");
      write(tree, "artifacts/core/skills/demo/SKILL.md", skillWith("  bogus: 1\n"));
      const r = run("check-component-metadata-keys", tree, home, bin, { CREWRIG_REPO_DIR: tree });
      aggregate(r, [
        ["exit status", () => expectStatus(r, 1)],
        [
          "K1 diagnostic",
          () => assert.match(err(r), /SKILL\.md: K1 metadata\.bogus is not admitted/),
        ],
        ["FAILED line", () => assert.match(err(r), /^FAILED: /m)],
        ["no verdict on stdout", () => assert.equal(out(r), "")],
      ]);
    });
  });

  it("check-feedback-routing rejects a component whose feedback leaves canonical", () => {
    withBox((home, bin) => {
      const tree = path.join(home, "tree");
      const rel = "artifacts/core/skills/demo/SKILL.md";
      write(
        tree,
        rel,
        skillWith('  provenance:\n    canonical: "up/stream"\n    feedback: "fork/elsewhere"\n'),
      );
      const r = run("check-feedback-routing", tree, home, bin);
      aggregate(r, [
        ["exit status", () => expectStatus(r, 1)],
        [
          "FAIL line",
          () =>
            assert.ok(
              out(r).includes(
                `  FAIL ${rel} — feedback 'fork/elsewhere' != canonical 'up/stream'\n`,
              ),
              out(r),
            ),
        ],
        [
          "summary",
          () =>
            assert.match(
              out(r),
              /^FAILED: 1 upstream-owned source\(s\) route feedback away from canonical:$/m,
            ),
        ],
      ]);
    });
  });

  it("check-core-paths rejects a manifest entry absent from HEAD", () => {
    withBox((home, bin) => {
      const tree = path.join(home, "tree");
      fs.mkdirSync(tree);
      git(tree, "init", "-q");
      write(tree, "present.txt", "x\n");
      write(tree, "scripts/build-components.ts", "console.log('artifacts/out');\n");
      git(tree, "add", "-A");
      git(tree, "commit", "-q", "-m", "initial");
      write(tree, ".crewrig/core-paths.txt", "present.txt\tstrict\nphantom.txt\tstrict\n");
      const r = run("check-core-paths", tree, home, bin, { CREWRIG_REPO_DIR: tree });
      aggregate(r, [
        ["exit status", () => expectStatus(r, 1)],
        [
          "FAIL line",
          () =>
            assert.ok(
              err(r).includes(
                "  FAIL phantom.txt (strict) — does not resolve to tracked content at HEAD\n",
              ),
              err(r),
            ),
        ],
        [
          "summary",
          () =>
            assert.match(
              err(r),
              /^FAILED: 1 core-paths manifest entr\(y\/ies\) do not resolve at HEAD:$/m,
            ),
        ],
        ["no verdict on stdout", () => assert.equal(out(r), "")],
      ]);
    });
  });

  it("check-gemini-overlay-enrollment rejects a deployed overlay that is not enrolled", () => {
    withBox((home, bin) => {
      const tree = path.join(home, "tree");
      write(
        tree,
        "scripts/tests/lib/print-setup-declarations.ts",
        "process.stdout.write(JSON.stringify({cli: 'gemini', facts: " +
          "{'rules.shared.1': 'artifacts/core/rules/10_FOO.md -> <HOME>/.gemini/10_FOO.md'}}) + '\\n');\n",
      );
      write(tree, "config/gemini/settings.json", '{"context":{"fileName":["AGENTS.md"]}}\n');
      const r = run("check-gemini-overlay-enrollment", tree, home, bin, { CREWRIG_REPO_DIR: tree });
      aggregate(r, [
        ["exit status", () => expectStatus(r, 1)],
        [
          "FAILED line",
          () =>
            assert.match(
              err(r),
              /^FAILED: 1 deployed Gemini overlay\(s\) not enrolled in context\.fileName \(spec 0085\):$/m,
            ),
        ],
        ["offender", () => assert.match(err(r), /^ {2}- 10_FOO\.md$/m)],
        ["no verdict on stdout", () => assert.equal(out(r), "")],
      ]);
    });
  });

  it("check-claude-agent-layout rejects a non-markdown regular file", () => {
    withBox((home, bin) => {
      const tree = path.join(home, "tree");
      write(tree, ".claude/agents/ok.md", "fine\n");
      write(tree, ".claude/agents/notes.txt", "offender\n");
      const r = run("check-claude-agent-layout", tree, home, bin, { CREWRIG_REPO_DIR: tree });
      aggregate(r, [
        ["exit status", () => expectStatus(r, 1)],
        [
          "FAILED line",
          () =>
            assert.match(err(r), /^FAILED: 1 offending entr\(y\/ies\) under \.claude\/agents:$/m),
        ],
        ["offender", () => assert.match(err(r), /^ {2}- \.claude\/agents\/notes\.txt$/m)],
        ["no .claude verdict on stdout", () => assert.doesNotMatch(out(r), /\.claude\/agents/)],
      ]);
    });
  });

  it(
    "check-claude-agent-layout rejects a symlink named like an agent",
    { skip: WIN ? "symlink offender is POSIX-only (needs a privilege on win32)" : false },
    () => {
      withBox((home, bin) => {
        const tree = path.join(home, "tree");
        write(tree, "target.md", "real\n");
        fs.mkdirSync(path.join(tree, ".claude", "agents"), { recursive: true });
        fs.symlinkSync(
          path.join(tree, "target.md"),
          path.join(tree, ".claude", "agents", "link.md"),
        );
        const r = run("check-claude-agent-layout", tree, home, bin, { CREWRIG_REPO_DIR: tree });
        aggregate(r, [
          ["exit status", () => expectStatus(r, 1)],
          ["offender", () => assert.match(err(r), /^ {2}- \.claude\/agents\/link\.md$/m)],
          ["no .claude verdict on stdout", () => assert.doesNotMatch(out(r), /\.claude\/agents/)],
        ]);
      });
    },
  );
});
