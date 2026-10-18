// model-resolve-golden.ts — the frozen shell leg of the model-resolve conformance suites
// (spec 0262 R17). scripts/lib/model-resolve.sh is deleted in the switch PR; its `Outcome` per
// case, and the merge directory it left behind, are stored under
// scripts/tests/fixtures/model-resolve-oracle/ and REPLAYED by the tests. Only
// model-resolve-golden-regen.ts, in the Linux container, records them (MODEL_RESOLVE_GOLDEN_REGEN=1).
//
// A case group is addressed by an id the caller passes: `<file>/<group>`. `<file>` names the JSON
// golden (`resolve-<file>.json.golden`); inside it each group holds `outcomes` (by case label)
// and `files` (the merge directory the shell wrote, relative path to text). Replay writes those
// files back into the case's `mergeDir`, but only when that directory lies under the OS temporary
// directory and the file is absent; it never deletes or overwrites anything.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { Outcome, ResolveCase } from "./shell-resolve-harness.ts";

const GOLDEN_DIR = path.resolve(import.meta.dirname, "..", "fixtures", "model-resolve-oracle");

interface Group {
  outcomes: Record<string, Outcome>;
  files: Record<string, string>;
}
type Store = Record<string, Group>;

const fileOf = (id: string): string =>
  path.join(GOLDEN_DIR, `resolve-${id.slice(0, id.indexOf("/"))}.json.golden`);
const groupOf = (id: string): string => id.slice(id.indexOf("/") + 1);

/** True only in the golden container run: the shell leg is executed and recorded. */
export const recording = (): boolean =>
  process.env["MODEL_RESOLVE_GOLDEN_REGEN"] === "1" && process.platform === "linux";

function load(id: string): Store {
  const file = fileOf(id);
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as Store) : {};
}

/** Every regular file below `dir`, relative path to text (symlinks and non-files are skipped). */
function snapshot(dir: string, rel = ""): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(path.join(dir, rel))) return out;
  for (const name of fs.readdirSync(path.join(dir, rel)).sort()) {
    const sub = path.posix.join(rel, name);
    const st = fs.lstatSync(path.join(dir, sub));
    if (st.isDirectory()) Object.assign(out, snapshot(dir, sub));
    else if (st.isFile()) out[sub] = fs.readFileSync(path.join(dir, sub), "utf8");
  }
  return out;
}

/** The first case's merge directory, only when it exists under the OS temporary directory. */
function mergeDirOf(cases: readonly ResolveCase[]): string | undefined {
  const dir = cases.find((c) => c.mergeDir !== undefined)?.mergeDir;
  if (dir === undefined || !fs.existsSync(dir)) return undefined;
  const tmp = fs.realpathSync(os.tmpdir());
  return fs.realpathSync(dir).startsWith(`${tmp}${path.sep}`) ? dir : undefined;
}

/** Store the shell's outcomes and merge directory for a group (the regen container only). */
export function record(
  cases: readonly ResolveCase[],
  id: string,
  outcomes: readonly Outcome[],
): void {
  const store = load(id);
  const dir = mergeDirOf(cases);
  store[groupOf(id)] = {
    outcomes: Object.fromEntries(cases.map((c, i) => [c.label, outcomes[i] as Outcome])),
    files: dir === undefined ? {} : snapshot(dir),
  };
  fs.mkdirSync(GOLDEN_DIR, { recursive: true });
  // groups finish in any order (the suites run them concurrently): sort for a stable file
  const sorted = Object.fromEntries(Object.entries(store).sort(([x], [y]) => (x < y ? -1 : 1)));
  fs.writeFileSync(fileOf(id), `${JSON.stringify(sorted, null, 1)}\n`);
}

/** The stored outcomes of a group, with its merge directory restored for the caller to inspect. */
export function replay(cases: readonly ResolveCase[], id: string): Outcome[] {
  const group = load(id)[groupOf(id)];
  if (group === undefined) throw new Error(`no golden for ${id}; record it with the regen script`);
  const dir = mergeDirOf(cases);
  if (dir !== undefined)
    for (const [rel, text] of Object.entries(group.files)) {
      const file = path.join(dir, ...rel.split("/"));
      // A golden key never leaves the merge directory (host-safety rule, issue #1673; review N1).
      if (path.relative(dir, file).split(path.sep)[0] === ".." || path.isAbsolute(rel))
        throw new Error(`golden key escapes the merge directory: ${rel}`);
      if (fs.existsSync(file)) continue;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
    }
  return cases.map((c) => {
    const outcome = group.outcomes[c.label];
    if (outcome === undefined) throw new Error(`no golden outcome for ${id}: ${c.label}`);
    return structuredClone(outcome);
  });
}
