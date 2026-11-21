// init-scaffold.ts — what `crewrig init` must create, and how the init tests run it (spec 0314 R14-R17
// as amended by delta-01). Shared by crewrig-init.test.ts, crewrig-init-e2e.test.ts and
// crewrig-manifest-closure.test.ts, so the three agree on one definition of "exactly the scaffold".
//
// The expected listing is derived from the checkout, not from the implementation: the catalogs are the
// files git tracks under config/expertise, config/teams and config/level (R15: every file the directory
// holds in the pinned version), and the rest is the fixed list of R15.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { loadConfig, validateCanonicalRepo } from "../../lib/build-components/config.ts";
import {
  NO_TYPELESS_WARNING,
  ENTRY_POINT,
  REPO,
  copyTemplate,
  runNode,
  treeList,
  type Rig,
  type RunOptions,
  type RunResult,
} from "./launcher-rig.ts";

export const CANONICAL_REPO = "https://github.com/crewrig/crewrig";
export const TEMPLATE_FILES = ["README.md", "crewrig", "crewrig.pin.json"];
const CATALOGS = ["config/expertise", "config/teams", "config/level"];
const EMPTY_HOMES = ["artifacts/org/skills", "artifacts/org/agents", "artifacts/community/hooks"];

/** The files git tracks under the three catalogs of the checkout. */
export function catalogFiles(): string[] {
  const listed = spawnSync("git", ["ls-files", "-z", "--", ...CATALOGS], {
    cwd: REPO,
    encoding: "utf8",
  });
  if (listed.status !== 0) throw new Error(`git ls-files failed: ${listed.stderr}`);
  return listed.stdout.split("\0").filter((name) => name !== "");
}

/** The sorted listing of a template copy after a successful init (treeList format). */
export function expectedListing(template: readonly string[] = TEMPLATE_FILES): string[] {
  const files = [
    ...template,
    "crewrig.config.toml",
    "config/ORGANIZATION.md",
    "config/TOOLS.md",
    ...catalogFiles(),
    ...EMPTY_HOMES.map((home) => `${home}/.gitkeep`),
  ];
  const entries = new Set<string>(files);
  for (const file of files) {
    const parts = file.split("/");
    for (let i = 1; i < parts.length; i += 1) entries.add(`${parts.slice(0, i).join("/")}/`);
  }
  return [...entries].sort();
}

export interface ConfigFile {
  text: string;
  canonical: string;
  feedback: string;
}

/** crewrig.config.toml of `dir`, read as bytes and as the build reads it (spec 0314 R16, delta-01). */
export function readConfig(dir: string): ConfigFile {
  const text = fs.readFileSync(path.join(dir, "crewrig.config.toml"), "utf8");
  const io = { out: () => {}, err: () => {}, errRaw: () => {} };
  const config = loadConfig(dir, process.platform, io);
  const value = (key: string): string =>
    config.placeholders.find((placeholder) => placeholder.key === key)?.value ?? "";
  return { text, canonical: value("CANONICAL_REPO"), feedback: value("FEEDBACK_REPO") };
}

/** Everything R15, R16 and R17 say about a successful init in `dir`, with the catalogs of `source`. */
export function assertScaffold(
  dir: string,
  feedbackRepo: string,
  options: { source?: string; template?: readonly string[] } = {},
): void {
  const { source = REPO, template = TEMPLATE_FILES } = options;
  const listing = treeList(dir).filter((line) => line !== ".git/" && !line.startsWith(".git/"));
  assert.deepEqual([...listing].sort(), expectedListing(template));

  for (const file of catalogFiles()) {
    assert.deepEqual(
      fs.readFileSync(path.join(dir, file)),
      fs.readFileSync(path.join(source, file)),
      file,
    );
  }
  for (const name of ["ORGANIZATION.md", "TOOLS.md"]) {
    assert.deepEqual(
      fs.readFileSync(path.join(dir, "config", name)),
      fs.readFileSync(path.join(source, "config", `${name}.template`)),
      name,
    );
  }
  for (const home of EMPTY_HOMES) {
    assert.equal(
      fs.statSync(path.join(dir, home, ".gitkeep")).size,
      0,
      `${home}/.gitkeep is empty`,
    );
  }
  for (const absent of ["config/SOUL.md", "config/PROFILE.md", ".gitignore"]) {
    assert.ok(!fs.existsSync(path.join(dir, absent)), `${absent} is not created`);
  }

  const config = readConfig(dir);
  const lines = config.text.split("\n");
  assert.equal(lines.pop(), "", "every line, the last included, ends with a line feed");
  assert.ok(!config.text.includes("\r"));
  const keys = lines.filter((line) => !line.startsWith("#"));
  assert.deepEqual(keys, [
    `canonical_repo = "${CANONICAL_REPO}"`,
    `feedback_repo = "${feedbackRepo}"`,
  ]);
  for (const key of keys) {
    const at = lines.indexOf(key);
    assert.ok(lines[at - 1]?.startsWith("# "), `a comment above ${key.split(" ")[0]}`);
  }
  const feedbackComment = lines[lines.indexOf(`feedback_repo = "${feedbackRepo}"`) - 1] ?? "";
  assert.match(feedbackComment, /organization/i);
  assert.match(feedbackComment, /feedback/i);
  assert.equal(config.canonical, CANONICAL_REPO, "the build's reader finds canonical_repo");
  assert.equal(config.feedback, feedbackRepo, "the build's reader finds feedback_repo");
  validateCanonicalRepo({ placeholders: [], canonicalRepo: config.feedback });
}

/** A directory holding only what the template provides, with a pin that no run of init reads. */
export function templateOnlyDir(rig: Rig): string {
  return copyTemplate(rig, { version: "1.0.0-next.1", sha256: "0".repeat(64) });
}

/** `node <entry point> init <args>` in `dir`, as the launcher would run it from a verified version. */
export function runInit(
  rig: Rig,
  dir: string,
  args: readonly string[] = [],
  options: RunOptions & { entry?: string } = {},
): Promise<RunResult> {
  const { entry = ENTRY_POINT, ...rest } = options;
  return runNode(rig, entry, ["init", ...args], {
    cwd: dir,
    nodeArgs: [NO_TYPELESS_WARNING],
    ...rest,
  });
}

/** Run git in `cwd` with the rig's scrubbed environment; returns trimmed standard output. */
export function git(rig: Rig, cwd: string, args: readonly string[]): string {
  const run = spawnSync("git", args, { cwd, env: rig.env(), encoding: "utf8" });
  if (run.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${run.stderr}`);
  return run.stdout.trim();
}

/** Turn `dir` into a git repository whose `origin` URL is exactly `url`. */
export function withOrigin(rig: Rig, dir: string, url: string): void {
  git(rig, dir, ["init", "-q"]);
  git(rig, dir, ["remote", "add", "origin", "https://placeholder.invalid/x/y"]);
  git(rig, dir, ["config", "remote.origin.url", url]);
}
