// component-resolve-golden.ts — the frozen shell leg of the component-resolve suites (spec 0262
// R17). scripts/lib/component-resolve.sh was deleted in row I2 (recorded from
// `git show 15edd56a:scripts/lib/component-resolve.sh` in the golden container); what the shell printed for
// each (function, input) pair is stored under scripts/tests/fixtures/component-resolve-oracle/ and
// REPLAYED by the tests. Only the Linux golden container records it, with
// COMPONENT_RESOLVE_GOLDEN_REGEN=1 (see model-resolve-golden-regen.ts for the container recipe;
// the regen script there runs the suites that use this module).
//
// A frozen call is keyed by a hash of its input (the layout, body and environment, or the
// arguments) after the caller's `roots` (a random temporary directory, the checkout) are
// replaced by placeholders; the stored value is scrubbed the same way and the placeholders are
// put back on replay, so a golden holds no host path. The stored files are JSON, written sorted.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { scrubPath } from "./path-scrub.ts";

const DIR = path.resolve(import.meta.dirname, "..", "fixtures", "component-resolve-oracle");

/** True only in the golden container run: the shell leg is executed and recorded. */
export const recording = (): boolean =>
  process.env["COMPONENT_RESOLVE_GOLDEN_REGEN"] === "1" && process.platform === "linux";

/** `<placeholder>` to the real path it stands for in this process, longest path first. */
/**
 * The recording paths source a shell library that no longer exists in the checkout: refuse with
 * the recipe instead of failing inside `bash`. Restore it from history first (see the header of
 * model-resolve-golden-regen.ts) and run in the golden container.
 */
export function requireShellLibrary(repo: string, rel: string): void {
  if (!fs.existsSync(path.join(repo, rel)))
    throw new Error(
      `${rel} is retired (row I2): the goldens can no longer be recorded here; restore it with ` +
        `\`git show 15edd56a:${rel}\` into the golden container (see model-resolve-golden-regen.ts)`,
    );
}

export type Roots = Readonly<Record<string, string>>;
const swap = (text: string, roots: Roots, back: boolean): string => {
  const pairs = Object.entries(roots).sort(([, a], [, b]) => b.length - a.length);
  return pairs.reduce(
    (t, [name, real]) => (back ? t.replaceAll(name, real) : scrubPath(t, real, name)),
    text,
  );
};

const fileOf = (file: string): string => path.join(DIR, `${file}.json.golden`);
const load = (file: string): Record<string, unknown> =>
  fs.existsSync(fileOf(file))
    ? (JSON.parse(fs.readFileSync(fileOf(file), "utf8")) as Record<string, unknown>)
    : {};

/** A string input is its own key (an explicit case id); anything else is hashed. */
const keyOf = (input: unknown, roots: Roots): string =>
  typeof input === "string"
    ? input
    : createHash("sha256")
        .update(swap(JSON.stringify(input), roots, false))
        .digest("hex");

function replay<T>(file: string, key: string, roots: Roots): T {
  const store = load(file);
  if (!(key in store)) throw new Error(`no golden in ${file} for ${key}: record it (see header)`);
  return JSON.parse(swap(JSON.stringify(store[key]), roots, true)) as T;
}

function save(file: string, key: string, value: unknown, roots: Roots): void {
  const store = load(file);
  store[key] = JSON.parse(swap(JSON.stringify(value), roots, false));
  const sorted = Object.fromEntries(Object.entries(store).sort(([a], [b]) => (a < b ? -1 : 1)));
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(fileOf(file), `${JSON.stringify(sorted, null, 1)}\n`);
}

/** The stored value for `input` (any JSON); `live` runs, and is stored, only when recording. */
export function frozen<T>(file: string, input: unknown, roots: Roots, live: () => T): T {
  const key = keyOf(input, roots);
  if (!recording()) return replay<T>(file, key, roots);
  const value = live();
  save(file, key, value, roots);
  return value;
}

/** `frozen` for a shell leg that is asynchronous. */
export async function frozenAsync<T>(
  file: string,
  input: unknown,
  roots: Roots,
  live: () => Promise<T>,
): Promise<T> {
  const key = keyOf(input, roots);
  if (!recording()) return replay<T>(file, key, roots);
  const value = await live();
  save(file, key, value, roots);
  return value;
}
