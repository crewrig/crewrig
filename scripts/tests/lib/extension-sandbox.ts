// extension-sandbox.ts — the shared harness of the process-level extension suites (spec 0265, row
// J2; replaces the `make_sandbox` family of the retired Bash suites).
//
// A sandbox is a private clone of `createTemplate()`: the files git TRACKS (never a directory
// copy, so a host `node_modules`, `dist` or `build` cannot leak in), a real `git init`, the root
// `package.json` and REAL copies of the production closure of `js-yaml`. Entries run through
// `node scripts/<entry>.ts` from the sandbox root with `CI` and `NODE_TEST_CONTEXT` removed and
// `LC_ALL=C`; nothing here writes outside a directory `mkdtemp` created.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { REPO } from "./create-extension-sandbox.ts";

export {
  REPO,
  STAGED_PACKAGES,
  cloneTemplate,
  createTemplate,
  selectionOf,
  writeFile,
} from "./create-extension-sandbox.ts";
import { scrubGitEnv } from "../../lib/git-env.ts";

export interface EntryResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** stdout then stderr, the text the Bash suites captured with `2>&1`. */
  readonly combined: string;
}

/** Run `node scripts/<script>` (for example `build-extension.ts`) from the sandbox root. */
export function runEntry(
  root: string,
  script: string,
  args: readonly string[] = [],
  env: Readonly<Record<string, string>> = {},
): EntryResult {
  const childEnv: NodeJS.ProcessEnv = {
    ...scrubGitEnv(process.env),
    ...env,
    LC_ALL: "C",
    GIT_CONFIG_NOSYSTEM: "1",
  };
  delete childEnv["CI"];
  delete childEnv["NODE_TEST_CONTEXT"];
  const run = spawnSync(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", path.join("scripts", script), ...args],
    { cwd: root, encoding: "utf8", env: childEnv },
  );
  if (run.error !== undefined) throw run.error;
  return {
    status: run.status,
    stdout: run.stdout,
    stderr: run.stderr,
    combined: `${run.stdout}${run.stderr}`,
  };
}

/** `node scripts/build-extension.ts --check <names>` in the sandbox. */
export function check(root: string, ...names: string[]): EntryResult {
  return runEntry(root, "build-extension.ts", ["--check", ...names]);
}

/** `node scripts/build-extension.ts --target <target> <names>` in the sandbox. */
export function render(root: string, target: string, ...names: string[]): EntryResult {
  return runEntry(root, "build-extension.ts", ["--target", target, ...names]);
}

/** The source directory of an extension fixture inside the sandbox. */
export function extDir(root: string, name: string, tier = "core"): string {
  return path.join(root, "extensions", tier, name);
}

/** Write `extensions/<tier>/<name>/extension.json` (parents created); returns the directory. */
export function writeManifest(
  root: string,
  name: string,
  manifest: Readonly<Record<string, unknown>>,
  tier = "core",
): string {
  const dir = extDir(root, name, tier);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "extension.json"), `${JSON.stringify(manifest)}\n`);
  return dir;
}

/** The smallest valid manifest of the fixtures (`description: "fixture"`). */
export function fixtureManifest(
  name: string,
  extra: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return { name, version: "0.0.1", description: "fixture", ...extra };
}

/** An exact-text replacement in a SANDBOX file; throws when the anchor is absent. */
export function mutate(file: string, from: string, to: string): void {
  const text = fs.readFileSync(file, "utf8");
  if (!text.includes(from)) throw new Error(`mutation anchor absent in ${file}: ${from}`);
  fs.writeFileSync(
    file,
    text.replace(from, () => to),
  );
}

/**
 * The twin of the Bash `hook_file_present`: 0 when the file is there, 1 when it is missing, 2 when
 * the retired `hooks/*.sh` spelling is named or survives beside a `hooks/*.ts` entry.
 */
export function hookFilePresent(root: string, file: string): 0 | 1 | 2 {
  if (/^hooks\/.*\.sh$/.test(file)) return 2;
  if (/^hooks\/.*\.ts$/.test(file) && fs.existsSync(path.join(root, `${file.slice(0, -3)}.sh`)))
    return 2;
  return fs.existsSync(path.join(root, file)) ? 0 : 1;
}

/** Shell `case` glob semantics: `*` crosses `/`, `?` is one character, the rest is literal. */
export function globToRegExp(glob: string): RegExp {
  let source = "";
  for (const ch of glob) {
    if (ch === "*") source += ".*";
    else if (ch === "?") source += ".";
    else source += ch.replace(/[\\^$.*+?()[\]{}|/-]/g, "\\$&");
  }
  return new RegExp(`^${source}$`, "s");
}

/** Why python3 cannot act as the TOML validity oracle (`tomllib` needs 3.11), or `false`. */
export function tomlSkip(): string | false {
  const probe = spawnSync(
    "python3",
    ["-c", "import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)"],
    { encoding: "utf8" },
  );
  return probe.error === undefined && probe.status === 0
    ? false
    : "python3 >= 3.11 required for the tomllib validity check";
}

/** The `tomllib` parse error of a file, or "" when it parses (`tomlSkip()` must be false). */
export function tomlError(file: string): string {
  const run = spawnSync(
    "python3",
    ["-c", "import tomllib,sys; tomllib.load(open(sys.argv[1],'rb'))", file],
    { encoding: "utf8" },
  );
  return run.status === 0 ? "" : `${run.stdout}${run.stderr}`;
}

/** A field of the parsed TOML of a file (`tomlSkip()` must be false). */
export function tomlField(file: string, field: string): string {
  const run = spawnSync(
    "python3",
    [
      "-c",
      "import tomllib,sys; print(tomllib.load(open(sys.argv[1],'rb'))[sys.argv[2]])",
      file,
      field,
    ],
    { encoding: "utf8" },
  );
  if (run.status !== 0) throw new Error(`tomllib failed on ${file}: ${run.stderr}`);
  return run.stdout;
}

/** Every regular file under `dir` as `relative path (always "/") -> sha256`, sorted by path. */
export function treeDigest(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile())
        out[path.relative(dir, full).split(path.sep).join("/")] = createHash("sha256")
          .update(fs.readFileSync(full))
          .digest("hex");
    }
  };
  walk(dir);
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
}

export interface SkeletonScan {
  readonly componentDirs: number;
  readonly classEntries: number;
  readonly violations: readonly string[];
}

/**
 * Case 11(ii): scan the REAL `extension-skeleton/*` (read only). A violation is a file at a
 * component-dir root named in `manifest_class`, or any file matching a `generated_globs` entry.
 */
export function realSkeletonScan(): SkeletonScan {
  const cls = JSON.parse(
    fs.readFileSync(path.join(REPO, "scripts", "lib", "extension-generated-class.json"), "utf8"),
  ) as { manifest_class: string[]; generated_globs: string[] };
  const globs = cls.generated_globs.map(globToRegExp);
  const skeleton = path.join(REPO, "extension-skeleton");
  const violations: string[] = [];
  let componentDirs = 0;
  for (const comp of fs.readdirSync(skeleton, { withFileTypes: true })) {
    if (!comp.isDirectory()) continue;
    componentDirs += 1;
    const base = path.join(skeleton, comp.name);
    for (const rel of Object.keys(treeDigest(base))) {
      if (cls.manifest_class.includes(rel) || globs.some((re) => re.test(rel)))
        violations.push(`${comp.name}/${rel}`);
    }
  }
  return { componentDirs, classEntries: cls.manifest_class.length, violations };
}
