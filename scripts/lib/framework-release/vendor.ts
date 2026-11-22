// vendor.ts — stage js-yaml in the build output for the archive (spec 0315 step 6, plan v2-F2, v2-F3, v3-F4).
//
// The commands `build` and `setup` read YAML with js-yaml, which the archive ships under `dist/vendor/` so
// that a version root needs no `node_modules`. The staged copy is the ESM build of the installed package,
// checked against the version that `package-lock.json` pins; a mismatch fails the release build.
//
// Each file is written to a temporary name unique to this process, then renamed over the target, so two
// builds running at once never publish a torn copy (v3-F4). A target whose bytes already match is left
// alone, so a repeated build changes nothing.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export class VendorError extends Error {}

/** The directory of the staged copy, relative to the repository root (git-ignored output, `dist/`). */
export const VENDOR_DIR = path.join("dist", "vendor", "js-yaml");

/** The files staged: the ESM build the commands import, and the license it is distributed under. */
const FILES: readonly { from: string; to: string }[] = [
  { from: path.join("dist", "js-yaml.mjs"), to: "js-yaml.mjs" },
  { from: "LICENSE", to: "LICENSE" },
];

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new VendorError(`cannot read ${path.basename(file)}: ${reason}`);
  }
}

/** The version of js-yaml that package-lock.json pins. */
export function lockedJsYamlVersion(root: string): string {
  const lock = readJson(path.join(root, "package-lock.json")) as {
    packages?: Record<string, { version?: unknown } | undefined>;
  };
  const version = lock.packages?.["node_modules/js-yaml"]?.version;
  if (typeof version !== "string") {
    throw new VendorError("package-lock.json does not pin node_modules/js-yaml");
  }
  return version;
}

/** The installed js-yaml package directory, which must match the locked version. */
function installedDir(root: string): string {
  const dir = path.join(root, "node_modules", "js-yaml");
  const pkg = readJson(path.join(dir, "package.json")) as { version?: unknown };
  const locked = lockedJsYamlVersion(root);
  if (pkg.version !== locked) {
    throw new VendorError(
      `installed js-yaml ${String(pkg.version)} differs from package-lock.json ${locked}; run npm ci`,
    );
  }
  return dir;
}

/** Write `bytes` to `target` through a temporary file unique to this process, then rename it. */
function publish(target: string, bytes: Buffer): void {
  const temp = `${target}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(temp, bytes, { flag: "wx" });
    fs.renameSync(temp, target);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

/**
 * Stage js-yaml under `<root>/dist/vendor/js-yaml/`. Returns the staged file paths (relative to `root`)
 * whose bytes were written, so a caller can report them; a file already current is not in the list.
 * @throws VendorError when the installed package is absent or differs from the lock.
 */
export function stageJsYaml(root: string): string[] {
  const source = installedDir(root);
  const targetDir = path.join(root, VENDOR_DIR);
  fs.mkdirSync(targetDir, { recursive: true });
  const written: string[] = [];
  for (const file of FILES) {
    const from = path.join(source, file.from);
    if (!fs.existsSync(from)) throw new VendorError(`js-yaml package lacks ${file.from}`);
    const bytes = fs.readFileSync(from);
    const target = path.join(targetDir, file.to);
    if (fs.existsSync(target) && fs.readFileSync(target).equals(bytes)) continue;
    publish(target, bytes);
    written.push(path.join(VENDOR_DIR, file.to));
  }
  return written;
}
