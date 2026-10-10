// setup-golden-deviations.ts — the ONE shared list of tagged deviations the TypeScript leg of the
// golden matrix is allowed to show against the shell fixtures (spec 0256 requirement 44 and
// delta-01 requirements 44 (m)-(r); plan v2 step C4). Everything else must match byte for byte:
// `checkGolden` (setup-golden-regen.ts) applies `comparable` to the stored text and to the actual
// text of a `ts` run, so an untagged difference still fails. The shell leg is never touched.
//
//   tag (f)        stdout: the prompter echoes `[answer] <id>=<value>` for every pre-answer; the
//                  shell prints nothing (requirement 44 (f)).
//   tags (a)(b)    tree.json `fzf`: the records come from the stub `fzf` menu; the TypeScript
//                  setup has no `fzf` (requirement 44 (a): no guard; (b): line-mode questions).
//   tag (l)        tree.json `curl`: the records come from the stub `curl` daemon probes; the
//                  TypeScript setup probes in-process over HTTP (delta-01 (o), requirement 44 (l)).
//
// Opt-in tag (s) applies to a cell only when its `GoldenCase.deviations` lists it (ensure-http-rc1
// of the four CLIs), on the ts leg only:
//   tag (s)        the supervised daemon runs the TypeScript launcher of the service layer (spec 0252
//                  requirements 11-12): the tree entries `.crewrig/mcp-daemon-launcher.*`,
//                  `.crewrig/service-lib/` and the supervisor unit are ignored, and the extension
//                  of the single stdout line `Installed launcher: ...` is normalised.
//
// Aborting cancels (deviation tags (c), (e), (g)) are not a comparison rule: those cells are
// restricted to the shell leg with `legs: ["shell"]` in the case modules.
// API: TS_DEVIATIONS, comparable(leg, name, text, optIn).

import type { Leg } from "./setup-sandbox.ts";

/** One tagged deviation: where it applies, its requirement 44 tag, and what it ignores. */
export interface Deviation {
  readonly tag: string;
  readonly file: "stdout" | "tree.json";
  /** `stdout`: a line prefix to drop; `tree.json`: a top-level key to ignore. */
  readonly drop: string;
  readonly why: string;
}

export const TS_DEVIATIONS: readonly Deviation[] = [
  { tag: "f", file: "stdout", drop: "[answer] ", why: "the --answer echo" },
  { tag: "a/b", file: "tree.json", drop: "fzf", why: "no fzf menu on the TypeScript leg" },
  { tag: "l", file: "tree.json", drop: "curl", why: "in-process HTTP daemon probe" },
];

const LAUNCHER_LINE = /^(\s*Installed launcher: .*\/\.crewrig\/mcp-daemon-launcher)\.(?:sh|ts)$/;
const TAG_S_PATHS: readonly RegExp[] = [
  /^<HOME>\/\.crewrig\/mcp-daemon-launcher\.[^/]+$/,
  /^<HOME>\/\.crewrig\/service-lib(\/|$)/,
  /^<HOME>\/\.config\/systemd\/user\/mempalace-mcp-server\.service$/,
  /^<HOME>\/Library\/LaunchAgents\/[^/]*mcp[^/]*\.plist$/,
];

/** Does the tree row `item` (an object with a `path`) fall under an ignored path of tag (s)? */
function ignoredBySTag(item: unknown): boolean {
  const at: unknown = typeof item === "object" && item !== null ? Reflect.get(item, "path") : null;
  return typeof at === "string" && TAG_S_PATHS.some((re) => re.test(at));
}

/** The rows of an array one per line, as `serialize` stores them (a diff reads line by line). */
function rows(items: readonly unknown[]): string {
  return items.length === 0
    ? "[]"
    : `[\n${items.map((i) => `    ${JSON.stringify(i)}`).join(",\n")}\n  ]`;
}

/** The tree file without the ignored keys, rendered like `serialize` renders it. */
function withoutKeys(text: string, keys: readonly string[], rowFilter = false): string {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return text;
  const body = Object.entries(parsed).filter(([key]) => !keys.includes(key));
  const lines = body.map(([key, value]) =>
    Array.isArray(value)
      ? `  ${JSON.stringify(key)}: ${rows(rowFilter && key === "tree" ? value.filter((v) => !ignoredBySTag(v)) : value)}`
      : `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`,
  );
  return `{\n${lines.join(",\n")}\n}\n`;
}

/**
 * `text` of the golden file `name` as it is compared on `leg`: unchanged on the shell leg and for
 * `status` and `stderr`; on the `ts` leg the tagged deviations of `TS_DEVIATIONS` are removed, and
 * the opt-in tags the cell lists in `optIn` (`GoldenCase.deviations`) are applied on top.
 */
export function comparable(
  leg: string,
  name: string,
  text: string,
  optIn: readonly string[] = [],
): string {
  if (leg !== ("ts" satisfies Leg)) return text;
  const tagS = optIn.includes("s");
  if (name === "stdout") {
    const prefixes = TS_DEVIATIONS.filter((d) => d.file === "stdout").map((d) => d.drop);
    return text
      .split("\n")
      .filter((line) => !prefixes.some((p) => line.startsWith(p)))
      .map((line) => (tagS ? line.replace(LAUNCHER_LINE, "$1.sh") : line))
      .join("\n");
  }
  if (name === "tree.json") {
    return withoutKeys(
      text,
      TS_DEVIATIONS.filter((d) => d.file === "tree.json").map((d) => d.drop),
      tagS,
    );
  }
  return text;
}
