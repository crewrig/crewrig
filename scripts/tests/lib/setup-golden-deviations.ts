// setup-golden-deviations.ts — the ONE shared list of tagged deviations the TypeScript entry (run
// on both legs of the golden matrix: `shell` is the forwarding shim, `ts` the entry itself) is
// allowed to show against the fixtures recorded from the original shell (spec 0256 requirement 44 and
// delta-01 requirements 44 (m)-(r); plan v2 step C4). Everything else must match byte for byte:
// `checkGolden` (setup-golden-regen.ts) applies `comparable` to the stored text and to the actual
// text of a run, so an untagged difference still fails.
//
//   tag (f)        stdout: the prompter echoes `[answer] <id>=<value>` for every pre-answer; the
//                  shell prints nothing (requirement 44 (f)).
//   tags (a)(b)    tree.json `fzf`: the records come from the stub `fzf` menu; the TypeScript
//                  setup has no `fzf` (requirement 44 (a): no guard; (b): line-mode questions).
//
// These two removals would, together, delete the only evidence of WHICH questions a run asked, so
// every run is ALSO compared on the question sequence (`questionTexts`, setup-golden-questions.ts):
// the `<id>=<value>` list of the echo lines must equal the list the shell's fzf records stand for.
// The in-process daemon probe is not a tagged deviation of the comparison any more: the stand-in
// of the ts leg records the requests it receives and the harness maps them onto the `curl` records
// of the shell (setup-golden-run.ts `probeRecords`, delta-01 (o) says only that the probe is
// in-process), so `curl` is compared like every other tree key. (It was once called tag (l) here;
// requirement 44 (l) is the in-process BUILD, which is not a comparison rule.)
//
// Opt-in tag (s) applies to a cell only when its `GoldenCase.deviations` lists it (ensure-http-rc1
// of the four CLIs),
//   tag (s)        the supervised daemon runs the TypeScript launcher of the service layer (spec 0252
//                  requirements 11-12): the tree entries `.crewrig/mcp-daemon-launcher.*`,
//                  `.crewrig/service-lib/` and the supervisor unit are ignored, and the extension
//                  of the single stdout line `Installed launcher: ...` is normalised.
//
// Aborting cancels (deviation tags (c), (e), (g)) and the original shell's own guards have no
// TypeScript form: their cells (and fixtures) were removed when the shell became a shim.
// API: TS_DEVIATIONS, comparable(name, text, optIn), questionTexts(cli, shellFzf, tsStdout).

import { askedByShell, askedByTs } from "./setup-golden-questions.ts";
import type { AskedRecord } from "./setup-golden-questions.ts";
import type { Cli } from "./setup-golden-types.ts";

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
 * `text` of the golden file `name` as it is compared: unchanged for `status` and
 * `stderr`; for `stdout` and `tree.json` (on every leg: both run the TypeScript entry) the tagged deviations of `TS_DEVIATIONS` are removed, and
 * the opt-in tags the cell lists in `optIn` (`GoldenCase.deviations`) are applied on top.
 */
export function comparable(name: string, text: string, optIn: readonly string[] = []): string {
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

/**
 * The question evidence of a `ts` run, as two texts to compare: the `<id>=<value>` lines the shell
 * run's fzf records `shellFzf` stand for (expected), and those of the `[answer]` echo lines of the
 * TypeScript `stdout` (actual), one per line, in order. Equal texts mean the same questions were
 * asked, in the same order, with the same answers.
 */
export function questionTexts(
  cli: Cli,
  shellFzf: readonly AskedRecord[],
  stdout: string,
): readonly [string, string] {
  const text = (lines: readonly string[]): string => lines.map((l) => `${l}\n`).join("");
  return [text(askedByShell(cli, shellFzf)), text(askedByTs(stdout))];
}
