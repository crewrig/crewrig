// setup-golden-all.ts — the golden cases of one setup, concatenated from the four cell modules
// (spec 0256 requirement 7, plan v2 step A4). Modules are loaded lazily so a missing one fails
// with a message naming it, not an opaque loader error; ids must be unique per cli.

import { createRequire } from "node:module";

import { CLIS } from "./setup-golden-types.ts";
import type { Cli, GoldenCase } from "./setup-golden-types.ts";

const MODULES = [
  "./setup-golden-cases-spec-a.ts",
  "./setup-golden-cases-spec-b.ts",
  "./setup-golden-cases-pins-a.ts",
  "./setup-golden-cases-pins-b.ts",
] as const;

const load = createRequire(import.meta.url);

function isCase(value: unknown): value is GoldenCase {
  if (typeof value !== "object" || value === null) return false;
  const cli: unknown = Reflect.get(value, "cli");
  return typeof Reflect.get(value, "id") === "string" && CLIS.some((known) => known === cli);
}

function casesOf(file: string): readonly GoldenCase[] {
  let mod: unknown;
  try {
    mod = load(file);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`setup-golden-all: cannot load the case module ${file}: ${reason}`);
  }
  const cases: unknown = typeof mod === "object" && mod !== null ? Reflect.get(mod, "cases") : null;
  if (!Array.isArray(cases) || !cases.every(isCase)) {
    throw new Error(`setup-golden-all: ${file} must export \`cases\`, an array of GoldenCase`);
  }
  return cases;
}

/** Every case of `cli`, in module order; throws on a duplicate id. */
export function casesFor(cli: Cli): readonly GoldenCase[] {
  const mine = MODULES.flatMap((file) => casesOf(file)).filter((c) => c.cli === cli);
  const seen = new Set<string>();
  for (const c of mine) {
    if (seen.has(c.id)) throw new Error(`setup-golden-all: duplicate case id ${cli}/${c.id}`);
    seen.add(c.id);
  }
  return mine;
}
