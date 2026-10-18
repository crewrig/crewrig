// release-engine-fixture.ts — one throwaway monorepo checkout the REAL semantic-release engine and
// the real release driver run against (spec 0265 row J2; replaces the `make_fixture` family of
// scripts/tests/test-monorepo-release-engine.sh).
//
// A fixture is built under a `mkdtemp` root and removed by an `after` hook registered on import
// (the removal is confined to roots this module created). It holds:
//   - `repo/`: a copy of the git-TRACKED files of `scripts/` (minus `scripts/tests`), the root
//     `package.json` and `.markdownlintrc`, three real Gemini extensions `foo` 1.2.0, `bar` 0.4.1 and
//     `baz` 0.0.0, and the history the engine cases rely on (foo and bar baseline tags; foo feature,
//     docs-only, nested-reference and merge commits; baz one commit and no tag);
//   - `origin.git/`: a bare repository, reached through `NEUTRAL_ORIGIN_URL` redirected by the
//     fixture's own global gitconfig (`insteadOf`), so no network call can leave the machine;
//   - `node_modules/`: a real directory linking every installed package except the staged ones,
//     which are REAL copies (the loader refuses a package resolving outside the root).
//
// API:
//   ENGINE_SKIP                    a skip reason (win32 or missing semantic-release), else false
//   makeFixture()                  -> Fixture { fix, originBare, home, gitconfig, root }
//   writeGlobalGitconfig(file, originBare, extraUrl?, extraTarget?)
//   gitconfigWithForge(fx)         a second gitconfig that also redirects GITLAB_FORGE_URL to origin
//   originGit(fx, args)            git against the bare origin
//   plus everything of release-engine-env.ts, re-exported.
// Under CI a missing semantic-release is a hard failure (`requireEngine()`), locally a skip.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after } from "node:test";

import { REPO } from "./build-fixture-tree.ts";
import {
  GITLAB_FORGE_URL,
  NEUTRAL_ORIGIN_URL,
  cleanEnv,
  cleanGit,
  type DriverFixture,
} from "./release-engine-env.ts";

export * from "./release-engine-env.ts";

/** The packages copied for real (not linked) into the fixture's own `node_modules`. */
const STAGED_NODE_PACKAGES = ["js-yaml", "argparse"];

const hasEngine = fs.existsSync(path.join(REPO, "node_modules", "semantic-release"));

/** Skip reason for a leg that needs a POSIX host and the installed engine; `false` to run. */
export const ENGINE_SKIP: string | false =
  process.platform === "win32"
    ? "SKIP: POSIX-only leg (real git insteadOf redirection, bash driver)"
    : !hasEngine && process.env["CI"] === undefined
      ? "SKIP: node_modules/semantic-release is not installed (run npm install --include=dev)"
      : false;

/** Under CI the engine must be there: throw instead of skipping silently. */
export function requireEngine(): void {
  if (!hasEngine && process.env["CI"] !== undefined) {
    throw new Error("node_modules/semantic-release is not installed: run the dev dependency step");
  }
}

export interface Fixture extends DriverFixture {
  /** The `mkdtemp` root holding everything below. */
  readonly root: string;
  readonly originBare: string;
}

