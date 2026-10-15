// windows-create-extension-proof.ts — the cross-system proof of the extension scaffolder entry (spec
// 0258 R23-R27), modelled on windows-packaging-proof.ts. On Windows the entry runs from PowerShell and
// from `cmd.exe`, with `bash` absent from the child PATH (the interpreters are resolved from the PARENT
// environment first; `System32\bash.exe` never counts, a tripwire `bash` stands in for it) and with no
// `fzf` anywhere on the PATH. On POSIX the same assertions run with the entry started directly. Each run
// happens in a private copy of a hermetic sandbox repository (tracked files, a real `git init`, the root
// `package.json`, real copies of `js-yaml` and `argparse`). Failures are aggregated with their command,
// stdout and stderr; the elapsed time of each case is printed, never asserted.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { defaultIsFile } from "../../lib/worktree-claim/launch-windows.ts";
import { snapshot, writtenSince } from "./create-extension-observe.ts";
import { readGolden } from "./create-extension-golden.ts";
import { REPO, cloneTemplate, createTemplate, selectionOf } from "./create-extension-sandbox.ts";
import {
  assertNoBash,
  baseEnv,
  childPath,
  runEntry,
  toSlash,
  writeBins,
} from "./windows-packaging-driver.ts";
import { resolveInterpreters, why, WIN } from "./windows-proof-support.ts";
import type { Run, Shell } from "./windows-proof-support.ts";

export interface ProofCase {
  /** Bitmask of the offered components (bit 0 is the first of COMPONENT_BITS). */
  readonly mask: number;
  /** How the selection reaches the entry: the environment variable, or `--components`. */
  readonly form: "selection" | "components";
}

/** The environment form with all six components, then `--components` with another subset. */
export const CASES: readonly ProofCase[] = [
  { mask: 63, form: "selection" },
  { mask: 42, form: "components" },
];

const FZF_NAMES: readonly string[] = ["fzf", "fzf.exe", "fzf.cmd", "fzf.bat"];

/** The PATH entries that hold no `fzf`: the proof's child must not find one anywhere. */
export function dropFzf(dirs: readonly string[], isFile: (file: string) => boolean): string[] {
  return dirs.filter((dir) => !FZF_NAMES.some((name) => isFile(path.join(dir, name))));
}

/**
 * The child's PATH: the tripwire directory first, then on Windows the parent PATH minus every
 * directory holding a `bash.exe` other than System32 (see `childPath`), on POSIX only the system
 * directories (the node binary is started by its absolute path); never a directory holding `fzf`.
 */
export function proofPath(tripwire: string, parent: string): string {
  const isFile = (file: string): boolean => fs.existsSync(file);
  const systemRoot = process.env["SystemRoot"] ?? process.env["windir"] ?? "C:\\Windows";
  const base = WIN
    ? childPath([], parent, { platform: process.platform, systemRoot, isFile })
    : ["/usr/bin", "/bin"].join(path.delimiter);
  const dirs = dropFzf(base.split(path.delimiter).filter(Boolean), isFile);
  return [tripwire, path.dirname(process.execPath), ...dirs].join(path.delimiter);
}

function selectedComponents(mask: number): string[] {
  return selectionOf(mask).split("\n").filter(Boolean);
}

/** The files an entry wrote under `dir`, relative paths with `/`, sorted. */
function walkFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (rel: string): void => {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const next = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(next);
      else out.push(next);
    }
  };
  walk("");
  return out.sort();
}

/** The top-level keys of the skeleton fragment of a component. */
function fragmentKeys(component: string): { file: string; keys: string[] } {
  const dir = path.join(REPO, "extension-skeleton", component);
  const file = fs.readdirSync(dir).find((name) => name.endsWith(".json.fragment"));
  assert.ok(file !== undefined, `extension-skeleton/${component} holds no fragment`);
  const parsed: unknown = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
  assert.ok(typeof parsed === "object" && parsed !== null, `${file} is an object`);
  return { file, keys: Object.keys(parsed) };
}

