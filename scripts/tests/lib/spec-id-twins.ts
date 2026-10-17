// spec-id-twins.ts — scratch fixture and differential runner for the spec-id twins (spec 0262
// reqs 1-4, 22): a scratch bare remote named `crewrig`, a scratch clone, scratch HOME, a stub `gh`
// that must never be called, and a runner that executes the shell script and the TypeScript twin
// on two identically seeded sides.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const REPO = path.resolve(import.meta.dirname, "..", "..", "..");
const FIXED = {
  GIT_AUTHOR_NAME: "Differential",
  GIT_AUTHOR_EMAIL: "differential@example.invalid",
  GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
  GIT_COMMITTER_NAME: "Differential",
  GIT_COMMITTER_EMAIL: "differential@example.invalid",
  GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
};

export interface Side {
  root: string;
  bare: string;
  clone: string;
  home: string;
  bin: string;
}
export interface Outcome {
  status: number;
  stdout: string;
  stderr: string;
  refs: string;
}

export function baseEnv(side: Side, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...FIXED,
    LC_ALL: "C",
    HOME: side.home,
    PATH: `${side.bin}${path.delimiter}${process.env.PATH ?? ""}`,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    CREWRIG_REPO_DIR: side.clone,
    ...extra,
  };
  for (const key of Object.keys(env))
    if (
      /^(CREWRIG_SPEC_ID_|CREWRIG_PR_|CI_|GIT_(DIR|WORK_TREE|INDEX_FILE)$)/.test(key) &&
      !(key in extra) &&
      key !== "CREWRIG_REPO_DIR"
    )
      delete env[key];
  for (const key of ["BASE_REF", "CI", "GITHUB_ACTIONS", "GITLAB_CI"])
    if (!(key in extra)) delete env[key];
  return env;
}

export function git(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}): string {
  const full: NodeJS.ProcessEnv = {
    ...process.env,
    ...FIXED,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    ...env,
  };
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete full[key];
  const res = spawnSync("git", args, { cwd, env: full, encoding: "utf8" });
  if (res.status !== 0) throw new Error(`git ${args.join(" ")}: ${res.stderr}`);
  return res.stdout;
}

/** Req 22: refuse to continue when any remote URL of `repo` is not under `root`. */
export function assertUnderScratch(repo: string, root: string): void {
  const real = fs.realpathSync(root);
  for (const line of git(repo, ["remote", "-v"]).split("\n").filter(Boolean)) {
    const url = (line.split("\t")[1] ?? "").replace(/ \((fetch|push)\)$/, "");
    const resolved = fs.existsSync(url) ? fs.realpathSync(url) : url;
    if (!resolved.startsWith(real + path.sep)) throw new Error(`remote escapes scratch: ${url}`);
  }
}

export interface SideOptions {
  /** Files on main, repo-relative path to content. */
  files?: Record<string, string>;
  /** Reservation refs seeded on the bare remote, ref to commit subject. */
  reservations?: Record<string, string>;
  /** Remote name; empty for no remote at all. */
  remote?: string;
}

export function makeSide(parent: string, name: string, opts: SideOptions = {}): Side {
  const root = path.join(parent, name);
  const side: Side = {
    root,
    bare: path.join(root, "remote.git"),
    clone: path.join(root, "clone"),
    home: path.join(root, "home"),
    bin: path.join(root, "bin"),
  };
  for (const dir of [side.bare, side.clone, side.home, side.bin])
    fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(side.bin, "gh"),
    `#!/bin/sh\necho "$*" >> "$(dirname "$0")/gh.log"\nexit 99\n`,
    { mode: 0o755 },
  );
  git(root, ["init", "--bare", "--quiet", "-b", "main", side.bare]);
  git(side.clone, ["init", "--quiet", "-b", "main"]);
  const files = opts.files ?? { "specs/0001-first.md": "---\nid: 0001\n---\n" };
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(side.clone, rel)), { recursive: true });
    fs.writeFileSync(path.join(side.clone, rel), content);
  }
  git(side.clone, ["add", "-A"]);
  git(side.clone, ["commit", "--quiet", "-m", "seed"]);
  const remote = opts.remote ?? "crewrig";
  if (remote !== "") {
    git(side.clone, ["remote", "add", remote, side.bare]);
    assertUnderScratch(side.clone, root);
    git(side.clone, ["push", "--quiet", remote, "main"]);
    git(side.clone, ["fetch", "--quiet", remote]);
  }
  const tree = git(side.bare, ["hash-object", "-w", "-t", "tree", "/dev/null"]).trim();
  for (const [ref, subject] of Object.entries(opts.reservations ?? {})) {
    const oid = git(side.bare, ["commit-tree", tree, "-m", subject]).trim();
    git(side.bare, ["update-ref", ref, oid]);
  }
  return side;
}

export function refsOf(repo: string): string {
  return git(repo, ["for-each-ref", "--format=%(objectname) %(refname)"]);
}

function normalise(text: string, side: Side): string {
  return text.split(fs.realpathSync(side.root)).join("<ROOT>").split(side.root).join("<ROOT>");
}

export function runTool(
  side: Side,
  kind: "sh" | "ts",
  script: string,
  args: string[],
  env: Record<string, string>,
): Outcome {
  const file = path.join(REPO, "scripts", `${script}.${kind}`);
  const cmd =
    kind === "sh"
      ? ["bash", file]
      : [process.execPath, "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", file];
  const res = spawnSync(cmd[0] as string, [...cmd.slice(1), ...args], {
    cwd: side.clone,
    env: baseEnv(side, env),
    encoding: "utf8",
  });
  if (fs.existsSync(path.join(side.bin, "gh.log"))) throw new Error("the stub gh was called");
  return {
    status: res.status ?? -1,
    stdout: normalise(res.stdout, side),
    stderr: normalise(res.stderr, side),
    refs: normalise(refsOf(side.bare), side),
  };
}