const live = new Set<string>();
after(() => {
  for (const dir of live) {
    if (path.basename(dir).startsWith("release-engine-")) {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }
  live.clear();
});

/** `[url "<target>"] insteadOf = <url>` blocks: the neutral origin URL, plus an optional second. */
export function writeGlobalGitconfig(
  file: string,
  originBare: string,
  extraUrl?: string,
  extraTarget?: string,
): void {
  let text = `[url "${originBare}"]\n\tinsteadOf = ${NEUTRAL_ORIGIN_URL}\n`;
  if (extraUrl !== undefined && extraTarget !== undefined) {
    text += `[url "${extraTarget}"]\n\tinsteadOf = ${extraUrl}\n`;
  }
  fs.writeFileSync(file, text);
}

/** GitLab PUBLISH works on the checkout directly: it needs an external redirect for its forge URL. */
export function gitconfigWithForge(fx: Fixture, name = "gitconfig-forge"): string {
  const file = path.join(fx.root, name);
  writeGlobalGitconfig(file, fx.originBare, GITLAB_FORGE_URL, fx.originBare);
  return file;
}

/** `git -C <origin.git> <args>`, clean env, stdout. */
export function originGit(fx: Fixture, args: readonly string[]): string {
  return cleanGit(fx.home, fx.originBare, args);
}

function writeExtension(fix: string, name: string, version: string): void {
  const dir = path.join(fix, "extensions", "core", name);
  fs.mkdirSync(dir, { recursive: true });
  const manifest = {
    name,
    version,
    description: `fixture extension ${name}`,
    context: { source: "CONTEXT.md" },
    gemini: { themes: [] },
    claude: {
      author: { name: "fixture" },
      defaultAllowedTools: ["Read"],
      settings: {},
      lsp: {},
      bin: null,
    },
  };
  fs.writeFileSync(path.join(dir, "extension.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(
    path.join(dir, "package.json"),
    `${JSON.stringify({ name: `${name}-extension`, version })}\n`,
  );
  fs.writeFileSync(path.join(dir, "CONTEXT.md"), `fixture context for ${name}\n`);
}

/** The tracked files of the repository's `scripts/` (not `scripts/tests`), copied with their modes. */
function copyTrackedScripts(fix: string): void {
  const res = spawnSync("git", ["-C", REPO, "ls-files", "-z", "--", "scripts"], {
    env: { ...cleanEnv(os.tmpdir()), GIT_CONFIG_NOSYSTEM: "1" },
    encoding: "utf8",
    maxBuffer: 1 << 26,
  });
  if (res.status !== 0) throw new Error(`git ls-files failed: ${res.stderr}`);
  for (const rel of res.stdout.split("\0").filter((f) => f !== "")) {
    if (rel.startsWith("scripts/tests/")) continue;
    const from = path.join(REPO, rel);
    if (!fs.lstatSync(from, { throwIfNoEntry: false })?.isFile()) continue;
    const to = path.join(fix, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    fs.chmodSync(to, fs.statSync(from).mode & 0o777);
  }
}

/** A real `node_modules`: every installed package linked, the staged ones copied for real. */
function stageNodeModules(fix: string): void {
  const source = path.join(REPO, "node_modules");
  const target = path.join(fix, "node_modules");
  fs.mkdirSync(target);
  for (const name of fs.readdirSync(source)) {
    if (STAGED_NODE_PACKAGES.includes(name)) continue;
    fs.symlinkSync(path.join(source, name), path.join(target, name));
  }
  for (const name of STAGED_NODE_PACKAGES) {
    const from = path.join(source, name);
    if (!fs.existsSync(from)) throw new Error(`${from} is missing: run the setup dependency step`);
    fs.cpSync(from, path.join(target, name), { recursive: true, dereference: true });
  }
}

/** Build ONE fresh fixture (own root, own bare origin); every case builds its own. */
export function makeFixture(): Fixture {
  requireEngine();
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "release-engine-")));
  live.add(root);
  const fix = path.join(root, "repo");
  const home = path.join(root, "home");
  const originBare = path.join(root, "origin.git");
  const gitconfig = path.join(root, "gitconfig-global");
  fs.mkdirSync(fix);
  fs.mkdirSync(home);

  copyTrackedScripts(fix);
  // The changelog facade lints CHANGELOG.md with the repository's own markdownlint configuration.
  fs.copyFileSync(path.join(REPO, ".markdownlintrc"), path.join(fix, ".markdownlintrc"));
  fs.copyFileSync(path.join(REPO, "package.json"), path.join(fix, "package.json"));
  fs.writeFileSync(path.join(fix, ".gitignore"), "node_modules/\ndist/\nbuild/\n");
  writeExtension(fix, "foo", "1.2.0");
  writeExtension(fix, "bar", "0.4.1");
  writeExtension(fix, "baz", "0.0.0");

  const git = (...args: string[]): string => cleanGit(home, fix, args);
  const append = (rel: string, line: string): void => {
    fs.appendFileSync(path.join(fix, ...rel.split("/")), `${line}\n`);
  };
  const FOO = "extensions/core/foo/CONTEXT.md";
  git("init", "-q", "-b", "main");
  git("config", "user.name", "fixture");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "commit.gpgsign", "false");
  git("add", "-A");
  git("commit", "-q", "-m", "chore: init fixture");
  git("tag", "foo-v1.2.0");
  git("tag", "bar-v0.4.1");

  // foo: in-project and cross-project issue references, a docs-only commit, a NESTED reference
  // (acme/sub/other#5, which gitmoji's regex would resolve to the wrong project), a merge commit.
  append(FOO, "// feature 1");
  git("add", "-A");
  git("commit", "-q", "-m", ":sparkles: add foo feature (#12)");
  fs.mkdirSync(path.join(fix, "docs"));
  fs.writeFileSync(path.join(fix, "docs", "NOTE.md"), "docs only\n");
  git("add", "-A");
  git("commit", "-q", "-m", ":memo: update docs");
  append(FOO, "// feature 2");
  git("add", "-A");
  git("commit", "-q", "-m", ":bug: fix foo bug (other/lib#3, acme/sub/other#5)");
  git("checkout", "-q", "-b", "topic");
  append(FOO, "// topic");
  git("add", "-A");
  git("commit", "-q", "-m", ":sparkles: topic work");
  git("checkout", "-q", "main");
  git("merge", "-q", "--no-ff", "-m", "Merge branch 'topic'", "topic");
  // baz: one commit, no prior tag (FIRST_RELEASE).
  append("extensions/core/baz/CONTEXT.md", "// baz feature");
  git("add", "-A");
  git("commit", "-q", "-m", ":sparkles: baz first feature");

  // `--initial-branch=main` is not redundant with a hermetic env: HEAD would otherwise dangle.
  cleanGit(home, root, ["init", "-q", "--bare", "--initial-branch=main", originBare]);
  writeGlobalGitconfig(gitconfig, originBare);
  git("remote", "add", "origin", NEUTRAL_ORIGIN_URL);
  cleanGit(home, fix, ["push", "-q", "origin", "main", "--tags"], gitconfig);

  stageNodeModules(fix);
  return { root, fix, originBare, home, gitconfig };
}
