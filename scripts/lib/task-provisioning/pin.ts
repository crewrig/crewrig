// pin.ts — check (d) of the Task provisioning guard (spec 0282 R6): the pin is well formed, not
// below the Taskfile floor, and not duplicated outside its allowed carriers.

import fs from "node:fs";
import path from "node:path";

import { run as buildCi } from "../build-ci/entry.ts";
import { type TaskPin, parseTaskPin } from "../build-ci/tools.ts";
import { globToRegExp } from "../glob-engine.ts";
import { loadTaskfileTree } from "../taskfile-tree.ts";

const PIN_FILE = "ci/task-pin.json";
const SCOPE = [".github/**", "ci/**", "scripts/**", "taskfiles/**", ".gitlab-ci.yml"].map(
  globToRegExp,
);
const EXCLUDED = [globToRegExp("scripts/tests/**")];

function walk(dir: string, rel: string, out: string[]): void {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel === "" ? e.name : `${rel}/${e.name}`;
    if (e.name === "node_modules" || e.name === ".git") continue;
    if (e.isDirectory()) walk(path.join(dir, e.name), r, out);
    else if (e.isFile()) out.push(r);
  }
}

function majorMinor(v: string): [number, number] | null {
  const m = /^(\d+)\.(\d+)/.exec(v);
  return m === null ? null : [Number(m[1]), Number(m[2])];
}

/** Read and validate the pin; throws a fail-closed Error naming the file on a bad pin. */
export function readPin(repoDir: string): { pin: TaskPin; findings: string[] } {
  const file = path.join(repoDir, PIN_FILE);
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    throw new Error(`${PIN_FILE}: missing or unreadable (R6d)`);
  }
  const pin = parseTaskPin(text);
  const findings: string[] = [];
  const canon = JSON.stringify(JSON.parse(text), null, 2) + "\n";
  if (canon !== text)
    findings.push(`${PIN_FILE}: not one key per line, two-space pretty JSON (R6d)`);
  const keys = Object.keys(JSON.parse(text) as object)
    .sort()
    .join(",");
  if (keys !== "sha256,version")
    findings.push(`${PIN_FILE}: keys must be exactly version and sha256 (R6d)`);
  const root = loadTaskfileTree(repoDir).nodes[0];
  const floor = majorMinor(String(root?.version ?? ""));
  const have = majorMinor(pin.version);
  if (floor === null || have === null)
    throw new Error("Taskfile.yml: unreadable `version:` floor (R6d)");
  if (have[0] < floor[0] || (have[0] === floor[0] && have[1] < floor[1]))
    findings.push(
      `${PIN_FILE}: version ${pin.version} is below the Taskfile floor ${floor.join(".")} (R6d)`,
    );
  return { pin, findings };
}

/** Duplicate carriers and a stale generated `.gitlab-ci.yml`. */
export function checkCarriers(repoDir: string, pin: TaskPin): string[] {
  const out: string[] = [];
  const sums = Object.values(pin.sha256);
  const urls = [`releases/download/v${pin.version}/task_`];
  const files: string[] = [];
  for (const top of [".github", "ci", "scripts", "taskfiles"])
    if (fs.existsSync(path.join(repoDir, top))) walk(path.join(repoDir, top), top, files);
  if (fs.existsSync(path.join(repoDir, ".gitlab-ci.yml"))) files.push(".gitlab-ci.yml");
  for (const f of files) {
    if (!SCOPE.some((re) => re.test(f)) || EXCLUDED.some((re) => re.test(f))) continue;
    if (f === PIN_FILE || f === ".gitlab-ci.yml") continue;
    const text = fs.readFileSync(path.join(repoDir, f), "utf8");
    if (sums.some((sum) => text.includes(sum)))
      out.push(`${f}: duplicates the pinned checksum (R6d)`);
    if (urls.some((u) => text.includes(u)))
      out.push(`${f}: duplicates the pinned download URL (R6d)`);
  }
  const gen = buildCi(["--check"], repoDir);
  if (gen.code !== 0)
    out.push(
      `.gitlab-ci.yml: stale or ungeneratable against the pin (${gen.stderr.trim() || gen.stdout.trim()}) (R6d)`,
    );
  return out;
}
