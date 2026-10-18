// host-safety-fixtures.ts — fixture trees and the child-process runner for check-host-safety.test.ts
// (issue #1673, spec 0267 R14-R15).
//
// Host safety: every fixture lives under ONE directory made with `fs.mkdtempSync` below the realpath
// of `os.tmpdir()`, and `disposeFixture` removes ONLY a root this module itself created (it keeps
// the set; nothing is derived from env, argv, HOME or PATH). The scanned fixture sources contain
// destructive calls aimed at a canary directory inside that same root; the checker must parse them
// and execute nothing, so `runCheck` asserts after EVERY run that the canary is intact and that the
// sentinel a probe source would write if executed is absent.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** The checker under test; HOST_SAFETY_CHECKER points the suite at a mutated copy (mutation proof). */
export const CHECKER =
  process.env.HOST_SAFETY_CHECKER ?? path.join(REPO, "scripts", "check-host-safety.ts");

export const ALLOWLIST_REL = "ci/host-safety-allowlist.txt";
export const ALLOWLIST_HEADER = "# fixture allowlist\n";

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: "ES2023",
    module: "preserve",
    moduleResolution: "bundler",
    allowImportingTsExtensions: true,
    noEmit: true,
    skipLibCheck: true,
  },
  include: ["**/*.ts"],
});

const created = new Set<string>();

export interface Fixture {
  /** The mkdtemp root; also `CREWRIG_REPO_DIR` for the run. */
  readonly root: string;
  /** Canary directory and the file inside it, both made by the fixture. */
  readonly canaryDir: string;
  readonly canaryFile: string;
  /** A probe source writes this when executed; it must never exist. */
  readonly sentinel: string;
  /** A directory the child gets as HOME, so a HOME-derived path stays inside the root. */
  readonly home: string;
}

export interface FixtureOptions {
  /** Scanned sources, repository-relative (`scripts/tests/x.ts`) to content. */
  readonly sources?: Readonly<Record<string, string>>;
  /** Allowlist text; `undefined` writes the header only, `null` writes no allowlist at all. */
  readonly allowlist?: string | null;
  /** Skip creating `scripts/lib/` (a missing scan root). */
  readonly noLibDir?: boolean;
}

function put(root: string, rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

/** Build a fixture tree: tsconfig, scanned sources, allowlist, canary, and the executed-probe source. */
export function makeFixture(opts: FixtureOptions = {}): Fixture {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "host-safety-")),
  );
  created.add(root);
  const canaryDir = path.join(root, "canary");
  const canaryFile = path.join(canaryDir, "keep.txt");
  const sentinel = path.join(root, "sentinel-executed");
  const home = path.join(root, "home");
  fs.mkdirSync(canaryDir);
  fs.mkdirSync(home);
  fs.writeFileSync(canaryFile, "canary");

  put(root, "tsconfig.json", TSCONFIG);
  if (!opts.noLibDir) put(root, "scripts/lib/noop.ts", "export const noop = 1;\n");
  // Probe: if anything executed this file, the sentinel would appear and the canary vanish. The
  // literal paths are clean origins, so the probe itself is never a finding.
  put(
    root,
    "scripts/tests/probe-never-executed.ts",
    `import fs from "node:fs";\n` +
      `fs.writeFileSync(${JSON.stringify(sentinel)}, "executed");\n` +
      `fs.rmSync(${JSON.stringify(canaryDir)}, { recursive: true, force: true });\n`,
  );
  for (const [rel, content] of Object.entries(opts.sources ?? {})) put(root, rel, content);
  if (opts.allowlist !== null) put(root, ALLOWLIST_REL, opts.allowlist ?? ALLOWLIST_HEADER);
  return { root, canaryDir, canaryFile, sentinel, home };
}

/** Remove a fixture root; refuses anything this module did not create with mkdtemp. */
export function disposeFixture(fx: Fixture): void {
  if (!created.has(fx.root)) throw new Error(`refusing to remove ${fx.root}: not a fixture root`);
  fs.rmSync(fx.root, { recursive: true, force: true });
  created.delete(fx.root);
}

export interface CheckResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** Finding lines (`host-safety: <rule>: ...`) with the summary line and notes excluded. */
  readonly findings: readonly string[];
}

const FINDING = /^host-safety: ([a-z-]+): (\S+): /;

/** Run the checker against `repoDir` (default: the fixture root) and assert nothing was executed. */
export function runCheck(
  fx: Fixture | null,
  extraEnv: Readonly<Record<string, string>> = {},
  repoDir: string = fx?.root ?? REPO,
): CheckResult {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env))
    if (key.startsWith("GIT_") || key === "BASE_REF") delete env[key];
  env.CREWRIG_REPO_DIR = repoDir;
  if (fx !== null) {
    env.HOME = fx.home;
    env.CANARY_DIR = fx.canaryDir;
  }
  Object.assign(env, extraEnv);
  const res = spawnSync(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", CHECKER],
    { cwd: fx?.root ?? REPO, env, encoding: "utf8" },
  );
  if (fx !== null) {
    assert.ok(
      fs.existsSync(fx.canaryFile),
      "canary file was removed: a scanned source was executed",
    );
    assert.equal(fs.readFileSync(fx.canaryFile, "utf8"), "canary");
    assert.ok(!fs.existsSync(fx.sentinel), "sentinel exists: a scanned source was executed");
  }
  const stderr = res.stderr ?? "";
  return {
    status: res.status,
    stdout: res.stdout ?? "",
    stderr,
    findings: stderr.split("\n").filter((l) => FINDING.test(l)),
  };
}

