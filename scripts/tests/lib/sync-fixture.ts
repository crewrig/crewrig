// sync-fixture.ts — shared fixtures for the scripts/sync-from-upstream.ts suites (spec 0260).
// Every repository is built with `git` alone under a private global configuration (identity,
// no signing, no CRLF conversion) with the system configuration disabled, in a realpath'ed
// temporary root. The entry is spawned with `process.execPath`; stdout and stderr are always
// captured.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scrubGitEnv } from "../../lib/git-env.ts";

export const ENTRY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "sync-from-upstream.ts",
);
export const REPO_ROOT = path.resolve(path.dirname(ENTRY), "..");

export interface Outcome {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** stdout and stderr, for assertion messages and "either stream" checks. */
  readonly output: string;
}

export interface SyncRoot {
  readonly root: string;
  /** Environment of every git and entry child: private global config, no system config. */
  readonly env: NodeJS.ProcessEnv;
  /** A fresh, unique, non-existent path under the root. */
  fresh(name: string): string;
  dispose(): void;
}

export function createSyncRoot(prefix = "crewrig-sync-"): SyncRoot {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  const globalConfig = path.join(root, "gitconfig");
  fs.writeFileSync(
    globalConfig,
    "[user]\n\tname = Test\n\temail = test@example.com\n[commit]\n\tgpgsign = false\n[core]\n\tautocrlf = false\n",
  );
  const env: NodeJS.ProcessEnv = {
    ...scrubGitEnv(process.env),
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_CONFIG_NOSYSTEM: "1",
  };
  delete env.CI;
  let counter = 0;
  return {
    root,
    env,
    fresh: (name) => path.join(root, `${name}-${(counter += 1)}`),
    dispose: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

export function git(sr: SyncRoot, cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, { cwd, env: sr.env, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}

export function writeFile(dir: string, rel: string, content: string): void {
  const file = path.join(dir, ...rel.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

export const read = (dir: string, rel: string): string =>
  fs.readFileSync(path.join(dir, ...rel.split("/")), "utf8");

export const exists = (dir: string, rel: string): boolean =>
  fs.existsSync(path.join(dir, ...rel.split("/")));

export const headOf = (sr: SyncRoot, repo: string): string =>
  git(sr, repo, "rev-parse", "HEAD").trim();

/** `git init` with the local identity and signing pin of the Bash `init_git_repo`. */
export function initRepo(sr: SyncRoot, dir: string, ...initArgs: string[]): void {
  fs.mkdirSync(dir, { recursive: true });
  git(sr, dir, "init", "-q", ...initArgs);
  git(sr, dir, "config", "user.email", "test@example.com");
  git(sr, dir, "config", "user.name", "Test");
  git(sr, dir, "config", "commit.gpgsign", "false");
}

/** Writes the files, stages them (`add -A`) and commits. */
export function commitFiles(
  sr: SyncRoot,
  dir: string,
  message: string,
  files: Record<string, string>,
): void {
  for (const [rel, content] of Object.entries(files)) writeFile(dir, rel, content);
  git(sr, dir, "add", "-A");
  git(sr, dir, "commit", "-q", "-m", message);
}

/** An upstream repository: `commits` are applied in order, one commit each. */
export function makeUpstream(
  sr: SyncRoot,
  commits: Array<Record<string, string>>,
  ...initArgs: string[]
): string {
  const dir = sr.fresh("upstream");
  initRepo(sr, dir, ...initArgs);
  commits.forEach((files, i) => commitFiles(sr, dir, `upstream ${i + 1}`, files));
  return dir;
}

export const tomlPath = (p: string): string => p.replaceAll("\\", "/");

export interface AdopterSpec {
  readonly upstream: string;
  /** `<path>[\t<policy>]` lines of .crewrig/core-paths.txt, e.g. `core\tstrict`. */
  readonly manifest: string[];
  /** The adopter's committed files, besides config and manifest. */
  readonly files?: Record<string, string>;
  /** Whole text of crewrig.config.toml; defaults to a `canonical_repo` of `upstream`. */
  readonly config?: string;
  readonly initArgs?: string[];
}

/** An adopter repository with config and manifest COMMITTED (untracked files would be ungoverned). */
export function makeAdopter(sr: SyncRoot, spec: AdopterSpec): string {
  const dir = sr.fresh("adopter");
  initRepo(sr, dir, ...(spec.initArgs ?? []));
  commitFiles(sr, dir, "initial", {
    ...spec.files,
    "crewrig.config.toml": spec.config ?? `canonical_repo = "${tomlPath(spec.upstream)}"\n`,
    ".crewrig/core-paths.txt": `${spec.manifest.join("\n")}\n`,
  });
  return dir;
}

/** A shallow clone (`file://` is required for `--depth` to apply) with the local identity pinned. */
export function cloneShallow(sr: SyncRoot, source: string, name = "shallow"): string {
  const dir = sr.fresh(name);
  git(sr, sr.root, "clone", "-q", "--depth", "1", `file://${tomlPath(source)}`, dir);
  git(sr, dir, "config", "user.email", "test@example.com");
  git(sr, dir, "config", "user.name", "Test");
  git(sr, dir, "config", "commit.gpgsign", "false");
  return dir;
}

/** A full clone of `source` with the local identity pinned. */
export function cloneFull(sr: SyncRoot, source: string, name = "clone"): string {
  const dir = sr.fresh(name);
  git(sr, sr.root, "clone", "-q", `file://${tomlPath(source)}`, dir);
  git(sr, dir, "config", "user.email", "test@example.com");
  git(sr, dir, "config", "user.name", "Test");
  git(sr, dir, "config", "commit.gpgsign", "false");
  return dir;
}

export function runSync(
  sr: SyncRoot,
  adopter: string,
  options: { args?: string[]; env?: NodeJS.ProcessEnv } = {},
): Outcome {
  const result = spawnSync(process.execPath, [ENTRY, ...(options.args ?? [])], {
    cwd: adopter,
    env: { ...(options.env ?? sr.env), CREWRIG_REPO_DIR: adopter },
    encoding: "utf8",
  });
  const { status, stdout, stderr } = result;
  return { status, stdout, stderr, output: `${stdout}${stderr}` };
}

/** Message for assertions: the outcome's streams, so an exit-only check stays diagnosable. */
export const why = (o: Outcome): string =>
  `status=${o.status}\nstdout:\n${o.stdout}\nstderr:\n${o.stderr}`;

/** True when `rev` carries a signature header (header block only; no trailing space: SHA-256 safe). */
export function commitIsSigned(sr: SyncRoot, repo: string, rev: string): boolean {
  const header = git(sr, repo, "cat-file", "commit", rev).split("\n\n")[0] ?? "";
  return header.split("\n").some((line) => line.startsWith("gpgsig"));
}

/** Whole-line `  <path>` entries of a dirty report: lines that start with exactly two spaces. */
export function dirtyReport(stderr: string): string[] {
  return stderr.split("\n").filter((line) => /^ {2}\S/.test(line));
}

/** Recursive listing `relpath -> content` of a directory, for tree comparison. */
export function treeOf(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (rel: string): void => {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const next = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(next);
      else out[next] = fs.readFileSync(path.join(dir, next), "utf8");
    }
  };
  if (fs.existsSync(dir)) walk("");
  return out;
}

/** True when `ssh-keygen -Y sign` works (OpenSSH >= 8.2): an ed25519 key is created in `keydir`. */
export function sshSigningCapable(keydir: string): boolean {
  fs.mkdirSync(keydir, { recursive: true });
  const keygen = spawnSync("ssh-keygen", [
    "-t",
    "ed25519",
    "-N",
    "",
    "-f",
    path.join(keydir, "signer"),
    "-q",
  ]);
  if (keygen.status !== 0) return false;
  const buffer = path.join(keydir, "smoke-buffer");
  fs.writeFileSync(buffer, "smoke test");
  const sign = spawnSync("ssh-keygen", [
    "-Y",
    "sign",
    "-f",
    path.join(keydir, "signer"),
    "-n",
    "test",
    buffer,
  ]);
  const ok = sign.status === 0 && fs.existsSync(`${buffer}.sig`);
  fs.rmSync(buffer, { force: true });
  fs.rmSync(`${buffer}.sig`, { force: true });
  return ok;
}
