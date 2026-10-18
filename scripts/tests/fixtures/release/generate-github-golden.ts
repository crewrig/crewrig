// generate-github-golden.ts — Regenerate github-releaserc.golden.json from the PRE-REFACTOR release
// driver (spec 0213 PLAN v2 test 10c; replaces generate-github-golden.sh, spec 0265 row J2).
//
// The golden is the `.releaserc.json` that `main`'s own heredoc wrote before the release driver was
// refactored. It cannot be written by hand: the heredoc bakes four run-time values into the JSON (the
// branch, the extension name, the absolute repository root and release-output paths). So this script
// RUNS the historical driver, unmodified, in a throwaway fixture checkout:
//   - extension `foo` (extensions/core/foo/package.json), branch `main`;
//   - `npx` is shadowed by a shim that copies the `.releaserc.json` the driver wrote into the current
//     extension directory, then exits 0 (no engine);
//   - every occurrence of the fixture's absolute root is replaced, as a literal string (split/join,
//     never a regex), by the fixed placeholder `/ROOT`; keys are sorted (equal to `jq -S .`).
//
// Usage (from the repository root, POSIX only: it runs `bash` on the historical script):
//   node scripts/tests/fixtures/release/generate-github-golden.ts [<ref>] \
//     > scripts/tests/fixtures/release/github-releaserc.golden.json
// <ref> defaults to bbd6cf6, the last `main` commit whose scripts/monorepo-release.sh still carried the
// heredoc (it already loads semantic-release-gitmoji through its ESM facade, issue #1225). The repository
// is the working directory, not this file's location. Never run on macOS to regenerate the committed
// golden: regenerate it in a Linux container. Exit 2: the ref has no driver; exit 1: it wrote no config.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REF = process.argv[2] ?? "bbd6cf6";
const GIT_ENV = {
  PATH: process.env["PATH"] ?? "",
  LC_ALL: "C",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: os.devNull,
};

function git(cwd: string, args: readonly string[], env: Record<string, string> = GIT_ENV) {
  return spawnSync("git", ["-C", cwd, ...args], { env, encoding: "utf8", maxBuffer: 1 << 26 });
}

/** Recursively replace the literal `root` in every string; sort object keys (jq -S). */
function walk(value: unknown, root: string): unknown {
  if (typeof value === "string") return value.split(root).join("/ROOT");
  if (Array.isArray(value)) return value.map((item) => walk(item, root));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = walk((value as Record<string, unknown>)[key], root);
    }
    return out;
  }
  return value;
}

const cwd = process.cwd();
const shown = git(cwd, ["show", `${REF}:scripts/monorepo-release.sh`]);
if (git(cwd, ["cat-file", "-e", `${REF}:scripts/monorepo-release.sh`]).status !== 0) {
  process.stderr.write(`Error: ${REF} has no scripts/monorepo-release.sh\n`);
  process.exit(2);
}

const work = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "golden-")));
let captured = "";
let root = "";
try {
  root = path.join(work, "root");
  const bin = path.join(work, "bin");
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(root, "extensions", "core", "foo"), { recursive: true });
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(root, "scripts", "monorepo-release.sh"), shown.stdout);
  fs.writeFileSync(
    path.join(root, "extensions", "core", "foo", "package.json"),
    '{"name":"foo","version":"1.2.0"}\n',
  );
  // The shim stands in for `npx semantic-release`: it captures the config the driver wrote into the
  // extension directory (its cwd at call time).
  const shim = path.join(bin, "npx");
  fs.writeFileSync(shim, `#!/bin/bash\ncp .releaserc.json "${path.join(work, "captured.json")}"\n`);
  fs.chmodSync(shim, 0o755);

  const author = ["-c", "user.name=golden", "-c", "user.email=golden@example.invalid"];
  git(root, ["init", "-q", "-b", "main"]);
  git(root, [...author, "add", "-A"]);
  git(root, [...author, "commit", "-q", "-m", "fixture"]);

  // ROOT_DIR inside the driver is `$(pwd)`: the literal root to replace is this physical path.
  const env: Record<string, string> = { ...GIT_ENV, HOME: work };
  env["PATH"] = `${bin}${path.delimiter}${GIT_ENV.PATH}`;
  spawnSync("bash", ["scripts/monorepo-release.sh"], { cwd: root, env, stdio: "ignore" });
  const file = path.join(work, "captured.json");
  if (fs.existsSync(file)) captured = fs.readFileSync(file, "utf8");
} finally {
  // Confined to the directory created by mkdtemp just above.
  if (path.basename(work).startsWith("golden-")) fs.rmSync(work, { recursive: true, force: true });
}

if (captured.trim() === "") {
  process.stderr.write(`Error: the driver at ${REF} wrote no .releaserc.json\n`);
  process.exit(1);
}
process.stdout.write(`${JSON.stringify(walk(JSON.parse(captured), root), null, 2)}\n`);