/** Initialise a git repo at the fixture root with one commit of everything in it, on branch `main`. */
export function commitAll(fx: Fixture): void {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: path.join(fx.root, "gitconfig"),
    GIT_AUTHOR_NAME: "fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.invalid",
  };
  fs.writeFileSync(path.join(fx.root, "gitconfig"), "");
  for (const args of [
    ["init", "-q", "-b", "main"],
    ["add", "-A"],
    ["-c", "commit.gpgsign=false", "commit", "-q", "-m", "base"],
  ]) {
    const res = spawnSync("git", ["-C", fx.root, ...args], { env, encoding: "utf8" });
    assert.equal(res.status, 0, `git ${args.join(" ")} failed: ${res.stderr}`);
  }
}

/** Overwrite the allowlist of a fixture (used after the base commit, for the growth arm). */
export function writeAllowlist(fx: Fixture, text: string): void {
  put(fx.root, ALLOWLIST_REL, text);
}

// --- fixture sources -------------------------------------------------------------------------

const IMPORTS = `import fs from "node:fs";\nimport os from "node:os";\nimport path from "node:path";\n`;

/** Env-derived `rmSync` aimed at the canary: the canonical finding (line 6 of the file). */
export const ENV_RM = `${IMPORTS}export function wipe(): void {
  const dir = process.env.CANARY_DIR as string;
  fs.rmSync(dir, { recursive: true, force: true });
}
`;
export const ENV_RM_LINE = 6;
export const ENV_RM_KEY = "scripts/tests/wipe.ts::wipe::fs.rmSync#1";

export const GUARDED_RM = `${IMPORTS}import { assertInside } from "./lib/differential-guard.ts";
export function wipe(): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "x-"));
  const dir = process.env.CANARY_DIR as string;
  assertInside(root, dir);
  fs.rmSync(dir, { recursive: true, force: true });
}
`;

export const OWN_MKDTEMP_RM = `${IMPORTS}export function scratch(): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "x-"));
  fs.rmSync(dir, { recursive: true, force: true });
}
`;

export const HOME_CP = `${IMPORTS}export function copyIn(src: string): void {
  fs.cpSync(src, path.join(process.env.HOME as string, "x"), { recursive: true });
}
`;

export const ARGV_RENAME = `${IMPORTS}declare function parseOptions(argv: string[]): { portFile: string };
export function publish(staging: string): void {
  const options = parseOptions(process.argv.slice(2));
  fs.renameSync(staging, options.portFile);
}
`;

export const SCOPE_COLLISION = `import fs from "node:fs";
import { spawnSync } from "node:child_process";
export function run(): void {
  const roots = process.argv.slice(2);
  for (const r of roots) console.log(r);
  const r = spawnSync(process.execPath, ["--version"], { encoding: "utf8" });
  fs.rmSync(r.stdout.trim(), { recursive: true, force: true });
}
`;

export const TMPDIR_MKDTEMP = `${IMPORTS}export function scratch(): void {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "x-"));
  fs.rmSync(dir, { recursive: true, force: true });
}
`;

/** The incident shape: the unsafe path reaches the delete only through a parameter of a helper. */
export const PARAMETER_HELPER = `${IMPORTS}function removeScratch(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}
export function main(): void {
  removeScratch(process.env.CANARY_DIR as string);
}
`;

/** Union forms: ONE untrusted branch taints the binding, whatever the mkdtemp fallback (i1-F2). */
const unionRm = (
  initializer: string,
): string => `${IMPORTS}export function scratch(flag: boolean): void {
  const dir = ${initializer};
  fs.rmSync(dir, { recursive: true, force: true });
}
`;
export const NULLISH_MKDTEMP_RM = unionRm(
  `process.env.CANARY_DIR ?? fs.mkdtempSync(path.join(os.tmpdir(), "x-"))`,
);
export const OR_MKDTEMP_RM = unionRm(
  `process.env.CANARY_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "x-"))`,
);
export const TERNARY_MKDTEMP_RM = unionRm(
  `flag ? (process.env.CANARY_DIR as string) : fs.mkdtempSync(path.join(os.tmpdir(), "x-"))`,
);
/** Every branch is an mkdtemp result, so the binding stays clean. */
export const TERNARY_ALL_CLEAN_RM = unionRm(
  `flag ? fs.mkdtempSync(path.join(os.tmpdir(), "a-")) : fs.mkdtempSync(path.join(os.tmpdir(), "b-"))`,
);
/** A later assignment from an untrusted source taints a binding that began as an mkdtemp result. */
export const REASSIGNED_RM = `${IMPORTS}export function scratch(): void {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "x-"));
  dir = process.env.CANARY_DIR as string;
  fs.rmSync(dir, { recursive: true, force: true });
}
`;

/** A guard whose root is a union with an untrusted branch is not containment. */
export const UNION_ROOT_GUARDED_RM = `${IMPORTS}import { assertInside } from "./lib/differential-guard.ts";
export function wipe(): void {
  const root = process.env.CANARY_ROOT ?? fs.mkdtempSync(path.join(os.tmpdir(), "x-"));
  const dir = process.env.CANARY_DIR as string;
  assertInside(root, dir);
  fs.rmSync(dir, { recursive: true, force: true });
}
`;
/** The same guard, with a root whose every branch is an mkdtemp result, does contain. */
export const ALL_CLEAN_ROOT_GUARDED_RM = `${IMPORTS}import { assertInside } from "./lib/differential-guard.ts";
export function wipe(flag: boolean): void {
  const root = flag ? fs.mkdtempSync(path.join(os.tmpdir(), "a-")) : fs.mkdtempSync(path.join(os.tmpdir(), "b-"));
  const dir = process.env.CANARY_DIR as string;
  assertInside(root, dir);
  fs.rmSync(dir, { recursive: true, force: true });
}
`;
