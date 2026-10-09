// windows-build-proof.ts — the cross-system proof of the component build (spec 0250 R14, R28,
// R29, spec Scenario 1; plan steps 24-25). Not a test suite: a script the `windows-latest` job
// runs under pwsh after the production install, and the Linux `build-components-ts` job runs
// too, so the same bytes are proven on both systems against the one committed tree.
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/tests/lib/windows-build-proof.ts
//
// Steps, each timed (R29: the times are recorded, never asserted):
//   1. `--list-output-dirs`          the nine declared directories, exit 0;
//   2. `--target all --check`        on this checkout: exit 0 and the line
//                                    `OK: All generated files match source.`;
//   3. a build into a throwaway `REPO_DIR` made of the committed `artifacts/`, `model-mappings/`
//      and `crewrig.config.toml` (the write path, which `--check` never exercises);
//   4. every file of the four committed trees under the declared directories equals the file
//      the throwaway build wrote, byte for byte, and the two sets of files are the same (the
//      checkout is LF everywhere: `.gitattributes`).
// Exit 0 on success; on any mismatch a message naming the first differing file and exit 1.
//
// `node:` built-ins only (the production install does not carry the dev tools). The entry runs
// from this checkout with `REPO_DIR` pointing at the throwaway root, so `js-yaml` resolves from
// the checkout's own `node_modules` (a `.git` entry and a real `node_modules/js-yaml` with its
// `argparse`, which the job's production install provides). Native separators only on win32.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const ENTRY = path.join(REPO, "scripts", "build-components.ts");
const INPUTS = ["artifacts", "model-mappings", "crewrig.config.toml"];
const OK_LINE = "OK: All generated files match source.";
const DIRS = [
  ".agents/agents",
  ".agents/skills",
  ".claude/agents",
  ".claude/skills",
  ".gemini/agents",
  ".gemini/commands",
  ".gemini/skills",
  ".github/agents",
  ".github/skills",
];

class Failure extends Error {}

function fail(message: string): never {
  throw new Failure(message);
}

function timed<T>(label: string, work: () => T): T {
  const started = process.hrtime.bigint();
  try {
    return work();
  } finally {
    const ms = Number((process.hrtime.bigint() - started) / 1_000_000n);
    console.log(`windows-build-proof: ${label}: ${ms} ms`);
  }
}

/** Run the entry from this checkout; `REPO_DIR` is whatever the step names, never inherited. */
function entry(
  args: string[],
  repoDir?: string,
): { status: number | null; stdout: string; stderr: string } {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env["REPO_DIR"];
  if (repoDir !== undefined) env["REPO_DIR"] = repoDir;
  const res = spawnSync(process.execPath, [ENTRY, ...args], {
    cwd: REPO,
    env,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (res.error !== undefined) fail(`could not run the entry: ${res.error.message}`);
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

/** Every regular file below `root/<dir>`, as `/`-separated paths relative to `root`. */
function walk(root: string, dir: string, into: string[]): void {
  const abs = path.join(root, ...dir.split("/"));
  if (!fs.existsSync(abs)) return;
  for (const item of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = `${dir}/${item.name}`;
    if (item.isDirectory()) walk(root, rel, into);
    else if (item.isFile()) into.push(rel);
  }
}

/** The committed files under the declared directories (`git ls-files`; a walk where git is absent). */
function committedFiles(): string[] {
  const res = spawnSync("git", ["ls-files", "-z", "--", ...DIRS], { cwd: REPO, encoding: "utf8" });
  if (res.error === undefined && res.status === 0) {
    return res.stdout
      .split("\0")
      .filter((file) => file !== "")
      .sort();
  }
  const found: string[] = [];
  for (const dir of DIRS) walk(REPO, dir, found);
  return found.sort();
}

function listStep(): void {
  const res = entry(["--list-output-dirs"]);
  if (res.status !== 0) fail(`--list-output-dirs exited ${res.status}: ${res.stderr}`);
  const lines = res.stdout.split("\n").filter((line) => line !== "");
  if (lines.join("\n") !== DIRS.join("\n")) {
    fail(`--list-output-dirs printed ${JSON.stringify(lines)}, expected ${JSON.stringify(DIRS)}`);
  }
}

function checkStep(): void {
  const res = entry(["--target", "all", "--check"]);
  if (res.status !== 0) {
    const tail = res.stdout.split("\n").slice(-12).join("\n");
    fail(
      `--target all --check exited ${res.status}\n${tail}\n${res.stderr.split("\n").slice(-6).join("\n")}`,
    );
  }
  if (!res.stdout.split("\n").includes(OK_LINE)) fail(`--check did not print "${OK_LINE}"`);
}

function buildStep(root: string): void {
  for (const input of INPUTS) {
    fs.cpSync(path.join(REPO, input), path.join(root, input), { recursive: true });
  }
  const res = entry(["--target", "all"], root);
  if (res.status !== 0)
    fail(`the build into ${root} exited ${res.status}: ${res.stderr.slice(-600)}`);
}

function compareStep(root: string): number {
  const committed = committedFiles();
  const built: string[] = [];
  for (const dir of DIRS) walk(root, dir, built);
  built.sort();
  const committedSet = new Set(committed);
  const builtSet = new Set(built);
  const missing = committed.find((file) => !builtSet.has(file));
  if (missing !== undefined) fail(`${missing} is committed but the build did not write it`);
  const extra = built.find((file) => !committedSet.has(file));
  if (extra !== undefined) fail(`${extra} was written by the build but is not committed`);
  for (const file of committed) {
    const native = file.split("/");
    const expected = fs.readFileSync(path.join(REPO, ...native));
    const actual = fs.readFileSync(path.join(root, ...native));
    if (Buffer.compare(expected, actual) !== 0) {
      const at = expected.findIndex((byte, i) => byte !== actual[i]);
      fail(
        `${file} differs from the committed file (${actual.length} bytes written, ${expected.length} committed, first difference at byte ${at})`,
      );
    }
  }
  return committed.length;
}

function main(): void {
  console.log(`windows-build-proof: ${process.platform}, Node.js ${process.version}`);
  timed("--list-output-dirs", listStep);
  timed("--target all --check", checkStep);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-build-proof-"));
  try {
    timed("build into a throwaway REPO_DIR", () => buildStep(root));
    const count = timed("compare with the committed trees", () => compareStep(root));
    console.log(`windows-build-proof: OK: ${count} files identical to the committed trees`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`windows-build-proof: FAILED: ${message}`);
  process.exitCode = 1;
}