/** Assertions on what one entry run left in its sandbox; every message carries the run's diagnostic. */
export function checkScaffold(
  root: string,
  name: string,
  c: ProofCase,
  run: Run,
  base: Record<string, string>,
): void {
  assert.equal(run.status, 0, why(run, "expected exit status 0"));
  const written = writtenSince(base, snapshot(root));
  const target = `extensions/org/${name}`;
  const manifest: unknown = JSON.parse(
    fs.readFileSync(path.join(root, target, "extension.json"), "utf8"),
  );
  assert.ok(
    typeof manifest === "object" && manifest !== null,
    why(run, "extension.json is an object"),
  );
  for (const component of selectedComponents(c.mask)) {
    const { file, keys } = fragmentKeys(component);
    for (const key of keys)
      assert.ok(
        Reflect.has(manifest, key),
        why(run, `extension.json lacks ${key} of ${component}`),
      );
    assert.ok(!fs.existsSync(path.join(root, target, file)), why(run, `${file} survives`));
  }
  const wanted = Object.keys(readGolden(c.mask).files);
  const got = Object.keys(written);
  const missing = wanted.filter((rel) => !got.includes(rel));
  const extra = got.filter((rel) => !wanted.includes(rel));
  assert.deepEqual(
    { missing, extra },
    { missing: [], extra: [] },
    why(run, "file set differs from the manifest"),
  );
  const bad: string[] = [];
  for (const rel of got) {
    if (rel.endsWith(".bak")) bad.push(`${rel}: a .bak file`);
    if (!rel.startsWith("extensions/") || written[rel] === "dir") continue;
    const bytes = fs.readFileSync(path.join(root, ...rel.split("/")));
    if (bytes.includes(13)) bad.push(`${rel}: holds a carriage return`);
    if (bytes.toString("latin1").includes("${SKELETON_")) bad.push(`${rel}: a surviving token`);
  }
  assert.deepEqual(bad, [], why(run, "scaffold hygiene"));
}

/** Run every case through each shell; returns the aggregated failures (empty on success). */
export function runProof(shells: readonly Shell[]): string[] {
  console.log(
    `windows-create-extension-proof: platform ${process.platform}, node ${process.version}`,
  );
  const failures: string[] = [];
  const tmp = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "windows-create-extension-")),
  );
  const template = createTemplate();
  const base = snapshot(template);
  const interpreters = resolveInterpreters({
    platform: process.platform,
    env: process.env,
    isFile: defaultIsFile,
  });
  console.log(`windows-create-extension-proof: ${interpreters.notes.join("; ")}`);
  const bins = writeBins(path.join(tmp, "tripwire"), false);
  const pathValue = proofPath(bins.dir, process.env["PATH"] ?? "");
  assert.deepEqual(
    dropFzf(pathValue.split(path.delimiter), fs.existsSync),
    pathValue.split(path.delimiter),
    "fzf on the PATH",
  );
  for (const shell of shells) {
    for (const c of CASES) {
      const label = `${shell}/${c.form}/mask${c.mask}`;
      const started = Date.now();
      const root = cloneTemplate(template);
      const home = path.join(root, ".home");
      fs.mkdirSync(home, { recursive: true });
      const name = `combo${c.mask}`;
      const extra: Record<string, string> = { NAME: name, TIER: "org", GIT_CONFIG_NOSYSTEM: "1" };
      if (c.form === "selection") extra["CREWRIG_TEST_FZF_SELECTION"] = selectionOf(c.mask);
      const args =
        c.form === "components" ? ["--components", selectedComponents(c.mask).join(",")] : [];
      const run = runEntry({
        script: toSlash(path.join(root, "scripts", "create-extension.ts")),
        args,
        cwd: root,
        shell,
        env: baseEnv(pathValue, home, home, extra),
        interpreters,
      });
      try {
        checkScaffold(root, name, c, run, base);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${label}: ${message}`);
        console.error(`windows-create-extension-proof: FAIL ${label}: ${message}`);
      }
      console.log(`windows-create-extension-proof: ${label}: ${Date.now() - started} ms`);
    }
  }
  try {
    assertNoBash(bins);
  } catch (error) {
    failures.push(`tripwire: ${error instanceof Error ? error.message : String(error)}`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  return failures;
}
