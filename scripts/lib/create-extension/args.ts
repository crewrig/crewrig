// args.ts — argument and environment parsing of `scripts/create-extension.ts` (spec 0258 R23-R25).
// Twin of the first lines of scripts/create-extension.sh (:7-29), plus the additive `--components`
// option and the `NAME` validation of deviation (h). Pure: no output, no exit.

import type { Env } from "../extension/types.ts";

/** The six components the scaffolder offers, in the order the shell printed them. */
export const OFFERED_COMPONENTS: readonly string[] = [
  "mcp-server",
  "command",
  "skill",
  "agent",
  "hook",
  "theme",
];

export const TIERS: readonly string[] = ["core", "library", "org"];

/** The allowed shape of `NAME` (spec 0258 R25). */
export const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export type CreateArgs =
  | {
      readonly ok: true;
      readonly name: string;
      readonly tier: string;
      /** `--components` given: the chosen list (possibly empty); `undefined` when the option is absent. */
      readonly components: readonly string[] | undefined;
    }
  | { readonly ok: false; readonly status: number; readonly message: string };

function fail(message: string): CreateArgs {
  return { ok: false, status: 1, message };
}

/** The value of `--components`: comma-separated, blanks around a name and empty items dropped. */
function parseComponentList(value: string): readonly string[] | string {
  const names = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
  const unknown = names.find((item) => !OFFERED_COMPONENTS.includes(item));
  if (unknown !== undefined) {
    return `Error: unknown component '${unknown}' (expected a comma-separated list of ${OFFERED_COMPONENTS.join(", ")}).`;
  }
  return names;
}

export function parseCreateArgs(argv: readonly string[], env: Env): CreateArgs {
  let components: readonly string[] | undefined;
  for (let i = 0; i < argv.length; i++) {
    const word = argv[i] as string;
    let value: string | undefined;
    if (word === "--components") {
      value = argv[i + 1];
      if (value === undefined) return fail("Error: --components requires a value");
      i += 1;
    } else if (word.startsWith("--components=")) {
      value = word.slice("--components=".length);
    } else {
      // The shell ignored every argument it did not read: so does the entry.
      continue;
    }
    const parsed = parseComponentList(value);
    if (typeof parsed === "string") return fail(parsed);
    components = parsed;
  }

  // `[ -z "$NAME" ]`: an unset and an empty `NAME` both print the usage.
  const name = env["NAME"];
  if (name === undefined || name === "")
    return fail("Usage: NAME=my-extension task create-extension");
  if (!NAME_PATTERN.test(name)) {
    return fail(`Error: NAME must match ${NAME_PATTERN.source} (got '${name}').`);
  }

  // `${TIER:-org}`: an unset and an empty `TIER` both select the org tier.
  const rawTier = env["TIER"];
  const tier = rawTier === undefined || rawTier === "" ? "org" : rawTier;
  if (!TIERS.includes(tier)) {
    return fail(`Error: TIER must be one of core, library, org (got '${tier}').`);
  }
  return { ok: true, name, tier, components };
}
