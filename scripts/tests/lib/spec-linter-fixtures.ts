// spec-linter-fixtures.ts — shared fixtures of the spec-linter replacement suites (spec 0265,
// row J2, P6). Replaces the helper functions at the top of scripts/tests/test-spec-linter.sh
// (render_spec, run_case, run_base_case, write_core_paths_fixture and the git fixture idiom).
//
// Sandbox: a mkdtemp root holding `.markdownlintrc`, `.crewrig/core-paths.txt` and
// `scripts/lib/spec-linter.js` (all copied from tracked files) plus ONE `node_modules`
// symlink to the checkout's. The symlink is deliberate (markdownlint-cli has too many
// transitive dependencies for a faithful copy, as the Bash suite also linked it); only the
// preflight cases (49-51) build their own real-copy roots, outside this helper.
//
// API:
//   renderSpec(opts?)              spec text (the Bash render_spec; extraFm lines are real lines)
//   HEADINGS                       the five mandatory headings, blank-line separated
//   lintSandbox(prefix?)           path of a fresh sandbox root (removed by an `after` hook)
//   newFixture(prefix?)            Fixture {root, put(rel, text), putSpec(rel, opts?)} on a sandbox
//   gitFixture(opts?)              Fixture initialised as a repo on `branch` (default main) with
//                                  `files` committed; `remote` adds origin pointing at itself
//   git(root, ...args)             git in a fixture, hermetic env; returns stdout, throws on failure
//   commitAll(root, message, paths?)  `git add <paths|specs>` then commit
//   manifestDir(content)           mkdtemp dir holding `.crewrig/core-paths.txt` = content
//   runLinter(root, args?, opts?)  child `node <root>/scripts/lib/spec-linter.js`; Result.output
//                                  is stdout followed by stderr
//   lintEnv(extra?)                the scrubbed child environment
// Nothing here deletes a path it did not create with mkdtemp.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after } from "node:test";
import { fileURLToPath } from "node:url";
import { scrubGitEnv } from "../../lib/git-env.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export const HEADINGS =
  "## Intent\n\n## Requirements\n\n## Scenarios\n\n## Out of scope\n\n## Open questions";

export interface SpecOpts {
  readonly id?: string;
  readonly slug?: string;
  readonly status?: string;
  readonly complexity?: string;
  /** Extra frontmatter lines (use "\n" for several keys). */
  readonly extraFm?: string;
  readonly headings?: string;
  readonly relatedIssue?: number | string;
}

export function renderSpec(o: SpecOpts = {}): string {
  const headings = o.headings === undefined || o.headings === "" ? HEADINGS : o.headings;
  return `---
id: "${o.id ?? "0001"}"
slug: "${o.slug ?? "test-spec"}"
status: "${o.status ?? "draft"}"
complexity: "${o.complexity ?? "standard"}"
version: 1.0.0
related-issue: ${o.relatedIssue ?? 123}
${o.extraFm ?? ""}
---

# Title

${headings}
`;
}

const roots = new Set<string>();
after(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
  roots.clear();
});

function mkRoot(prefix: string): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  roots.add(root);
  return root;
}

const scratchHome = mkRoot("spec-linter-home-");
// An empty file, not os.devNull: Windows git rejects the \\.\nul form as a config path.
const emptyGitConfig = path.join(scratchHome, "empty-gitconfig");
fs.writeFileSync(emptyGitConfig, "");

export function lintSandbox(prefix = "spec-linter-"): string {
  const root = mkRoot(prefix);
  fs.mkdirSync(path.join(root, "scripts", "lib"), { recursive: true });
  fs.mkdirSync(path.join(root, ".crewrig"));
  fs.copyFileSync(
    path.join(REPO, "scripts/lib/spec-linter.js"),
    path.join(root, "scripts/lib/spec-linter.js"),
  );
  fs.copyFileSync(
    path.join(REPO, ".crewrig/core-paths.txt"),
    path.join(root, ".crewrig/core-paths.txt"),
  );
  fs.copyFileSync(path.join(REPO, ".markdownlintrc"), path.join(root, ".markdownlintrc"));
  fs.symlinkSync(path.join(REPO, "node_modules"), path.join(root, "node_modules"));
  return root;
}

export interface Fixture {
  readonly root: string;
  put(rel: string, text: string): void;
  putSpec(rel: string, opts?: SpecOpts): void;
}

function wrap(root: string): Fixture {
  const put = (rel: string, text: string): void => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  return { root, put, putSpec: (rel, opts) => put(rel, renderSpec(opts)) };
}

export function newFixture(prefix?: string): Fixture {
  return wrap(lintSandbox(prefix));
}

export function manifestDir(content: string): string {
  const dir = mkRoot("spec-linter-manifest-");
  fs.mkdirSync(path.join(dir, ".crewrig"));
  fs.writeFileSync(path.join(dir, ".crewrig", "core-paths.txt"), content);
  return dir;
}

export function lintEnv(
  extra: Readonly<Record<string, string | undefined>> = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = scrubGitEnv(process.env);
  for (const k of [
    "CI",
    "BASE_REF",
    "CREWRIG_PR_DRAFT",
    "BRANCH_NAME",
    "GITHUB_HEAD_REF",
    "GITHUB_REF_NAME",
    "CI_MERGE_REQUEST_SOURCE_BRANCH_NAME",
    "CI_COMMIT_REF_NAME",
    "CREWRIG_REPO_DIR",
    "NODE_TEST_CONTEXT",
  ]) {
    delete env[k];
  }
  env.LC_ALL = "C";
  env.HOME = scratchHome;
  env.GIT_CONFIG_GLOBAL = emptyGitConfig;
  env.GIT_CONFIG_NOSYSTEM = "1";
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  return env;
}

export function git(root: string, ...args: string[]): string {
  const r = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", env: lintEnv() });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout;
}

export function commitAll(
  root: string,
  message: string,
  paths: readonly string[] = ["specs"],
): void {
  git(root, "add", ...paths);
  git(root, "commit", "-q", "-m", message);
}

export interface GitFixtureOpts {
  readonly branch?: string;
  /** Repo-relative path -> text, written then committed. */
  readonly files?: Readonly<Record<string, string>>;
  /** Add an `origin` remote pointing at the fixture itself, fetched. */
  readonly remote?: boolean;
}

export function gitFixture(o: GitFixtureOpts = {}): Fixture {
  const fx = newFixture();
  git(fx.root, "init", "-q");
  git(fx.root, "symbolic-ref", "HEAD", `refs/heads/${o.branch ?? "main"}`);
  git(fx.root, "config", "user.email", "test@example.com");
  git(fx.root, "config", "user.name", "Test");
  git(fx.root, "config", "commit.gpgsign", "false");
  for (const [rel, text] of Object.entries(o.files ?? {})) fx.put(rel, text);
  commitAll(fx.root, "base branch content");
  if (o.remote ?? true) {
    git(fx.root, "remote", "add", "origin", fx.root);
    git(fx.root, "fetch", "-q", "origin");
  }
  return fx;
}

export interface LintResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly output: string;
}

export interface RunLinterOpts {
  /** Working directory; default: the sandbox root. */
  readonly cwd?: string;
  /** Extra environment; `undefined` removes a variable. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export function runLinter(
  root: string,
  args: readonly string[] = [],
  o: RunLinterOpts = {},
): LintResult {
  const r = spawnSync(process.execPath, [path.join(root, "scripts/lib/spec-linter.js"), ...args], {
    cwd: o.cwd ?? root,
    env: lintEnv(o.env),
    encoding: "utf8",
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, output: r.stdout + r.stderr };
}
