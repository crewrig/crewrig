// ci-parity-fixture.ts — hermetic fixtures for the check-ci-parity replacement suites.
//
// A fixture is a temporary COPY of the git-tracked `ci/`, `.github/` and `.gitlab-ci.yml`
// of this checkout, mutated by the case, then run through `scripts/check-ci-parity.ts`
// with `CREWRIG_REPO_DIR=<fixture>` (the entry composes the build-ci twin from the
// checkout, so the fixture needs no `scripts/`). Nothing tracked is ever edited in
// place; only directories created here by `mkdtemp` are removed, at process exit.
//
// YAML edits: `editYaml` is a load-modify-dump over the real `js-yaml` and DROPS
// comments. The one workflow comment the entry reads (`# ci-capability:` on
// `pages.yml`) is therefore edited with `replaceOnce`, which is text-surgical.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { yamlLib } from "./yaml-lib.ts";

/** The checkout under test. */
export const REPO: string = path.resolve(import.meta.dirname, "..", "..", "..");
const ENTRY = path.join(REPO, "scripts", "check-ci-parity.ts");
const TRACKED = ["ci", ".github", ".gitlab-ci.yml"];

export interface CheckResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

const created = new Set<string>();
process.on("exit", () => {
  const base = fs.realpathSync(os.tmpdir());
  for (const dir of created) {
    // Containment: only a directory this module created under the temp dir.
    if (path.dirname(dir) === base) fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** A fresh copy of the tracked `ci/`, `.github/` and `.gitlab-ci.yml`; returns its root. */
export function makeFixture(): string {
  const listed = spawnSync("git", ["ls-files", "-z", "--", ...TRACKED], {
    cwd: REPO,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (listed.status !== 0) throw new Error(`git ls-files failed: ${listed.stderr}`);
  const files = listed.stdout.split("\0").filter((p) => p !== "");
  if (files.length === 0) throw new Error("ci-parity fixture: no tracked file to copy");
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-ci-parity-")));
  created.add(root);
  for (const rel of files) {
    const to = path.join(root, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(REPO, rel), to);
  }
  return root;
}

/** The child environment: no `CI`, no `NODE_TEST_CONTEXT`, `LC_ALL=C`, the fixture as repo. */
export function childEnv(fixture: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, LC_ALL: "C", CREWRIG_REPO_DIR: fixture };
  delete env["CI"];
  delete env["NODE_TEST_CONTEXT"];
  return env;
}

/** Run the entry over `fixture` (extra `args` follow the entry path). */
export function runCheck(fixture: string, args: readonly string[] = []): CheckResult {
  const res = spawnSync(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", ENTRY, ...args],
    { env: childEnv(fixture), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (res.error) throw res.error;
  return { status: res.status ?? -1, stdout: res.stdout, stderr: res.stderr };
}

/** Replace the single occurrence of `from` in `file`; throws when absent, repeated or unchanged. */
export function replaceOnce(file: string, from: string, to: string): void {
  const text = fs.readFileSync(file, "utf8");
  const at = text.indexOf(from);
  if (at < 0) throw new Error(`replaceOnce: '${from}' is absent from ${file}`);
  if (text.indexOf(from, at + from.length) >= 0) {
    throw new Error(`replaceOnce: '${from}' occurs more than once in ${file}`);
  }
  const next = text.slice(0, at) + to + text.slice(at + from.length);
  if (next === text) throw new Error(`replaceOnce: replacing '${from}' changed nothing in ${file}`);
  fs.writeFileSync(file, next);
}

export type YMap = Record<string, unknown>;

/** Narrow to a mapping or throw. */
export function map(value: unknown, what = "value"): YMap {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`expected a mapping for ${what}`);
  }
  return value as YMap;
}

/** Narrow to a sequence or throw. */
export function list(value: unknown, what = "value"): unknown[] {
  if (!Array.isArray(value)) throw new Error(`expected a sequence for ${what}`);
  return value;
}

/** Load `file`, let `edit` mutate the document, dump it back (comments are dropped). */
export function editYaml(file: string, edit: (doc: YMap) => void): void {
  const doc = map(yamlLib.load(fs.readFileSync(file, "utf8")), file);
  edit(doc);
  fs.writeFileSync(file, yamlLib.dump(doc, { lineWidth: -1, noRefs: true }));
}

/** The reference capability `id` of a loaded `ci-capabilities.yml`; throws when absent. */
export function capOf(doc: YMap, id: string): YMap {
  const found = list(doc["capabilities"], "capabilities").find((c) => map(c)["id"] === id);
  if (found === undefined) throw new Error(`no capability '${id}' in the reference`);
  return map(found, `capability ${id}`);
}

/** `paths` of the `kind` trigger (`pull-request`, `push`) of `id` in the REAL, unmutated reference. */
export function refPaths(id: string, kind: string): string[] {
  const doc = map(
    yamlLib.load(fs.readFileSync(path.join(REPO, "ci", "ci-capabilities.yml"), "utf8")),
  );
  const trigger = list(capOf(doc, id)["trigger"], `trigger of ${id}`).find(
    (t) => map(t)["on"] === kind,
  );
  if (trigger === undefined) throw new Error(`capability '${id}' has no '${kind}' trigger`);
  return list(map(trigger)["paths"], `paths of ${id}/${kind}`).map(String);
}
