// oracle-ts-runner.ts — copy-and-run helpers of install-oracle-mutation.test.ts: a template
// copy of the repository, one mutated copy per mutant, and a `node --test` run of named test
// files inside a copy, reduced to the labels of the leaf tests that failed.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { productionClosure, REPO } from "./build-fixture-tree.ts";

export interface Mutation {
  readonly id: string;
  readonly file: string;
  readonly from: string | null; // null: delete the file
  readonly to: string;
}

export interface SuiteRun {
  readonly status: number | null;
  readonly fails: string[];
  readonly out: string;
}

const live: string[] = [];

/** Remove every directory this module created (call from an `after` hook). */
export function cleanup(): void {
  for (const dir of live) fs.rmSync(dir, { recursive: true, force: true });
}

/** Track a scratch directory for `cleanup`. */
export function track(dir: string): string {
  live.push(dir);
  return dir;
}

/** A partial repository copy with a REAL (dereferenced) closure of the production dependencies. */
export function stageTemplate(): string {
  const root = track(fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "oracle-mut-"))));
  fs.cpSync(path.join(REPO, "scripts"), path.join(root, "scripts"), { recursive: true });
  for (const f of ["package.json", "package-lock.json", "Taskfile.yml", "crewrig.config.toml"]) {
    if (fs.existsSync(path.join(REPO, f))) fs.copyFileSync(path.join(REPO, f), path.join(root, f));
  }
  fs.mkdirSync(path.join(root, ".git"));
  for (const name of productionClosure()) {
    const from = path.join(REPO, "node_modules", name);
    fs.cpSync(from, path.join(root, "node_modules", name), { recursive: true, dereference: true });
  }
  return root;
}

/** A fresh copy of the template with `mutant` applied (or none for the baseline). */
export function stageCopy(template: string, mutant: Mutation | null): string {
  const dir = track(fs.mkdtempSync(path.join(template, "..", "oracle-run-")));
  fs.cpSync(template, dir, { recursive: true });
  if (mutant === null) return dir;
  const target = path.join(dir, mutant.file);
  if (mutant.from === null) {
    fs.rmSync(target);
    return dir;
  }
  const text = fs.readFileSync(target, "utf8");
  if (!text.includes(mutant.from)) {
    throw new Error(`mutant ${mutant.id}: target text not found in ${mutant.file}`);
  }
  fs.writeFileSync(
    target,
    text.replace(mutant.from, () => mutant.to),
  );
  return dir;
}

/** The labels of the leaf tests reported `not ok` (a parent only reports its failed children). */
export function leafFailures(tap: string): string[] {
  const lines = tap.split("\n");
  const fails: string[] = [];
  lines.forEach((line, i) => {
    const label = /^\s*not ok \d+ - (.*)$/.exec(line)?.[1];
    if (label === undefined) return;
    const rest = lines.slice(i + 1);
    const next = rest.findIndex((l) => /^\s*(not )?ok \d+ - /.test(l));
    const block = rest.slice(0, next < 0 ? rest.length : next).join("\n");
    if (!block.includes("subtestsFailed")) fails.push(label);
  });
  return fails.sort();
}

/** Run `files` with `node --test` in `dir`, as a developer machine would (no CI variable). */
export function runFiles(
  dir: string,
  files: readonly string[],
  pathOverride?: string,
): Promise<SuiteRun> {
  const home = path.join(dir, "home");
  fs.mkdirSync(home, { recursive: true });
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home, LC_ALL: "C" };
  if (pathOverride !== undefined) env["PATH"] = pathOverride;
  // The copy is a partial repository: a nested run must not inherit this run's context or CI mode.
  delete env["CI"];
  delete env["NODE_TEST_CONTEXT"];
  const args = [
    "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
    "--test",
    "--test-reporter=tap",
    ...files,
  ];
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: dir, env });
    let out = "";
    child.stdout.on("data", (c: Buffer) => (out += c.toString()));
    child.stderr.on("data", (c: Buffer) => (out += c.toString()));
    child.on("close", (status) => resolve({ status, fails: leafFailures(out), out }));
  });
}
